using System;
using System.IO;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Principal;
using System.Text;
using System.Windows.Forms;

public static class NativeWindowFixture
{
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
        string marker = arguments[0];
        TcpListener discovery = StartDiscovery();
        using (Form window = new Form())
        using (Timer expiry = new Timer())
        {
            window.Text = "DCT disposable native launch test";
            window.Width = 320;
            window.Height = 120;
            window.Shown += delegate {
                File.WriteAllText(marker, Convert.ToBase64String(Encoding.UTF8.GetBytes(Environment.GetEnvironmentVariable("DCT_TEST_NATIVE") ?? "")));
                File.WriteAllText(marker + ".elevated", new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator) ? "true" : "false");
                File.WriteAllText(marker + ".pid", Process.GetCurrentProcess().Id.ToString());
                expiry.Start();
            };
            window.FormClosed += delegate { File.WriteAllText(marker + ".closed", "normal-close"); };
            int lifetime;
            expiry.Interval = Int32.TryParse(Environment.GetEnvironmentVariable("DCT_TEST_WINDOW_LIFETIME_MS"), out lifetime) && lifetime > 0 && lifetime <= 120000 ? lifetime : 15000;
            expiry.Tick += delegate { window.Close(); };
            try { Application.Run(window); }
            finally { if (discovery != null) discovery.Stop(); }
        }
    }
}
