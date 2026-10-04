[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
# Reproduce .NET MainModule denial while limited-query inspection of this
# disposable process remains available. No elevation or user process is needed.
function Get-Process {
    [CmdletBinding()]
    param()
    $result = [pscustomobject]@{ Id = $PID; SessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId }
    $result | Add-Member -MemberType ScriptProperty -Name Path -Value { throw [ComponentModel.Win32Exception]::new(5) }
    return $result
}
& (Join-Path $PSScriptRoot '../../src/adapters/windows-cdp-helper.ps1') -Action Snapshot -RootProcessId $PID -Port 65431
