using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

// Owned raw Win32 windows reproduce an event-loop target independently of WinForms.
public static class NormalCloseWindowFixture
{
    private delegate IntPtr WindowProcedure(IntPtr window, uint message, IntPtr w, IntPtr l);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WindowClass {
        public uint Size, Style; public WindowProcedure Procedure; public int ClassExtra, WindowExtra;
        public IntPtr Instance, Icon, Cursor, Background; public string Menu, Name; public IntPtr SmallIcon;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct Message { public IntPtr Window; public uint Id; public IntPtr W, L; public uint Time; public int X, Y; }
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern ushort RegisterClassEx(ref WindowClass value);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateWindowEx(uint extended, string kind, string title, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] private static extern IntPtr DefWindowProc(IntPtr window, uint message, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] private static extern bool GetMessage(out Message message, IntPtr window, uint min, uint max);
    [DllImport("user32.dll")] private static extern IntPtr DispatchMessage(ref Message message);
    [DllImport("user32.dll")] private static extern void PostQuitMessage(int exit);
    [DllImport("user32.dll")] private static extern bool DestroyWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr window, int state);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll", SetLastError = true)] private static extern UIntPtr SetTimer(IntPtr window, UIntPtr id, uint interval, IntPtr callback);
    [DllImport("user32.dll")] private static extern bool SetLayeredWindowAttributes(IntPtr window, uint key, byte alpha, uint flags);
    private static string marker;
    private static IntPtr main, second;
    private static WindowProcedure procedure = HandleMessage;
    private static IntPtr HandleMessage(IntPtr window, uint message, IntPtr w, IntPtr l)
    {
        if (message == 0x0010) {
            string kind = window == main ? "gui" : window == second ? "second" : "excluded";
            File.AppendAllText(marker + ".closes", kind + "\n");
            if (window == main) { DestroyWindow(window); PostQuitMessage(0); }
            return IntPtr.Zero;
        }
        if (message == 0x0113) { File.WriteAllText(marker + ".expired", "true"); PostQuitMessage(0); return IntPtr.Zero; }
        return DefWindowProc(window, message, w, l);
    }
    private static IntPtr Create(uint extended, uint style, int width, int height, IntPtr owner)
    {
        IntPtr window = CreateWindowEx(extended, "DctOwnedCloseFixture", "", style, 30, 30, width, height, owner, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        if (window == IntPtr.Zero) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        return window;
    }
    private static void OrderFirst(IntPtr window)
    {
        if (!SetWindowPos(window, IntPtr.Zero, 0, 0, 0, 0, 0x13))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    public static void Main(string[] arguments)
    {
        marker = arguments[0];
        try { Run(arguments[1]); }
        catch (Exception error) {
            System.ComponentModel.Win32Exception native = error as System.ComponentModel.Win32Exception;
            File.WriteAllText(marker + ".setup-failed", error.GetType().Name + ":" + (native == null ? 0 : native.NativeErrorCode));
            Environment.ExitCode = 1;
        }
    }
    private static void Run(string mode)
    {
        WindowClass kind = new WindowClass { Size = (uint)Marshal.SizeOf(typeof(WindowClass)), Procedure = procedure, Name = "DctOwnedCloseFixture" };
        if (RegisterClassEx(ref kind) == 0) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        uint extended = mode == "transparent" ? 0x08080020u : 0;
        main = Create(extended, mode == "frameless" ? 0x90000000u : 0x10CF0000u, 320, 120, IntPtr.Zero);
        if (mode == "transparent") SetLayeredWindowAttributes(main, 0, 0, 2);
        if (mode == "minimized") ShowWindow(main, 6);
        if (mode == "multiple") {
            second = Create(0, 0x10CF0000, 320, 120, IntPtr.Zero);
            OrderFirst(main);
        }
        IntPtr excluded = IntPtr.Zero;
        if (mode == "event") excluded = Create(0x800A0, 0x90000000, 0, 0, IntPtr.Zero);
        if (mode == "zero-area") excluded = Create(0, 0x90000000, 0, 0, IntPtr.Zero);
        if (mode == "tool") excluded = Create(0x80, 0x90000000, 200, 100, IntPtr.Zero);
        if (mode == "disabled") excluded = Create(0, 0x98000000, 200, 100, IntPtr.Zero);
        if (mode == "owned") excluded = Create(0, 0x90000000, 200, 100, main);
        if (excluded != IntPtr.Zero) OrderFirst(excluded);
        File.WriteAllText(marker + ".closes", "");
        if (SetTimer(main, new UIntPtr(1), 5000, IntPtr.Zero) == UIntPtr.Zero)
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
        using (Process process = Process.GetCurrentProcess()) {
            File.WriteAllText(marker + ".ready", main.ToInt64() + "\n" + excluded.ToInt64() + "\n" + process.MainWindowHandle.ToInt64());
        }
        Message message;
        while (GetMessage(out message, IntPtr.Zero, 0, 0)) DispatchMessage(ref message);
    }
}
