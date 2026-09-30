param([string] $StopFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Collections.Generic;
public static class ConsoleWindowSampler {
    public delegate bool Callback(IntPtr handle, IntPtr data);
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr handle, StringBuilder text, int length);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr handle, StringBuilder text, int length);
    public static string[] Sample() {
        var result = new List<string>();
        EnumWindows((handle, data) => {
            if (!IsWindowVisible(handle)) return true;
            var title = new StringBuilder(512);
            var type = new StringBuilder(256);
            GetWindowText(handle, title, title.Capacity);
            GetClassName(handle, type, type.Capacity);
            if (type.ToString().Contains("ConsoleWindowClass") || type.ToString().Contains("CASCADIA") || title.ToString().ToLowerInvariant().Contains("chrome-devtool"))
                result.Add(handle.ToString() + "|" + type + "|" + title);
            return true;
        }, IntPtr.Zero);
        return result.ToArray();
    }
}
'@
$baseline = @([ConsoleWindowSampler]::Sample())
$seen = [Collections.Generic.HashSet[string]]::new()
[Console]::Out.WriteLine('{"ready":true}')
$watch = [Diagnostics.Stopwatch]::StartNew()
$samples = 0
while (-not (Test-Path -LiteralPath $StopFile) -and $watch.Elapsed.TotalSeconds -lt 120) {
    foreach ($window in [ConsoleWindowSampler]::Sample()) {
        if ($window -notin $baseline) { [void] $seen.Add($window) }
    }
    $samples += 1
    Start-Sleep -Milliseconds 20
}
[ordered]@{ samples = $samples; newlyVisibleConsoles = @($seen) } | ConvertTo-Json -Compress
