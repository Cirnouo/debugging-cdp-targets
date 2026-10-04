[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [int] $TargetProcessId,
    [Parameter(Mandatory = $true)] [string] $ExecutablePath,
    [Parameter(Mandatory = $true)] [string] $StartedAtUtc,
    [ValidateSet('request', 'inspect')] [string] $Mode = 'request'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -Path (Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
$close = $null
try {
    if ($Mode -eq 'inspect') {
        $elevated = [DctNative]::IsProcessElevated($TargetProcessId)
        $result = @{ threw = $false; elevated = $elevated; nativeError = 0 }
    }
    else {
        # The caller supplies only its newly launched disposable target identity.
        # A failed normal window request leaves the original observer and app alive.
        $close = [DctNative]::RequestClose($TargetProcessId, $ExecutablePath, $StartedAtUtc)
        $result = $close.Evidence
    }
}
catch {
    $failure = $_.Exception
    while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
    if ($failure -isnot [ComponentModel.Win32Exception]) { throw }
    $result = @{ threw = $true; nativeError = $failure.NativeErrorCode; processId = $TargetProcessId }
}
finally { if ($null -ne $close) { $close.Dispose() } }
[Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress))
