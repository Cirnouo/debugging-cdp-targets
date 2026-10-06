using System;
using System.IO;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Principal;
using System.Text;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class NativeWindowFixture
{
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string text, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool SetKernelObjectSecurity(IntPtr handle, uint information, IntPtr descriptor);
    private static void RestrictOwnProcessQuery()
    {
        if (Environment.GetEnvironmentVariable("DCT_TEST_DENY_MEDIUM_QUERY") != "true") return;
        IntPtr descriptor;
        uint size;
        if (!ConvertStringSecurityDescriptorToSecurityDescriptor("D:(A;;0x001FFFFF;;;BA)(A;;0x001FFFFF;;;SY)", 1, out descriptor, out size))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            // Restrict only this disposable elevated process object's DACL.
            // Admins and SYSTEM retain access; no file, user or global ACL changes.
            if (!SetKernelObjectSecurity(GetCurrentProcess(), 0x4, descriptor))
                throw new Win32Exception(Marshal.GetLastWin32Error());
        } finally { LocalFree(descriptor); }
    }
    private static TcpListener StartDiscovery()
    {
        int port;
        if (!Int32.TryParse(Environment.GetEnvironmentVariable("DCT_TEST_CDP_PORT"), out port)) return null;
        TcpListener listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();
        System.Threading.Thread thread = new System.Threading.Thread(delegate() {
            while (true) {
                try {
                    using (TcpClient client = listener.AcceptTcpClient())
                    using (NetworkStream stream = client.GetStream()) {
                        client.ReceiveTimeout = 1000;
                        byte[] request = new byte[8192];
                        int length = stream.Read(request, 0, request.Length);
                        if (length == 0) continue;
                        // A controlled discovery endpoint only; it does not implement browser tools.
                        string body = "{\"Browser\":\"DCTFixture/1.0\",\"webSocketDebuggerUrl\":\"ws://127.0.0.1:" + port + "/devtools/browser/disposable-native\"}";
                        byte[] response = Encoding.ASCII.GetBytes("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: " + body.Length + "\r\n\r\n" + body);
                        stream.Write(response, 0, response.Length);
                    }
                } catch (SocketException) { return; }
                catch (IOException) { }
            }
        });
        thread.IsBackground = true;
        thread.Start();
        return listener;
    }
    [STAThread]
    public static void Main(string[] arguments)
    {
        if (arguments.Length != 1) return;
        RestrictOwnProcessQuery();
        string marker = arguments[0];
        TcpListener discovery = StartDiscovery();
        using (Form window = new Form())
        using (Timer expiry = new Timer())
        using (Timer closeDelay = new Timer())
        {
            window.Text = Environment.GetEnvironmentVariable("DCT_TEST_WINDOW_TITLE") ?? "DCT disposable native launch test";
            window.Width = 320;
            window.Height = 120;
            int x, y, width, height;
            if (Int32.TryParse(Environment.GetEnvironmentVariable("DCT_TEST_WINDOW_X"), out x) &&
                Int32.TryParse(Environment.GetEnvironmentVariable("DCT_TEST_WINDOW_Y"), out y) &&
                Int32.TryParse(Environment.GetEnvironmentVariable("DCT_TEST_WINDOW_WIDTH"), out width) &&
                Int32.TryParse(Environment.GetEnvironmentVariable("DCT_TEST_WINDOW_HEIGHT"), out height) && width > 0 && height > 0) {
                window.StartPosition = FormStartPosition.Manual;
                window.Bounds = new System.Drawing.Rectangle(x, y, width, height);
                window.Opacity = 1.0;
            }
            window.Shown += delegate {
                File.WriteAllText(marker, Convert.ToBase64String(Encoding.UTF8.GetBytes(Environment.GetEnvironmentVariable("DCT_TEST_NATIVE") ?? "")));
                File.WriteAllText(marker + ".elevated", new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator) ? "true" : "false");
                File.WriteAllText(marker + ".pid", Process.GetCurrentProcess().Id.ToString());
                if (Environment.GetEnvironmentVariable("DCT_TEST_WINDOW_NO_EXPIRY") != "true") expiry.Start();
            };
            window.FormClosed += delegate { File.WriteAllText(marker + ".closed", "normal-close"); };
            int delay;
            if (Int32.TryParse(Environment.GetEnvironmentVariable("DCT_TEST_CLOSE_DELAY_MS"), out delay) && delay > 0 && delay <= 30000) {
                bool delayStarted = false, delayFinished = false;
                closeDelay.Interval = delay;
                window.FormClosing += delegate(object sender, FormClosingEventArgs request) {
                    if (delayFinished) return;
                    request.Cancel = true;
                    if (!delayStarted) { delayStarted = true; closeDelay.Start(); }
                };
                closeDelay.Tick += delegate { closeDelay.Stop(); delayFinished = true; window.Close(); };
            }
            int lifetime;
            expiry.Interval = Int32.TryParse(Environment.GetEnvironmentVariable("DCT_TEST_WINDOW_LIFETIME_MS"), out lifetime) && lifetime > 0 && lifetime <= 120000 ? lifetime : 15000;
            expiry.Tick += delegate { window.Close(); };
            try { Application.Run(window); }
            finally { if (discovery != null) discovery.Stop(); }
        }
    }
}
