// Read-only Win32 permission/identity evidence. No launch, elevation, ACL setter or file creation.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class DctDeploymentAuthority
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FileInfo
    {
        public uint attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FileInfo information);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetFileType(SafeFileHandle handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder name, uint length, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle, StringBuilder label, uint labelSize, out uint serial, out uint maximumComponent, out uint flags, StringBuilder filesystem, uint filesystemSize);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetVolumePathNameW(string path, StringBuilder volume, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetDriveTypeW(string root);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityInfo(SafeFileHandle handle, uint type, uint requested, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")]
    private static extern IntPtr LocalFree(IntPtr allocation);

    private static void Check(bool result) { if (!result) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    private static string Decimal(ulong value) { return value.ToString(CultureInfo.InvariantCulture); }

    public static Dictionary<string, object> Inspect(string path)
    {
        if (String.IsNullOrEmpty(path) || path.Length > 32768 || path.IndexOfAny(new char[] { '\0', '\r', '\n' }) >= 0 ||
            path.Length < 3 || !Char.IsLetter(path[0]) || path[1] != ':' || path[2] != '\\' || path.IndexOf(':', 2) >= 0 ||
            !String.Equals(Path.GetFullPath(path), path, StringComparison.Ordinal)) throw new IOException("Invalid canonical DOS path.");
        // OPEN_EXISTING, READ_CONTROL | FILE_READ_ATTRIBUTES, full sharing, no reparse traversal.
        using (SafeFileHandle handle = CreateFileW(path, 0x20080, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero))
        {
            if (handle.IsInvalid) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (GetFileType(handle) != 1) throw new IOException("Not a disk object.");
            FileInfo before;
            Check(GetFileInformationByHandle(handle, out before));
            StringBuilder final = new StringBuilder(32769);
            uint length = GetFinalPathNameByHandleW(handle, final, (uint) final.Capacity, 0);
            if (length < 7 || length >= final.Capacity || !final.ToString().StartsWith("\\\\?\\", StringComparison.Ordinal)) throw new IOException("Unknown native path.");
            string canonical = final.ToString().Substring(4);
            if (!String.Equals(canonical, path, StringComparison.Ordinal)) throw new IOException("Native path changed.");
            StringBuilder filesystem = new StringBuilder(32), label = new StringBuilder(261), volume = new StringBuilder(32769);
            uint serial, maximumComponent, flags;
            Check(GetVolumeInformationByHandleW(handle, label, (uint) label.Capacity, out serial, out maximumComponent, out flags, filesystem, (uint) filesystem.Capacity));
            Check(GetVolumePathNameW(canonical, volume, (uint) volume.Capacity));
            if (serial != before.volume) throw new IOException("Native volume changed.");
            IntPtr owner, group, dacl, sacl, descriptor;
            uint error = GetSecurityInfo(handle, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
            if (error != 0) throw new Win32Exception((int) error);
            try
            {
                uint size = GetSecurityDescriptorLength(descriptor);
                if (owner == IntPtr.Zero || dacl == IntPtr.Zero || descriptor == IntPtr.Zero || size < 20 || size > 65536) throw new IOException("Missing bounded DACL.");
                byte[] bytes = new byte[size];
                Marshal.Copy(descriptor, bytes, 0, bytes.Length);
                RawSecurityDescriptor security = new RawSecurityDescriptor(bytes, 0);
                if (security.DiscretionaryAcl == null || security.DiscretionaryAcl.Count > 128) throw new IOException("Unknown DACL.");
                List<object> entries = new List<object>();
                foreach (GenericAce raw in security.DiscretionaryAcl)
                {
                    CommonAce ace = raw as CommonAce;
                    if (ace == null || ace.IsCallback || ace.AceType != AceType.AccessAllowed) throw new IOException("Unknown ACE.");
                    entries.Add(new Dictionary<string, object> { { "sid", ace.SecurityIdentifier.Value }, { "mask", Decimal(unchecked((uint) ace.AccessMask)) }, { "flags", (int) ace.AceFlags }, { "type", (int) ace.AceType } });
                }
                FileInfo after;
                Check(GetFileInformationByHandle(handle, out after));
                bool directory = (before.attributes & 0x10) != 0;
                // Child publication changes directory write time/link counts without replacing that directory.
                if (directory ? before.volume != after.volume || before.indexHigh != after.indexHigh ||
                    before.indexLow != after.indexLow || before.attributes != after.attributes : !before.Equals(after))
                    throw new IOException("Native identity changed during security query.");
                using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
                {
                    if (identity.User == null) throw new IOException("Missing current token SID.");
                    return new Dictionary<string, object> {
                        { "platform", "win32" }, { "account", identity.User.Value }, { "owner", new SecurityIdentifier(owner).Value },
                        { "path", canonical }, { "device", Decimal(before.volume) }, { "inode", Decimal(((ulong) before.indexHigh << 32) | before.indexLow) },
                        { "links", Decimal(before.links) }, { "size", directory ? "0" : Decimal(((ulong) before.sizeHigh << 32) | before.sizeLow) }, { "directory", directory },
                        { "protected", (security.ControlFlags & ControlFlags.DiscretionaryAclProtected) != 0 }, { "reparse", (before.attributes & 0x400) != 0 },
                        { "dacl", entries.ToArray() }, { "filesystem", filesystem.ToString() }, { "volumeFlags", flags }, { "driveType", GetDriveTypeW(volume.ToString()) }
                    };
                }
            }
            finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
        }
    }
}
