using System;
using System.Collections;
using System.Diagnostics;
using System.Runtime.InteropServices;

// Deterministic user32 I/O failures only. Process identity and RequestClose run unchanged.
public static class NormalCloseBoundary
{
    public static string Mode;
    public static int Messages, Selected, PidReads, WindowReads, VisibilityReads;
    private static bool disappeared, identityChanged;
    [DllImport("kernel32.dll", EntryPoint = "SetLastError", SetLastError = true)] private static extern void NativeError(uint error);
    public static bool Fail() { NativeError(5); return false; }
    public static bool Enumerate(Func<IntPtr, bool> callback)
    {
        if (Mode == "enumeration-failure") return Fail();
        if (Mode == "foreign-pid") callback(new IntPtr(99));
        callback(new IntPtr(1));
        callback(new IntPtr(2));
        return true;
    }
    public static uint ProcessId(IntPtr window, out uint pid)
    {
        PidReads++;
        pid = (uint)Process.GetCurrentProcess().Id;
        if (window.ToInt64() == 99 || (Mode == "stale-pid" && PidReads >= 3)) pid++;
        if (Mode == "changed-during-selection" && PidReads == 2) pid++;
        if (window.ToInt64() == 1 && identityChanged) pid++;
        if (Mode == "pid-failure") { pid = 0; Fail(); return 0; }
        return 1;
    }
    public static bool Exists(IntPtr window) { WindowReads++; return !(window.ToInt64() == 1 && disappeared) && (Mode != "stale-hwnd" || WindowReads < 3) && (Mode != "lost-during-selection" || WindowReads != 2); }
    public static bool Visible(IntPtr window)
    {
        VisibilityReads++;
        if (window.ToInt64() == 1 && Mode == "lost-while-invisible") { disappeared = true; return false; }
        if (window.ToInt64() == 1 && Mode == "pid-changed-while-invisible") { identityChanged = true; return false; }
        return Mode != "no-candidate" && (Mode != "stale-visible" || VisibilityReads < 2);
    }
    public static bool Enabled(IntPtr window)
    {
        if (window.ToInt64() == 1 && Mode == "lost-while-disabled") { disappeared = true; return false; }
        return true;
    }
    public static long Style(IntPtr window, int index)
    {
        if (Mode == "style-failure") { Fail(); return 0; }
        NativeError(0);
        if (window.ToInt64() == 1 && Mode == "lost-while-child" && index == -16) { disappeared = true; return 0x40000000L; }
        if (window.ToInt64() == 1 && Mode == "lost-while-tool" && index == -20) { disappeared = true; return 0x80L; }
        return Mode == "child" && index == -16 ? 0x40000000L : 0;
    }
    public static IntPtr Owner(IntPtr window)
    {
        NativeError(Mode == "owner-failure" ? 5u : 0u);
        if (window.ToInt64() == 1 && Mode == "lost-while-owned") { disappeared = true; return new IntPtr(3); }
        return IntPtr.Zero;
    }
    public static bool ZeroWidth(IntPtr window)
    {
        if (window.ToInt64() == 1 && Mode == "lost-while-zero-area") { disappeared = true; return true; }
        return Mode == "minimized-zero";
    }
    public static bool Rectangle() { return Mode == "rectangle-failure" ? Fail() : true; }
    public static bool Post(IntPtr window, uint message, IntPtr w, IntPtr l)
    {
        if (message != 0x0010 || w != IntPtr.Zero || l != IntPtr.Zero) throw new Exception("Unexpected native message.");
        Messages++; Selected = checked((int)window.ToInt64()); return true;
    }
    public static Hashtable Run(string mode)
    {
        Mode = mode;
        string failure = null;
        bool requested = false;
        using (Process process = Process.GetCurrentProcess()) {
            try {
                using (DctNativeClose close = DctNative.RequestClose(process.Id, process.MainModule.FileName, process.StartTime.ToUniversalTime().ToString("o")))
                    requested = (bool)close.Evidence["closeRequested"];
            } catch (Exception error) { failure = error.GetType().Name; }
        }
        return new Hashtable { { "messages", Messages }, { "selected", Selected }, { "failure", failure }, { "requested", requested } };
    }
}
