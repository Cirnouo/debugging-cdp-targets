[CmdletBinding()]
param([Parameter(Mandatory = $true)] [int] $OwnedPid)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -Path (Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
$target = [DctNative]::Inspect($OwnedPid)
try {
    [Console]::Out.WriteLine((@{ event = 'armed'; pid = $target.ProcessId; startedAtUtc = $target.StartedAtUtc; executablePath = $target.ExecutablePath } | ConvertTo-Json -Compress))
    $code = [DctNative]::WaitForExit($target)
    [Console]::Out.WriteLine((@{ event = 'exited'; pid = $target.ProcessId; exitCode = $code } | ConvertTo-Json -Compress))
} finally { $target.Dispose() }
