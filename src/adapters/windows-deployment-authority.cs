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

// Closed deployment wire format. This source contains no mutating dispatch or setter.
public static class DctDeploymentWire
{
    private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
    public static byte[] Exact(BinaryReader input, int length)
    {
        if (length < 0) throw new IOException("Invalid deployment length.");
        byte[] bytes = input.ReadBytes(length);
        if (bytes.Length != length) throw new EndOfStreamException("Short deployment input.");
        return bytes;
    }
    public static string Text(BinaryReader input, int maximum)
    {
        uint length = input.ReadUInt32();
        if (length > maximum) throw new IOException("Deployment field exceeds bound.");
        return Utf8.GetString(Exact(input, (int)length));
    }
    public static void Text(BinaryWriter output, string value, int maximum)
    {
        byte[] bytes = Utf8.GetBytes(value);
        if (bytes.Length > maximum) throw new IOException("Deployment field exceeds bound.");
        output.Write((uint)bytes.Length); output.Write(bytes);
    }
    public static void Magic(BinaryReader input, string expected)
    {
        if (!String.Equals(Encoding.ASCII.GetString(Exact(input, 8)), expected, StringComparison.Ordinal))
            throw new IOException("Invalid deployment magic.");
    }
    private static MemoryStream Bounded(Stream stream)
    {
        MemoryStream owned = new MemoryStream();
        byte[] chunk = new byte[65536];
        int used;
        while ((used = stream.Read(chunk, 0, chunk.Length)) != 0)
        {
            if (owned.Length + used > 1048576) throw new IOException("Deployment request exceeds bound.");
            owned.Write(chunk, 0, used);
        }
        owned.Position = 0;
        return owned;
    }
    public static void PathName(string name)
    {
        if (name.Length > 32768 || name.Length < 3 || !((name[0] >= 'A' && name[0] <= 'Z') || (name[0] >= 'a' && name[0] <= 'z')) || name[1] != ':' || name[2] != '\\' ||
            name.IndexOfAny(new char[] { '\0', '\r', '\n', '/' }) >= 0 || name.IndexOf(':', 2) >= 0 ||
            !String.Equals(Path.GetFullPath(name), name, StringComparison.Ordinal) ||
            (name.Length > 3 && name.EndsWith("\\", StringComparison.Ordinal)) ||
            name.Substring(3).Split('\\').Length > 64) throw new IOException("Invalid deployment path.");
        // Exact raw facts framing: seven prefixes/account+owner/four IDs, booleans,
        // filesystem, volume fields, DACL count and 128 bounded SID/mask/flags/type entries.
        const int overhead = 7 * 4 + 2 * 184 + 4 * 20 + 3 + 4 + 32 + 2 * 4 + 4 + 128 * (4 + 184 + 3 * 4);
        if (overhead + Utf8.GetByteCount(name) > 65536) throw new IOException("Native reply record cannot fit.");
        if (name.Length > 3) foreach (string part in name.Substring(3).Split('\\'))
        {
            if (part.Length == 0 || part.EndsWith(".", StringComparison.Ordinal) || part.EndsWith(" ", StringComparison.Ordinal) ||
                part.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) throw new IOException("Ambiguous Windows component.");
            string stem = part.Split('.')[0].ToUpperInvariant();
            if (stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
                (stem.Length == 4 && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal)) && stem[3] >= '1' && stem[3] <= '9'))
                throw new IOException("Reserved Windows component.");
        }
    }
    public static string[] Query(Stream stream)
    {
        // Complete bounded request and exact EOF precede any native observation.
        MemoryStream owned = Bounded(stream);
        BinaryReader input = new BinaryReader(owned, Utf8);
        Magic(input, "DCTQRY1\n");
        uint count = input.ReadUInt32();
        if (count < 1 || count > 128) throw new IOException("Invalid deployment query count.");
        List<string> paths = new List<string>();
        HashSet<string> unique = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for (uint index = 0; index < count; index++)
        {
            string name = Text(input, 1048560);
            PathName(name);
            if (!unique.Add(name)) throw new IOException("Duplicate deployment query path.");
            paths.Add(name);
        }
        if (owned.Position != owned.Length) throw new IOException("Trailing deployment query.");
        return paths.ToArray();
    }
    private static void Identity(string value, bool nonzero)
    {
        ulong parsed;
        if (!UInt64.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out parsed) ||
            parsed.ToString(CultureInfo.InvariantCulture) != value || (nonzero && parsed == 0))
            throw new IOException("Invalid deployment unsigned identity.");
    }
    private static void ChildName(string root, string relative)
    {
        string child = Path.Combine(root, relative);
        PathName(child);
        if (relative.Length == 0 || Utf8.GetByteCount(relative) > 8192 ||
            !String.Equals(child, root + "\\" + relative, StringComparison.Ordinal) ||
            !child.StartsWith(root + "\\", StringComparison.Ordinal)) throw new IOException("Invalid deployment child.");
    }
    public static string[] Mutation(Stream stream)
    {
        MemoryStream owned = Bounded(stream);
        BinaryReader input = new BinaryReader(owned, Utf8);
        Magic(input, "DCTMUT1\n");
        if (input.ReadUInt32() != 8) throw new IOException("Invalid deployment mutation count.");
        int[] maxima = new int[] { 16, 98304, 8192, 8192, 20, 20, 20, 20 };
        string[] fields = new string[8];
        for (int index = 0; index < fields.Length; index++)
        {
            fields[index] = Text(input, maxima[index]);
            if (fields[index].IndexOfAny(new char[] { '\0', '\r', '\n' }) >= 0) throw new IOException("Invalid deployment mutation field.");
        }
        if (owned.Position != owned.Length) throw new IOException("Trailing deployment mutation.");
        string operation = fields[0], root = fields[1];
        PathName(root);
        if (root.Length <= 3) throw new IOException("Mutation requires a child root.");
        Identity(fields[4], false); Identity(fields[7], true);
        if (operation == "create-root")
        {
            if (fields[2] != "" || fields[3] != "" || fields[5] != "" || fields[6] != "") throw new IOException("Invalid create-root placeholders.");
        }
        else if (operation == "create-directory" || operation == "publish")
        {
            ChildName(root, fields[2]); Identity(fields[5], true);
            if (operation == "publish") { ChildName(root, fields[3]); Identity(fields[6], true); }
            else if (fields[3] != "" || fields[6] != "") throw new IOException("Invalid directory placeholders.");
        }
        else throw new IOException("Unknown deployment mutation.");
        return fields;
    }
    private static string Value(Dictionary<string, object> value, string key)
    { return Convert.ToString(value[key], CultureInfo.InvariantCulture); }
    public static void Facts(Stream stream, Dictionary<string, object>[] facts)
    {
        if (facts.Length < 1 || facts.Length > 128) throw new IOException("Invalid deployment facts count.");
        MemoryStream owned = new MemoryStream();
        BinaryWriter output = new BinaryWriter(owned, Utf8);
        output.Write(Encoding.ASCII.GetBytes("DCTQRS1\n")); output.Write((uint)facts.Length);
        foreach (Dictionary<string, object> value in facts)
        {
            long start = owned.Position;
            Text(output, Value(value, "account"), 184); Text(output, Value(value, "owner"), 184);
            Text(output, Value(value, "path"), 65536);
            foreach (string key in new string[] { "device", "inode", "links", "size" }) Text(output, Value(value, key), 20);
            output.Write((bool)value["directory"]); output.Write((bool)value["protected"]); output.Write((bool)value["reparse"]);
            Text(output, Value(value, "filesystem"), 32); output.Write((uint)value["volumeFlags"]); output.Write((uint)value["driveType"]);
            object[] entries = (object[])value["dacl"];
            if (entries.Length > 128) throw new IOException("Deployment DACL exceeds bound.");
            output.Write((uint)entries.Length);
            foreach (object entry in entries)
            {
                Dictionary<string, object> ace = (Dictionary<string, object>)entry;
                Text(output, Value(ace, "sid"), 184);
                output.Write(UInt32.Parse(Value(ace, "mask"), CultureInfo.InvariantCulture));
                output.Write((uint)(int)ace["flags"]); output.Write((uint)(int)ace["type"]);
            }
            if (owned.Position - start > 65536) throw new IOException("Deployment native record exceeds bound.");
        }
        if (owned.Length > 16777216) throw new IOException("Deployment native reply exceeds bound.");
        output.Flush(); owned.Position = 0; owned.CopyTo(stream); stream.Flush();
    }
}

public static class DctDeploymentQueryProgram
{
    public static int Main(string[] arguments)
    {
        try
        {
            if (arguments.Length != 0) throw new IOException("Query accepts no commands.");
            string[] paths = DctDeploymentWire.Query(Console.OpenStandardInput());
            List<Dictionary<string, object>> facts = new List<Dictionary<string, object>>();
            foreach (string name in paths) facts.Add(DctDeploymentAuthority.Inspect(name));
            DctDeploymentWire.Facts(Console.OpenStandardOutput(), facts.ToArray());
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.GetType().Name + ": " + error.Message); return 1; }
    }
}
