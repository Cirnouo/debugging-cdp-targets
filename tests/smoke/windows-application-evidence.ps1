[CmdletBinding()]
param(
    [ValidateSet('Inspect', 'Titles', 'Witness')] [string] $Mode = 'Inspect',
    [int] $ApplicationPid = 0,
    [string] $ExecutablePath = '',
    [string] $StartedAtUtc = '',
    [string] $IdentitiesJson = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -Path (Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
Add-Type @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class DctApplicationEvidence {
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr process, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetProcessTimes(IntPtr process, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder path, ref uint length);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CommandLineToArgvW(string command, out int count);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr pointer);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int type, out int value, int length, out int needed);
    public delegate bool Visitor(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool EnumWindows(Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, StringBuilder value, int count);
    public static void Guard(IntPtr handle, string executable, string created) {
        long time, exited, kernel, user; uint length = 32768; StringBuilder actual = new StringBuilder((int)length);
        if (WaitForSingleObject(handle, 0) != 258 || !GetProcessTimes(handle, out time, out exited, out kernel, out user) || DateTime.FromFileTimeUtc(time).Ticks != DateTimeOffset.Parse(created).UtcTicks)
            throw new InvalidOperationException("Owned process creation identity changed or exited.");
        if (!QueryFullProcessImageName(handle, 0, actual, ref length) || !String.Equals(Path.GetFullPath(actual.ToString()), Path.GetFullPath(executable), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Owned process executable identity changed.");
    }
    public static string[] Arguments(string command) {
        int count; IntPtr pointer = CommandLineToArgvW(command, out count);
        if (pointer == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { string[] result = new string[count]; for (int i = 0; i < count; i++) result[i] = Marshal.PtrToStringUni(Marshal.ReadIntPtr(pointer, i * IntPtr.Size)); return result; }
        finally { LocalFree(pointer); }
    }
    public static bool Elevated(IntPtr handle) {
        IntPtr token; if (!OpenProcessToken(handle, 8, out token)) throw new Win32Exception(Marshal.GetLastWin32Error());
        try { int value, needed; if (!GetTokenInformation(token, 20, out value, 4, out needed)) throw new Win32Exception(Marshal.GetLastWin32Error()); return value != 0; }
        finally { CloseHandle(token); }
    }
    public static object[] Titles(int owned) {
        List<object> result = new List<object>();
        EnumWindows(delegate(IntPtr window, IntPtr unused) { int pid; GetWindowThreadProcessId(window, out pid); if (pid == owned) { StringBuilder title = new StringBuilder(32768); GetWindowText(window, title, title.Capacity); result.Add(new { handle = window.ToInt64(), title = title.ToString() }); } return true; }, IntPtr.Zero);
        return result.ToArray();
    }
    public static object Exit(IntPtr handle, int processId, string executablePath, string startedAtUtc, uint timeout) {
        uint waited = WaitForSingleObject(handle, timeout);
        int error = waited == UInt32.MaxValue ? Marshal.GetLastWin32Error() : 0;
        uint code = 259; bool got = waited == 0 && GetExitCodeProcess(handle, out code);
        return new { processId, executablePath, startedAtUtc, identityVerified = true, processExited = got, waitResult = waited, waitError = error, exitCode = got ? (long?)code : null };
    }
}
'@
if ($Mode -eq 'Witness') {
    $owned = [Collections.Generic.List[object]]::new()
    try {
        $identities = @($IdentitiesJson | ConvertFrom-Json)
        if ($identities.Count -eq 0) { throw 'Witness requires at least one owned process.' }
        foreach ($identity in $identities) {
            $process = [DctNative]::Inspect([int]$identity.processId)
            $owned.Add($process)
            [DctApplicationEvidence]::Guard($process.Handle, [string]$identity.executablePath, [string]$identity.startedAtUtc)
        }
        @{ event = 'armed'; identities = $identities; identityVerified = $true } | ConvertTo-Json -Depth 6 -Compress
        if ([Console]::ReadLine() -ne 'observe') { throw 'Passive witness observation was cancelled.' }
        $clock = [Diagnostics.Stopwatch]::StartNew()
        $receipts = @($owned | ForEach-Object { [DctApplicationEvidence]::Exit($_.Handle, $_.ProcessId, $_.ExecutablePath, $_.StartedAtUtc, [uint32][Math]::Max(0, 10000 - $clock.ElapsedMilliseconds)) })
        @{ event = 'observed'; receipts = $receipts } | ConvertTo-Json -Depth 6 -Compress
    }
    finally { foreach ($process in $owned) { $process.Dispose() } }
    return
}
$application = [DctNative]::Inspect($ApplicationPid)
try {
    [DctApplicationEvidence]::Guard($application.Handle, $ExecutablePath, $StartedAtUtc)
    if ($Mode -eq 'Titles') {
        $titles = [DctApplicationEvidence]::Titles($ApplicationPid)
        [DctApplicationEvidence]::Guard($application.Handle, $ExecutablePath, $StartedAtUtc)
        ConvertTo-Json -InputObject @($titles) -Depth 4 -Compress
        return
    }
    $cim = Get-CimInstance Win32_Process -Filter "ProcessId = $ApplicationPid"
    if (!$cim -or !$cim.CommandLine -or !$cim.ExecutablePath -or !$cim.CreationDate) { throw 'Owned process CIM identity/argv is unavailable.' }
    $creationDifference = $application.CreatedTicks - $cim.CreationDate.ToUniversalTime().Ticks
    if ($cim.ProcessId -ne $ApplicationPid -or ![string]::Equals([IO.Path]::GetFullPath($cim.ExecutablePath), [IO.Path]::GetFullPath($application.ExecutablePath), [StringComparison]::OrdinalIgnoreCase) -or $creationDifference -lt 0 -or $creationDifference -gt 9) { throw 'CIM identity differs from the opened native process.' }
    $version = [Diagnostics.FileVersionInfo]::GetVersionInfo($application.ExecutablePath)
    $digest = (Get-FileHash -LiteralPath $application.ExecutablePath -Algorithm SHA256).Hash.ToLowerInvariant()
    $elevated = [DctApplicationEvidence]::Elevated($application.Handle)
    [DctApplicationEvidence]::Guard($application.Handle, $ExecutablePath, $StartedAtUtc)
    @{
        identity = @{ processId = $ApplicationPid; executablePath = $application.ExecutablePath; startedAtUtc = $application.StartedAtUtc }
        commandLine = [string]$cim.CommandLine
        argv = @([DctApplicationEvidence]::Arguments([string]$cim.CommandLine))
        file = @{ sha256 = $digest; fileVersion = [string]$version.FileVersion; productVersion = [string]$version.ProductVersion }
        elevated = $elevated
        identityVerifiedBefore = $true
        identityVerifiedAfter = $true
    } | ConvertTo-Json -Depth 6 -Compress
}
finally { $application.Dispose() }
