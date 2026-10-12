[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string] $Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs'))
$bodies = @{
    QueryInformationJobObject = 'information = new JobAccounting { ActiveProcesses = ResourceBoundary.Active() }; return ResourceBoundary.Query();'
    GetQueuedCompletionStatus = 'bytes = 4; key = new IntPtr(ResourceBoundary.Mode == "foreign-key" ? 2 : 1); overlapped = ResourceBoundary.Mode == "invalid-timeout" ? new IntPtr(9) : IntPtr.Zero; bool result = ResourceBoundary.Wake(); if ((ResourceBoundary.Mode == "cancel" && ResourceBoundary.Waits == 2) || ResourceBoundary.Mode == "acquisition-cancelled") { cancelled.Set(); ResourceBoundary.TimeoutError(); } return result;'
}
foreach ($name in $bodies.Keys) {
    $pattern = '\[DllImport\("kernel32.dll"[^\r\n]*\)\] private static extern ([^\r\n]+\b' + $name + '\([^;\r\n]*\));'
    $matches = [Text.RegularExpressions.Regex]::Matches($source, $pattern)
    if ($matches.Count -ne 1) { throw ('Native resource I/O declaration unavailable: ' + $name) }
    $replacement = 'private static ' + $matches[0].Groups[1].Value + ' { ' + $bodies[$name] + ' }'
    $source = [Text.RegularExpressions.Regex]::Replace($source, $pattern, [Text.RegularExpressions.MatchEvaluator] { param($match) $replacement })
}
$boundary = @'
public static class ResourceBoundary {
    public static string Mode;
    public static int Queries, Waits;
    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)] private static extern void SetLastError(uint error);
    public static void TimeoutError() { SetLastError(258); }
    public static uint Active() {
        Queries++;
        if (Mode == "zero-notification") return Queries < 3 ? 1U : 0U;
        if (Mode == "missing-notification") return Queries < 2 ? 1U : 0U;
        if (Mode == "acquisition-cancelled") return Queries < 3 ? 1U : 0U;
        if (Mode == "foreign-key") return Queries < 2 ? 1U : 0U;
        return 1;
    }
    public static bool Query() {
        if (Mode == "query-error") { SetLastError(5); return false; }
        return true;
    }
    public static bool Wake() {
        Waits++;
        if (Mode == "zero-notification" || Mode == "foreign-key") return true;
        SetLastError(Mode == "port-error" ? 6U : 258U);
        return false;
    }
    public static System.Collections.Hashtable Run(string mode) {
        Mode = mode;
        DctNativeProcess process = new DctNativeProcess { Resources = new DctNativeResources { Job = new System.IntPtr(41), Port = new System.IntPtr(42) } };
        bool closed = false;
        int error = 0;
        try { closed = Mode == "acquisition-cancelled" ? DctNative.SettleResourceAcquisition(process.Resources) : DctNative.WaitForResourcesClosed(process); }
        catch (System.ComponentModel.Win32Exception failure) { error = failure.NativeErrorCode; }
        catch (System.InvalidOperationException) { error = -1; }
        return new System.Collections.Hashtable { { "closed", closed }, { "error", error }, { "queries", Queries }, { "waits", Waits } };
    }
}
'@
Add-Type -TypeDefinition ($source + $boundary) -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
[Console]::Out.WriteLine(([ResourceBoundary]::Run($Mode) | ConvertTo-Json -Compress))
