[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [int] $OwnedPid,
    [ValidateSet('root', 'middle', 'late')] [string] $Role = 'root',
    [string] $NativeAssembly
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$target = $null
$phase = 'load'
$failed = $false
function Write-Phase([string] $Value) {
    [Console]::Out.WriteLine((@{ event = 'phase'; role = $Role; pid = $OwnedPid; phase = $Value } | ConvertTo-Json -Compress))
}
function Write-Failure([Exception] $Exception) {
    $win32Code = $null
    $hresult = $null
    $current = $Exception
    for ($depth = 0; $depth -lt 4 -and $null -ne $current; $depth++) {
        $hresult = [int] $current.HResult
        if ($current -is [ComponentModel.Win32Exception]) {
            $win32Code = [int] $current.NativeErrorCode
            break
        }
        $current = $current.InnerException
    }
    $kind = 'unexpected'
    if ($phase -eq 'load') { $kind = 'load' }
    if ($null -ne $win32Code) { $kind = 'native' }
    [Console]::Out.WriteLine((@{ event = 'failed'; role = $Role; pid = $OwnedPid; phase = $phase; errorKind = $kind; win32Code = $win32Code; hresult = $hresult } | ConvertTo-Json -Compress))
}
try {
    # Controlled invalid input never reaches assembly loading or native process inspection.
    if ($OwnedPid -le 0) { $phase = 'inspect'; throw [ArgumentOutOfRangeException]::new('OwnedPid') }
    Write-Phase $phase
    if ([string]::IsNullOrWhiteSpace($NativeAssembly)) { throw [ArgumentException]::new('NativeAssembly is required.') }
    Add-Type -LiteralPath $NativeAssembly
    $phase = 'inspect'
    Write-Phase $phase
    $target = [DctNative]::Inspect($OwnedPid)
    $phase = 'armed'
    Write-Phase $phase
    [Console]::Out.WriteLine((@{ event = 'armed'; role = $Role; pid = $target.ProcessId; startedAtUtc = $target.StartedAtUtc; executablePath = $target.ExecutablePath } | ConvertTo-Json -Compress))
    $phase = 'wait'
    Write-Phase $phase
    $code = [DctNative]::WaitForExit($target)
    $phase = 'exit'
    Write-Phase $phase
    [Console]::Out.WriteLine((@{ event = 'exited'; role = $Role; pid = $target.ProcessId; exitCode = $code } | ConvertTo-Json -Compress))
} catch {
    $failed = $true
    try { Write-Failure $_.Exception } catch { }
} finally {
    if ($null -ne $target) {
        try { $target.Dispose() } catch {
            $failed = $true
            try { Write-Failure $_.Exception } catch { }
        }
    }
}
if ($failed) { exit 1 }
