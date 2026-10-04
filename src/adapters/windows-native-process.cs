using System;
using System.Collections;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Xml;
using Microsoft.Win32;

// Fixed platform support loaded by windows-native-helper.ps1. No application
// arguments or environment values are placed in a shell command or written to disk.
public sealed class DctNativeProcess : IDisposable
{
    public IntPtr Handle;
    public int ProcessId;
    public string ExecutablePath;
    public string StartedAtUtc;
    public long CreatedTicks;
    public bool Elevated;
    public void Dispose() { if (Handle != IntPtr.Zero) { DctNative.CloseHandle(Handle); Handle = IntPtr.Zero; } }
}

public static class DctNative
{
    private const uint Query = 0x1000;
    private const uint Synchronize = 0x100000;
    private static readonly ManualResetEvent cancelled = new ManualResetEvent(false);
    public static bool Cancelled { get { return cancelled.WaitOne(0); } }

    [DllImport("kernel32.dll", SetLastError = true)] public static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(IntPtr process, int flags, StringBuilder name, ref int length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ProcessIdToSessionId(int processId, out int session);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetProcessId(IntPtr process);
    [StructLayout(LayoutKind.Sequential)]
    private struct SecurityAttributes {
        public int Size; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo {
        public int Size; public string Reserved; public string Desktop; public string Title;
        public uint X; public uint Y; public uint XSize; public uint YSize; public uint XChars; public uint YChars;
        public uint Fill; public uint Flags; public short Show; public short ReservedSize;
        public IntPtr ReservedBytes; public IntPtr Input; public IntPtr Output; public IntPtr Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo Start; public IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr Process; public IntPtr Thread; public int Id; public int ThreadId; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string name, uint access, uint share, ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
        bool inheritHandles, uint flags, IntPtr environment, string cwd, ref StartupInfoEx startup, out ProcessInformation information);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct ShellExecuteInfo {
        public int Size; public uint Mask; public IntPtr Window;
        public string Verb; public string File; public string Parameters; public string Directory;
        public int Show; public IntPtr Instance; public IntPtr ItemList;
        public string Class; public IntPtr ClassKey; public uint HotKey;
        public IntPtr Icon; public IntPtr Process;
    }
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ShellExecuteEx(ref ShellExecuteInfo information);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadLibraryEx(string file, IntPtr reserved, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr FindResource(IntPtr module, IntPtr name, IntPtr type);
    [DllImport("kernel32.dll")] private static extern uint SizeofResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] private static extern IntPtr LoadResource(IntPtr module, IntPtr resource);
    [DllImport("kernel32.dll")] private static extern IntPtr LockResource(IntPtr resource);
    [DllImport("kernel32.dll")] private static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint pid);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int type, out int information, int size, out int needed);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    private static Win32Exception Error() { return new Win32Exception(Marshal.GetLastWin32Error()); }
    public static void BeginCancellation()
    {
        Thread thread = new Thread(delegate() {
            try { while (true) { string line = Console.In.ReadLine(); if (line == null || line == "{\"cancel\":true}") { cancelled.Set(); return; } } }
            catch { cancelled.Set(); }
        });
        thread.IsBackground = true;
        thread.Start();
    }
    public static string Quote(string value)
    {
        StringBuilder output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value)
        {
            if (character == '\\') { slashes++; continue; }
            output.Append('\\', character == '"' ? slashes * 2 + 1 : slashes);
            output.Append(character);
            slashes = 0;
        }
        output.Append('\\', slashes * 2);
        return output.Append('"').ToString();
    }
    private static int TokenInformation(IntPtr process, int type)
    {
        IntPtr token;
        if (!OpenProcessToken(process, 8, out token)) throw Error();
        try { int value, needed; if (!GetTokenInformation(token, type, out value, 4, out needed)) throw Error(); return value; }
        finally { CloseHandle(token); }
    }
    public static bool IsElevated() { return TokenInformation(GetCurrentProcess(), 20) != 0; }
    public static bool IsProcessElevated(int pid)
    {
        IntPtr process = OpenProcess(Query, false, pid);
        if (process == IntPtr.Zero) throw Error();
        try { return TokenInformation(process, 20) != 0; } finally { CloseHandle(process); }
    }
    public static bool NeedsElevation(string executable, string compatibilityLayer)
    {
        if (IsElevated()) return false;
        bool runAs = compatibilityLayer != null && compatibilityLayer.ToUpperInvariant().Contains("RUNASADMIN");
        foreach (RegistryHive hive in new RegistryHive[] { RegistryHive.CurrentUser, RegistryHive.LocalMachine })
        foreach (RegistryView view in new RegistryView[] { RegistryView.Registry64, RegistryView.Registry32 })
        using (RegistryKey root = RegistryKey.OpenBaseKey(hive, view))
        using (RegistryKey layers = root.OpenSubKey(@"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"))
        {
            string setting = layers == null ? null : layers.GetValue(executable) as string;
            if (setting != null && setting.ToUpperInvariant().Contains("RUNASADMIN")) runAs = true;
        }
        byte[] manifest = null;
        IntPtr module = LoadLibraryEx(executable, IntPtr.Zero, 0x22);
        if (module != IntPtr.Zero)
        {
            try {
                for (int id = 1; id <= 3 && manifest == null; id++) {
                    IntPtr resource = FindResource(module, new IntPtr(id), new IntPtr(24));
                    if (resource == IntPtr.Zero) continue;
                    int size = checked((int)SizeofResource(module, resource));
                    if (size <= 0 || size > 1048576) throw new InvalidDataException("Invalid application manifest size.");
                    manifest = new byte[size];
                    Marshal.Copy(LockResource(LoadResource(module, resource)), manifest, 0, size);
                }
            } finally { FreeLibrary(module); }
        }
        if (manifest == null && File.Exists(executable + ".manifest")) manifest = File.ReadAllBytes(executable + ".manifest");
        if (manifest != null) {
            XmlReaderSettings settings = new XmlReaderSettings();
            settings.DtdProcessing = DtdProcessing.Prohibit;
            settings.XmlResolver = null;
            using (MemoryStream stream = new MemoryStream(manifest))
            using (XmlReader reader = XmlReader.Create(stream, settings)) {
                while (reader.Read()) if (reader.NodeType == XmlNodeType.Element && reader.LocalName == "requestedExecutionLevel") {
                    string level = reader.GetAttribute("level");
                    if (level == "requireAdministrator" || (level == "highestAvailable" && TokenInformation(GetCurrentProcess(), 18) == 3)) runAs = true;
                }
            }
        }
        return runAs;
    }
    private static DctNativeProcess Identify(IntPtr handle, int pid, bool elevated)
    {
        long created, exited, kernel, user;
        if (!GetProcessTimes(handle, out created, out exited, out kernel, out user)) throw Error();
        StringBuilder path = new StringBuilder(32768);
        int length = path.Capacity;
        if (!QueryFullProcessImageName(handle, 0, path, ref length)) throw Error();
        DateTime start = DateTime.FromFileTimeUtc(created);
        return new DctNativeProcess { Handle = handle, ProcessId = pid, ExecutablePath = path.ToString(), StartedAtUtc = start.ToString("o"), CreatedTicks = start.Ticks, Elevated = elevated };
    }
    public static DctNativeProcess Inspect(int pid)
    {
        IntPtr handle = OpenProcess(Query | Synchronize, false, pid);
        if (handle == IntPtr.Zero) throw Error();
        try { return Identify(handle, pid, false); } catch { CloseHandle(handle); throw; }
    }
    public static DctNativeProcess ElevateHelper(string executable, string arguments) {
        ShellExecuteInfo information = new ShellExecuteInfo {
            Size = Marshal.SizeOf(typeof(ShellExecuteInfo)), Mask = 0x40 | 0x100 | 0x400,
            Verb = "runas", File = executable, Parameters = arguments, Show = 0
        };
        if (!ShellExecuteEx(ref information)) throw Error();
        try { return Identify(information.Process, checked((int)GetProcessId(information.Process)), true); }
        catch { CloseHandle(information.Process); throw; }
    }
    public static DctNativeProcess Adopt(long handle, int pid, bool elevated) {
        IntPtr native = new IntPtr(handle);
        try { return Identify(native, pid, elevated); } catch { CloseHandle(native); throw; }
    }
    public static DctNativeProcess Launch(string executable, string[] arguments, string cwd, IDictionary environment)
    {
        // Inherit only NUL, never the helper's private protocol or handles. NUL outlives
        // the one-shot elevated creator without drain threads or broken application pipes.
        SecurityAttributes security = new SecurityAttributes { Size = Marshal.SizeOf(typeof(SecurityAttributes)), Inherit = true };
        IntPtr nul = CreateFile("NUL", 0xC0000000, 3, ref security, 3, 0, IntPtr.Zero);
        if (nul == new IntPtr(-1)) throw Error();
        IntPtr attributes = IntPtr.Zero, handles = IntPtr.Zero, block = IntPtr.Zero;
        bool initialized = false;
        bool elevated = IsElevated();
        try {
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref size)) throw Error();
            initialized = true;
            handles = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(handles, nul);
            if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw Error();
            System.Collections.Generic.SortedDictionary<string, string> variables =
                new System.Collections.Generic.SortedDictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (DictionaryEntry variable in environment) variables[(string)variable.Key] = (string)variable.Value;
            StringBuilder environmentText = new StringBuilder();
            foreach (System.Collections.Generic.KeyValuePair<string, string> variable in variables)
                environmentText.Append(variable.Key).Append('=').Append(variable.Value).Append('\0');
            environmentText.Append('\0');
            block = Marshal.StringToHGlobalUni(environmentText.ToString());
            StartupInfoEx startup = new StartupInfoEx {
                Start = new StartupInfo { Size = Marshal.SizeOf(typeof(StartupInfoEx)), Flags = 0x100, Input = nul, Output = nul, Error = nul },
                Attributes = attributes
            };
            ProcessInformation process;
            StringBuilder command = new StringBuilder(Quote(executable) + " " + String.Join(" ", Array.ConvertAll(arguments, Quote)));
            // CREATE_NO_WINDOW suppresses console allocation without hiding GUI windows.
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080400, block, cwd, ref startup, out process)) throw Error();
            CloseHandle(process.Thread);
            // Keep the original process handle, never a helper PID or a reopened application.
            try { return Identify(process.Process, process.Id, elevated); }
            catch {
                long created, exited, kernel, user;
                if (!GetProcessTimes(process.Process, out created, out exited, out kernel, out user)) { CloseHandle(process.Process); throw Error(); }
                DateTime started = DateTime.FromFileTimeUtc(created);
                return new DctNativeProcess { Handle = process.Process, ProcessId = process.Id, ExecutablePath = executable,
                    StartedAtUtc = started.ToString("o"), CreatedTicks = started.Ticks, Elevated = elevated };
            }
        } finally {
            if (block != IntPtr.Zero) Marshal.FreeHGlobal(block);
            if (initialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            CloseHandle(nul);
        }
    }
    public static long DuplicateTo(DctNativeProcess process, int monitorPid)
    {
        IntPtr monitor = OpenProcess(0x40, false, monitorPid);
        if (monitor == IntPtr.Zero) throw Error();
        try { IntPtr handle; if (!DuplicateHandle(GetCurrentProcess(), process.Handle, monitor, out handle, Query | Synchronize, false, 0)) throw Error(); return handle.ToInt64(); }
        finally { CloseHandle(monitor); }
    }
    public static int WaitForExit(DctNativeProcess process)
    {
        // An OS process handle supplies exit evidence. No process/listener polling.
        using (EventWaitHandle target = new EventWaitHandle(false, EventResetMode.ManualReset)) {
            target.SafeWaitHandle = new Microsoft.Win32.SafeHandles.SafeWaitHandle(process.Handle, false);
            if (WaitHandle.WaitAny(new WaitHandle[] { target, cancelled }) != 0) return Int32.MinValue;
        }
        uint code;
        if (!GetExitCodeProcess(process.Handle, out code)) throw Error();
        return unchecked((int)code);
    }
    public static NamedPipeServerStream CreatePipe(string name)
    {
        PipeSecurity security = new PipeSecurity();
        security.SetAccessRuleProtection(true, false);
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid, null), PipeAccessRights.FullControl, AccessControlType.Deny));
        security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User, PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
        return new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous, 4096, 4096, security);
    }
    public static void VerifyPeer(PipeStream pipe, int expectedPid, long expectedCreatedTicks, bool server)
    {
        uint pid;
        bool ok = server ? GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out pid) : GetNamedPipeServerProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out pid);
        if (!ok) throw Error();
        if (pid != expectedPid) throw new InvalidDataException("Unexpected native helper peer.");
        using (DctNativeProcess peer = Inspect(expectedPid)) if (peer.CreatedTicks != expectedCreatedTicks) throw new InvalidDataException("Native helper peer identity changed.");
    }
    public static Hashtable Close(int pid, string executable, string startedAtUtc, int timeoutMilliseconds)
    {
        using (DctNativeProcess target = Inspect(pid)) {
            int targetSession, ownSession;
            if (!ProcessIdToSessionId(pid, out targetSession) || !ProcessIdToSessionId(Process.GetCurrentProcess().Id, out ownSession)) throw Error();
            if (!Path.GetFullPath(executable).Equals(target.ExecutablePath, StringComparison.OrdinalIgnoreCase) ||
                DateTime.Parse(startedAtUtc, null, System.Globalization.DateTimeStyles.RoundtripKind).ToUniversalTime().Ticks != target.CreatedTicks || targetSession != ownSession)
                throw new InvalidDataException("Native close process identity changed.");
            using (Process process = Process.GetProcessById(pid)) {
                IntPtr window = process.MainWindowHandle;
                bool requested = window != IntPtr.Zero && PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero);
                int error = window != IntPtr.Zero && !requested ? Marshal.GetLastWin32Error() : 0;
                bool exited = WaitForSingleObject(target.Handle, requested ? (uint)timeoutMilliseconds : 0) == 0;
                return new Hashtable { { "event", "closed" }, { "closed", exited }, { "processExited", exited }, { "closeRequested", requested }, { "nativeError", error },
                    { "phase", requested ? "wait-exit" : "normal-close" }, { "reason", exited ? "process-exited" : window == IntPtr.Zero ? "no-main-window" : requested ? "application-still-running" : "close-request-rejected" } };
            }
        }
    }
}
