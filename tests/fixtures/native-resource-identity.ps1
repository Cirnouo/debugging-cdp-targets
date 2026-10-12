[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string] $Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -Path (Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
Add-Type -TypeDefinition @'
public static class ResourceHandleWitness {
    [System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool GetHandleInformation(System.IntPtr handle, out uint flags);
    [System.Runtime.InteropServices.DllImport("kernelbase.dll", SetLastError = true)]
    public static extern bool CompareObjectHandles(System.IntPtr first, System.IntPtr second);
    public static bool Open(long handle) { uint flags; return GetHandleInformation(new System.IntPtr(handle), out flags); }
    public static bool Same(long first, long second) { return CompareObjectHandles(new System.IntPtr(first), new System.IntPtr(second)); }
}
'@
$identity = [DctNative]::Inspect($PID)
$resources = [DctNative]::CreateResources()
$adopted = $null
$handle = [DctNative]::DuplicateTo($identity, $PID)
$rejected = $false
$active = [DctNative]::QueryActiveProcesses($resources)
try {
    try {
        if ($Mode -eq 'stale-monitor') {
            $borrowed = [DctNative]::PullResourceJob($resources.Job.ToInt64(), $PID, ($identity.CreatedTicks + 1))
            $borrowed.Dispose()
        } else {
            $expectedPid = if ($Mode -eq 'foreign-pid') { $PID + 1 } else { $PID }
            $expectedTime = if ($Mode -eq 'foreign-time') { ([DateTime]::Parse($identity.StartedAtUtc)).AddSeconds(1).ToString('o') } else { $identity.StartedAtUtc }
            $expectedPath = if ($Mode -eq 'foreign-executable') { 'C:/unrelated.exe' } elseif ($Mode -eq 'equivalent-slashes') { $identity.ExecutablePath.Replace('\', '/') } else { $identity.ExecutablePath }
            $adopted = [DctNative]::Adopt($handle, $expectedPid, $expectedPath, $expectedTime, $false, $resources)
            if ($Mode -eq 'foreign-job') { [DctNative]::VerifyResources($adopted) }
            if ($Mode -eq 'local-dispose') { $adopted.Dispose() }
        }
    } catch { $rejected = $true }
    $duplicateOpen = [ResourceHandleWitness]::Same($handle, $identity.Handle.ToInt64())
    $originalOpen = [ResourceHandleWitness]::Open($identity.Handle.ToInt64())
    [Console]::Out.WriteLine((@{ rejected = $rejected; duplicateOpen = $duplicateOpen; originalOpen = $originalOpen; active = $active } | ConvertTo-Json -Compress))
} finally {
    if ($null -ne $adopted) { $adopted.Dispose() }
    elseif ([ResourceHandleWitness]::Same($handle, $identity.Handle.ToInt64())) { $null = [DctNative]::CloseHandle([IntPtr]::new($handle)) }
    $resources.Dispose()
    $identity.Dispose()
}
