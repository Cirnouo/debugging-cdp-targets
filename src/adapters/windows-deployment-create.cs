// Fixed current-account creation/no-replace primitives. No elevation, existing ACL repair or payload trust.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32.SafeHandles;

public static class DctDeploymentCreate
{
    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes
    {
        public int length;
        public IntPtr descriptor;
        public int inherit;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectoryW(string name, ref SecurityAttributes security);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int information, IntPtr buffer, uint bytes);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateCopyFileW(string name, uint access, uint share, ref SecurityAttributes security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out CopyFileInfo information);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetFileType(SafeFileHandle handle);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle, StringBuilder name, uint length, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int information, out CopyFileBasicInfo basic, uint size);

    [StructLayout(LayoutKind.Sequential)]
    private struct CopyFileInfo
    {
        public uint attributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME creation, access, write;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    // FILE_BASIC_INFO, x64 ABI: no CreationTime/LastAccessTime substitution for ChangeTime.
    [StructLayout(LayoutKind.Explicit, Size = 40)]
    private struct CopyFileBasicInfo
    {
        [FieldOffset(0)] public long creation;
        [FieldOffset(8)] public long access;
        [FieldOffset(16)] public long lastWrite;
        [FieldOffset(24)] public long change;
        [FieldOffset(32)] public uint attributes;
    }

    private static void Demand(bool value) { if (!value) throw new IOException("Unsafe fresh deployment boundary."); }
    private static string Text(Dictionary<string, object> value, string key) { return Convert.ToString(value[key], CultureInfo.InvariantCulture); }
    private static string Canonical(string value)
    {
        Demand(!String.IsNullOrEmpty(value) && value.Length <= 32768 && value.IndexOfAny(new char[] { '\0', '\r', '\n', '/' }) < 0 &&
            value.Length >= 3 && Char.IsLetter(value[0]) && value[1] == ':' && value[2] == '\\' && value.IndexOf(':', 2) < 0 &&
            String.Equals(Path.GetFullPath(value), value, StringComparison.Ordinal));
        return value;
    }
    private static string Child(string root, string relative)
    {
        Demand(!String.IsNullOrEmpty(relative) && relative.Length <= 32768 && !Path.IsPathRooted(relative));
        foreach (string part in relative.Split('\\'))
        {
            Demand(part.Length > 0 && part != "." && part != ".." && !part.EndsWith(".", StringComparison.Ordinal) &&
                !part.EndsWith(" ", StringComparison.Ordinal) && part.IndexOfAny(Path.GetInvalidFileNameChars()) < 0);
            string stem = part.Split('.')[0].ToUpperInvariant();
            Demand(stem != "CON" && stem != "PRN" && stem != "AUX" && stem != "NUL" &&
                !(stem.Length == 4 && (stem.StartsWith("COM", StringComparison.Ordinal) || stem.StartsWith("LPT", StringComparison.Ordinal)) && stem[3] >= '1' && stem[3] <= '9'));
        }
        string result = Canonical(Path.Combine(root, relative));
        Demand(result.StartsWith(root + "\\", StringComparison.Ordinal));
        return result;
    }
    // The same narrow accepted templates as the native-entry validator. Facts come only from Inspect.
    private static Dictionary<string, object> Inspect(string name, string account, bool ancestor)
    {
        Dictionary<string, object> value = DctDeploymentAuthority.Inspect(name);
        Demand(Text(value, "account") == account && Text(value, "filesystem") == "NTFS" &&
            (uint)value["driveType"] == 3 && !(bool)value["reparse"] && Text(value, "inode") != "0");
        uint volume = (uint)value["volumeFlags"];
        Demand((volume & 8) != 0 && (volume & 0x80000) == 0);
        HashSet<string> principals = new HashSet<string>(new string[] { account, "S-1-5-18", "S-1-5-32-544" });
        Demand(principals.Contains(Text(value, "owner")) && (ancestor || Text(value, "owner") == account));
        bool directory = (bool)value["directory"], full = false;
        Demand(!ancestor || directory);
        Demand(ancestor || !directory || (bool)value["protected"]);
        Demand(directory || Text(value, "links") == "1");
        object[] entries = (object[])value["dacl"];
        Demand(entries.Length > 0 && entries.Length <= 128);
        foreach (object entry in entries)
        {
            Dictionary<string, object> ace = (Dictionary<string, object>)entry;
            uint mask = UInt32.Parse(Text(ace, "mask"), CultureInfo.InvariantCulture);
            int flags = (int)ace["flags"];
            Demand((int)ace["type"] == 0 && (mask & ~0x1f01ffU) == 0 && (flags == 0 || flags == 3 || flags == 16 || flags == 19));
            Demand(ancestor || !directory || flags == 3 || flags == 19);
            Demand(ancestor || (bool)value["protected"] || flags == 16);
            Demand(principals.Contains(Text(ace, "sid")) || (ancestor && (mask & ~0x1200a9U) == 0));
            if (Text(ace, "sid") == account && mask == 0x1f01ffU) full = true;
        }
        Demand(ancestor || full);
        return value;
    }
    private static SafeFileHandle Hold(string name, uint access, uint share = 3)
    {
        // No FILE_SHARE_DELETE: hold actual ancestors/parents/source through mutation.
        SafeFileHandle handle = CreateFileW(name, access, share, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
        if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
        return handle;
    }
    private static void Same(Dictionary<string, object> actual, string device, string inode)
    {
        Demand(Text(actual, "device") == device && Text(actual, "inode") == inode);
    }
    private static void ProtectedDirectory(string name, string account)
    {
        // Protected DACL is supplied to the exclusive creation itself, never repaired afterwards.
        RawSecurityDescriptor descriptor = new RawSecurityDescriptor("O:" + account + "D:P(A;OICI;FA;;;" + account + ")(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)");
        byte[] bytes = new byte[descriptor.BinaryLength];
        descriptor.GetBinaryForm(bytes, 0);
        IntPtr memory = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, memory, bytes.Length);
            SecurityAttributes attributes = new SecurityAttributes { length = Marshal.SizeOf(typeof(SecurityAttributes)), descriptor = memory, inherit = 0 };
            if (!CreateDirectoryW(name, ref attributes)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    public static Dictionary<string, object> Execute(string operation, string root, string relative, string destination,
        string device, string inode, string sourceInode, string parentInode)
    {
        Demand(IntPtr.Size == 8 && (operation == "create-root" || operation == "create-directory" || operation == "publish"));
        Canonical(root);
        Demand(root.Length > 3 && root[root.Length - 1] != '\\');
        string source = operation == "create-root" ? root : Child(root, relative);
        string target = operation == "publish" ? Child(root, destination) : source;
        Demand(operation == "publish" || String.IsNullOrEmpty(destination));
        Demand(operation != "create-root" || (String.IsNullOrEmpty(relative) && String.IsNullOrEmpty(inode)));
        List<SafeFileHandle> held = new List<SafeFileHandle>();
        using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
        {
            Demand(identity.User != null);
            string account = identity.User.Value;
            try
            {
                HashSet<string> parents = new HashSet<string>(StringComparer.Ordinal);
                foreach (string leaf in new string[] { source, target })
                    for (string current = Path.GetDirectoryName(leaf); !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) parents.Add(current);
                foreach (string parent in parents)
                {
                    held.Add(Hold(parent, 0x20080));
                    bool managed = parent == root || parent.StartsWith(root + "\\", StringComparison.Ordinal);
                    Dictionary<string, object> entry = Inspect(parent, account, !managed);
                    if (parent == root) Same(entry, device, inode);
                }
                Dictionary<string, object> targetParent = Inspect(Path.GetDirectoryName(target), account, operation == "create-root");
                Same(targetParent, device, parentInode);
                if (operation == "publish")
                {
                    held.Add(Hold(source, 0x30080, 1)); // DELETE | READ_CONTROL | FILE_READ_ATTRIBUTES; share read only
                    Dictionary<string, object> before = Inspect(source, account, false);
                    Same(before, device, sourceInode);
                    // FILE_RENAME_INFO, x64 layout; ReplaceIfExists = FALSE, RootDirectory = NULL.
                    // The source handle remains open; no path-based close/rename gap or cross-volume copy.
                    byte[] name = Encoding.Unicode.GetBytes(target);
                    int size = checked(20 + name.Length);
                    IntPtr buffer = Marshal.AllocHGlobal(size);
                    try
                    {
                        for (int index = 0; index < 20; index++) Marshal.WriteByte(buffer, index, 0);
                        Marshal.WriteInt32(buffer, 16, name.Length);
                        Marshal.Copy(name, 0, IntPtr.Add(buffer, 20), name.Length);
                        if (!SetFileInformationByHandle(held[held.Count - 1], 3, buffer, (uint)size)) throw new Win32Exception(Marshal.GetLastWin32Error());
                    }
                    finally { Marshal.FreeHGlobal(buffer); }
                    Dictionary<string, object> after = Inspect(target, account, false);
                    Same(after, device, sourceInode);
                    return after;
                }
                ProtectedDirectory(target, account);
                Dictionary<string, object> created = Inspect(target, account, false);
                Demand(Text(created, "device") == device && (bool)created["directory"]);
                return created;
            }
            finally { for (int index = held.Count - 1; index >= 0; index--) held[index].Dispose(); }
        }
    }

    private sealed class CopyEntry
    {
        public string relative;
        public bool directory;
        public ulong bytes;
        public byte[] hash;
    }
    private sealed class CopyPlan
    {
        public string root, stage, device;
        public Dictionary<string, string> directories = new Dictionary<string, string>(StringComparer.Ordinal);
        public List<CopyEntry> entries = new List<CopyEntry>();
        public CopyEntry manifest;
    }
    private sealed class CopyParent
    {
        public string name, device, inode;
        public SafeFileHandle handle;
        public bool ancestor;
    }
    private sealed class CopyObservation
    {
        public string relative, device, inode;
        public bool directory;
        public ulong bytes;
    }
    private static readonly UTF8Encoding CopyUtf8 = new UTF8Encoding(false, true);
    private static string CopyRelative(string root, string relative)
    {
        Demand(relative.Length > 0 && CopyUtf8.GetByteCount(relative) <= 8192 && relative.Split('/').Length <= 64 &&
            relative.IndexOf('\\') < 0 && relative.Normalize(NormalizationForm.FormC) == relative);
        string result = Child(root, relative.Replace('/', '\\'));
        DctDeploymentWire.PathName(result);
        return result;
    }
    private static CopyPlan CopyHeader(BinaryReader input)
    {
        DctDeploymentWire.Magic(input, "DCTCPY1\n");
        uint size = input.ReadUInt32();
        Demand(size >= 12 && size <= 8388608);
        using (MemoryStream storage = new MemoryStream(DctDeploymentWire.Exact(input, (int)size - 12), false))
        using (BinaryReader fields = new BinaryReader(storage, CopyUtf8))
        {
            CopyPlan plan = new CopyPlan();
            plan.root = DctDeploymentWire.Text(fields, 98304);
            DctDeploymentWire.PathName(plan.root); Demand(plan.root.Length > 3);
            string stage = DctDeploymentWire.Text(fields, 8192);
            string[] components = stage.Split('/');
            Guid nonce;
            Demand(components.Length == 3 && components[0] == ".staging" && components[2] == "payload" &&
                components[1].Length == 36 && Guid.TryParseExact(components[1], "D", out nonce) &&
                nonce.ToString("D") == components[1] && components[1][14] == '4' && "89ab".IndexOf(components[1][19]) >= 0);
            plan.stage = CopyRelative(plan.root, stage);
            plan.device = fields.ReadUInt64().ToString(CultureInfo.InvariantCulture);
            string[] parents = new string[] { "", ".staging", stage.Substring(0, stage.Length - 8), stage };
            Demand(fields.ReadUInt32() == parents.Length);
            foreach (string relative in parents)
            {
                Demand(DctDeploymentWire.Text(fields, 8192) == relative);
                ulong inode = fields.ReadUInt64(); Demand(inode != 0);
                string name = relative == "" ? plan.root : CopyRelative(plan.root, relative);
                plan.directories.Add(name, inode.ToString(CultureInfo.InvariantCulture));
            }
            uint count = fields.ReadUInt32(); Demand(count <= 4096);
            string previous = "";
            HashSet<string> aliases = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            HashSet<string> declaredDirectories = new HashSet<string>(StringComparer.Ordinal);
            ulong totalBytes = 0;
            long pathBytes = CopyUtf8.GetByteCount("payload-manifest.json");
            for (uint index = 0; index < count; index++)
            {
                byte type = fields.ReadByte(); Demand(type == 0 || type == 1);
                CopyEntry entry = new CopyEntry { relative = DctDeploymentWire.Text(fields, 8192), directory = type == 0,
                    bytes = fields.ReadUInt64(), hash = DctDeploymentWire.Exact(fields, 32) };
                CopyRelative(plan.stage, entry.relative);
                Demand(String.CompareOrdinal(previous, entry.relative) < 0 && aliases.Add(entry.relative) &&
                    !String.Equals(entry.relative.Split('/')[0], "payload-manifest.json", StringComparison.OrdinalIgnoreCase));
                int slash = entry.relative.LastIndexOf('/');
                Demand(slash < 0 || declaredDirectories.Contains(entry.relative.Substring(0, slash)));
                if (entry.directory)
                {
                    Demand(entry.bytes == 0);
                    foreach (byte value in entry.hash) Demand(value == 0);
                    declaredDirectories.Add(entry.relative);
                }
                else { Demand(entry.bytes <= 2147483648UL); totalBytes = checked(totalBytes + entry.bytes); }
                pathBytes = checked(pathBytes + CopyUtf8.GetByteCount(entry.relative));
                Demand(pathBytes <= 1048576 && totalBytes <= 8589934592UL);
                previous = entry.relative; plan.entries.Add(entry);
            }
            uint manifestBytes = fields.ReadUInt32(); Demand(manifestBytes >= 1 && manifestBytes <= 16777216);
            plan.manifest = new CopyEntry { relative = "payload-manifest.json", directory = false, bytes = manifestBytes,
                hash = DctDeploymentWire.Exact(fields, 32) };
            CopyRelative(plan.stage, plan.manifest.relative);
            Demand(storage.Position == storage.Length && 12 + pathBytes + ((long)count + 1) * 29 <= 2097152 &&
                (ulong)size + 2 * totalBytes + 2 * manifestBytes <= 17213423616UL);
            return plan;
        }
    }
    private static void CloseCopyHandle(SafeFileHandle handle)
    {
        if (handle.IsClosed) return;
        IntPtr raw = handle.DangerousGetHandle();
        handle.SetHandleAsInvalid(); // No second close/replay after an indeterminate CloseHandle failure.
        if (!CloseHandle(raw)) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    private static void FinishCopyHandles(List<SafeFileHandle> handles, Exception primary)
    {
        List<Exception> errors = new List<Exception>();
        if (primary != null) errors.Add(primary);
        for (int index = handles.Count - 1; index >= 0; index--)
        {
            try { CloseCopyHandle(handles[index]); } catch (Exception error) { errors.Add(error); }
        }
        if (errors.Count == 1) throw errors[0];
        if (errors.Count > 1) throw new AggregateException("Deployment copy and close failures.", errors);
    }
    private static void CopyHandleFacts(SafeFileHandle handle, string name, Dictionary<string, object> facts)
    {
        Demand(GetFileType(handle) == 1);
        CopyFileInfo info;
        if (!GetFileInformationByHandle(handle, out info)) throw new Win32Exception(Marshal.GetLastWin32Error());
        StringBuilder final = new StringBuilder(32769);
        uint size = GetFinalPathNameByHandleW(handle, final, (uint)final.Capacity, 0);
        Demand(size >= 7 && size < final.Capacity && final.ToString().StartsWith("\\\\?\\", StringComparison.Ordinal) &&
            final.ToString().Substring(4) == name && (info.attributes & 0x400) == 0);
        Demand(Text(facts, "device") == info.volume.ToString(CultureInfo.InvariantCulture) &&
            Text(facts, "inode") == (((ulong)info.indexHigh << 32) | info.indexLow).ToString(CultureInfo.InvariantCulture) &&
            (bool)facts["directory"] == ((info.attributes & 0x10) != 0) &&
            Text(facts, "links") == info.links.ToString(CultureInfo.InvariantCulture));
        if ((info.attributes & 0x10) == 0)
            Demand(Text(facts, "size") == (((ulong)info.sizeHigh << 32) | info.sizeLow).ToString(CultureInfo.InvariantCulture) && info.links == 1);
    }
    private static List<CopyParent> AcquireCopyParents(CopyPlan plan, string target, string account, List<SafeFileHandle> handles)
    {
        List<string> names = new List<string>();
        for (string current = Path.GetDirectoryName(target); !String.IsNullOrEmpty(current); current = Path.GetDirectoryName(current)) names.Add(current);
        names.Reverse();
        List<CopyParent> result = new List<CopyParent>();
        foreach (string name in names)
        {
            SafeFileHandle handle = Hold(name, 0x20080); handles.Add(handle);
            bool ancestor = name != plan.root && !name.StartsWith(plan.root + "\\", StringComparison.Ordinal);
            Dictionary<string, object> value = Inspect(name, account, ancestor);
            Demand((bool)value["directory"]);
            if (!ancestor)
            {
                string inode; Demand(plan.directories.TryGetValue(name, out inode)); Same(value, plan.device, inode);
            }
            CopyHandleFacts(handle, name, value);
            result.Add(new CopyParent { name = name, handle = handle, ancestor = ancestor,
                device = Text(value, "device"), inode = Text(value, "inode") });
        }
        return result;
    }
    private static void RecheckCopyParents(List<CopyParent> parents, string account)
    {
        foreach (CopyParent parent in parents)
        {
            // IDs/held handles are comparison baselines; every boundary repeats the original permission predicates.
            Dictionary<string, object> value = Inspect(parent.name, account, parent.ancestor);
            Demand((bool)value["directory"]); Same(value, parent.device, parent.inode);
            CopyHandleFacts(parent.handle, parent.name, value);
        }
    }
    private static Dictionary<string, object> CopyBoundary(List<CopyParent> parents, string account, string name,
        SafeFileHandle handle, string device, string inode, ulong length)
    {
        RecheckCopyParents(parents, account);
        Dictionary<string, object> value = Inspect(name, account, false);
        Demand(!(bool)value["directory"] && Text(value, "size") == length.ToString(CultureInfo.InvariantCulture));
        Same(value, device, inode); CopyHandleFacts(handle, name, value);
        return value;
    }
    private static CopyFileBasicInfo CopyBasic(SafeFileHandle handle)
    {
        CopyFileBasicInfo result;
        Demand(Marshal.SizeOf(typeof(CopyFileBasicInfo)) == 40);
        if (!GetFileInformationByHandleEx(handle, 0, out result, 40)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return result;
    }
    private static SafeFileHandle ProtectedCopyFile(string name, string account)
    {
        RawSecurityDescriptor descriptor = new RawSecurityDescriptor("O:" + account + "D:P(A;;FA;;;" + account + ")(A;;FA;;;SY)(A;;FA;;;BA)");
        byte[] bytes = new byte[descriptor.BinaryLength]; descriptor.GetBinaryForm(bytes, 0);
        IntPtr memory = Marshal.AllocHGlobal(bytes.Length);
        try
        {
            Marshal.Copy(bytes, 0, memory, bytes.Length);
            SecurityAttributes attributes = new SecurityAttributes { length = Marshal.SizeOf(typeof(SecurityAttributes)), descriptor = memory, inherit = 0 };
            SafeFileHandle handle = CreateCopyFileW(name, 0x40020080, 1, ref attributes, 1, 0x02200000, IntPtr.Zero);
            if (handle.IsInvalid) { int error = Marshal.GetLastWin32Error(); handle.Dispose(); throw new Win32Exception(error); }
            return handle;
        }
        finally { Marshal.FreeHGlobal(memory); }
    }
    private static FileStream CopyStream(SafeFileHandle handle, FileAccess access)
    {
        // FileStream owns only a non-owning wrapper; the actual native close below is checked explicitly.
        return new FileStream(new SafeFileHandle(handle.DangerousGetHandle(), false), access, 65536, false);
    }
    private static void FinishCopyStreams(FileStream stream, SHA256 hash, Exception primary)
    {
        List<Exception> errors = new List<Exception>();
        if (primary != null) errors.Add(primary);
        if (hash != null) { try { hash.Dispose(); } catch (Exception error) { errors.Add(error); } }
        if (stream != null) { try { stream.Dispose(); } catch (Exception error) { errors.Add(error); } }
        if (errors.Count == 1) throw errors[0];
        if (errors.Count > 1) throw new AggregateException("Deployment copy stream and close failures.", errors);
    }
    private static bool CopyHash(byte[] expected, byte[] actual)
    {
        if (actual == null || actual.Length != expected.Length) return false;
        for (int index = 0; index < expected.Length; index++) if (actual[index] != expected[index]) return false;
        return true;
    }
    private static CopyObservation CopyFile(CopyPlan plan, CopyEntry entry, string account, BinaryReader input)
    {
        string name = CopyRelative(plan.stage, entry.relative);
        List<SafeFileHandle> handles = new List<SafeFileHandle>();
        Exception primary = null;
        CopyObservation result = null;
        try
        {
            // Initial verifyParent, then exclusive protected regular-file creation.
            List<CopyParent> parents = AcquireCopyParents(plan, name, account, handles);
            SafeFileHandle writer = ProtectedCopyFile(name, account); handles.Add(writer);
            Dictionary<string, object> created = Inspect(name, account, false);
            string inode = Text(created, "inode");
            CopyBoundary(parents, account, name, writer, plan.device, inode, 0);
            FileStream stream = null; SHA256 hash = null; Exception streamError = null;
            try
            {
                stream = CopyStream(writer, FileAccess.Write); hash = SHA256.Create();
                for (ulong offset = 0; offset < entry.bytes;)
                {
                    int count = (int)Math.Min(65536UL, entry.bytes - offset);
                    byte[] bytes = DctDeploymentWire.Exact(input, count);
                    stream.Write(bytes, 0, bytes.Length); hash.TransformBlock(bytes, 0, bytes.Length, null, 0); offset += (uint)bytes.Length;
                }
                hash.TransformFinalBlock(new byte[0], 0, 0); Demand(CopyHash(entry.hash, hash.Hash));
                stream.Flush(true);
                CopyBoundary(parents, account, name, writer, plan.device, inode, entry.bytes);
            }
            catch (Exception error) { streamError = error; }
            FinishCopyStreams(stream, hash, streamError);
            CloseCopyHandle(writer);
            SafeFileHandle reader = Hold(name, 0x80020080, 1); handles.Add(reader);
            CopyBoundary(parents, account, name, reader, plan.device, inode, entry.bytes);
            // Capture AFTER successful writer close/reopen; never compare owned-write timestamps across close.
            CopyFileBasicInfo before = CopyBasic(reader);
            stream = null; streamError = null;
            try
            {
                stream = CopyStream(reader, FileAccess.Read);
                byte[] actual = new byte[65536];
                for (ulong offset = 0; offset < entry.bytes;)
                {
                    int count = (int)Math.Min(65536UL, entry.bytes - offset);
                    byte[] expected = DctDeploymentWire.Exact(input, count);
                    int used = 0;
                    while (used < count) { int read = stream.Read(actual, used, count - used); Demand(read > 0); used += read; }
                    for (int index = 0; index < count; index++) Demand(expected[index] == actual[index]);
                    offset += (uint)count;
                }
                Demand(stream.ReadByte() == -1);
                CopyBoundary(parents, account, name, reader, plan.device, inode, entry.bytes);
                CopyFileBasicInfo after = CopyBasic(reader);
                Demand(before.lastWrite == after.lastWrite && before.change == after.change && before.attributes == after.attributes);
            }
            catch (Exception error) { streamError = error; }
            FinishCopyStreams(stream, null, streamError);
            CloseCopyHandle(reader);
            result = new CopyObservation { relative = entry.relative, directory = false, device = plan.device, inode = inode, bytes = entry.bytes };
        }
        catch (Exception error) { primary = error; }
        FinishCopyHandles(handles, primary);
        return result;
    }
    private static CopyObservation CopyDirectory(CopyPlan plan, CopyEntry entry, string account)
    {
        string name = CopyRelative(plan.stage, entry.relative);
        List<SafeFileHandle> handles = new List<SafeFileHandle>();
        Exception primary = null;
        CopyObservation result = null;
        try
        {
            List<CopyParent> parents = AcquireCopyParents(plan, name, account, handles);
            ProtectedDirectory(name, account);
            SafeFileHandle created = Hold(name, 0x20080); handles.Add(created);
            RecheckCopyParents(parents, account);
            Dictionary<string, object> value = Inspect(name, account, false);
            Demand((bool)value["directory"] && Text(value, "device") == plan.device); CopyHandleFacts(created, name, value);
            string inode = Text(value, "inode"); plan.directories.Add(name, inode);
            result = new CopyObservation { relative = entry.relative, directory = true, device = plan.device, inode = inode, bytes = 0 };
        }
        catch (Exception error) { primary = error; }
        FinishCopyHandles(handles, primary);
        return result;
    }
    private static void CopyReply(Stream stream, List<CopyObservation> facts)
    {
        using (MemoryStream storage = new MemoryStream())
        using (BinaryWriter output = new BinaryWriter(storage, CopyUtf8))
        {
            output.Write(Encoding.ASCII.GetBytes("DCTCPR1\n")); output.Write((uint)facts.Count);
            foreach (CopyObservation fact in facts)
            {
                DctDeploymentWire.Text(output, fact.relative, 8192);
                output.Write(UInt64.Parse(fact.device, CultureInfo.InvariantCulture)); output.Write(UInt64.Parse(fact.inode, CultureInfo.InvariantCulture));
                output.Write((byte)(fact.directory ? 0 : 1)); output.Write(fact.bytes);
            }
            Demand(storage.Length <= 2097152); output.Flush(); storage.Position = 0; storage.CopyTo(stream); stream.Flush();
        }
    }
    public static void Copy(Stream input, Stream output)
    {
        Demand(IntPtr.Size == 8);
        using (BinaryReader source = new BinaryReader(input, CopyUtf8))
        {
            // Complete independently bounded header/paths/types/order/parents/arithmetic precedes ANY effects.
            CopyPlan plan = CopyHeader(source);
            using (WindowsIdentity identity = WindowsIdentity.GetCurrent())
            {
                Demand(identity.User != null);
                string account = identity.User.Value;
                List<CopyObservation> created = new List<CopyObservation>();
                foreach (CopyEntry entry in plan.entries)
                    created.Add(entry.directory ? CopyDirectory(plan, entry, account) : CopyFile(plan, entry, account, source));
                created.Add(CopyFile(plan, plan.manifest, account, source));
                Demand(source.BaseStream.ReadByte() == -1); // Trailing input is an effect failure, never a successful publication.
                CopyReply(output, created);
            }
        }
    }
}

public static class DctDeploymentCreateProgram
{
    public static int Main(string[] arguments)
    {
        try
        {
            if (arguments.Length == 1 && arguments[0] == "copy")
            {
                DctDeploymentCreate.Copy(Console.OpenStandardInput(), Console.OpenStandardOutput());
                return 0;
            }
            if (arguments.Length != 1 || arguments[0] != "mutate")
                throw new IOException("Invalid finite deployment mutation request.");
            string[] fields = DctDeploymentWire.Mutation(Console.OpenStandardInput());
            Dictionary<string, object> created = DctDeploymentCreate.Execute(fields[0], fields[1], fields[2], fields[3],
                fields[4], fields[5], fields[6], fields[7]);
            DctDeploymentWire.Facts(Console.OpenStandardOutput(), new Dictionary<string, object>[] { created });
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.ToString()); return 1; }
    }
}
