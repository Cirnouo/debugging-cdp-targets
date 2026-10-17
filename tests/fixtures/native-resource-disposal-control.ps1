[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Directory,
    [Parameter(Mandatory = $true)] [int] $CreatorPid,
    [ValidateSet('writer', 'reader', 'pipe', 'target', 'resources', 'none')] [string] $FailAt
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'native-resource-dispose.ps1')
$observed = [Collections.Generic.List[string]]::new()
$primary = [InvalidOperationException]::new('controlled primary')
$cleanup = [IO.IOException]::new('controlled cleanup')
$creator = [Diagnostics.Process]::GetProcessById($CreatorPid)
$null = $creator.Handle
$state = @{ creatorExit = $null }
$actions = @()
foreach ($name in @('writer', 'reader', 'pipe', 'target', 'resources')) {
    $actions += {
        $observed.Add($name)
        if ($name -eq 'pipe') { [IO.File]::WriteAllText((Join-Path $Directory 'pipe-closed'), 'closed') }
        if ($name -eq $FailAt) { throw $cleanup }
    }.GetNewClosure()
}
$actions += {
    $creator.WaitForExit()
    $state.creatorExit = $creator.ExitCode
    $observed.Add('join')
    $creator.Dispose()
}.GetNewClosure()
$actions += { $observed.Add('creator-identity') }.GetNewClosure()
$failure = $null
try { Invoke-NativeResourceDisposal -Actions $actions -Primary $primary }
catch { $failure = $_.Exception }
$primaryPreserved = $false
$cleanupPreserved = $false
$count = 0
if ($failure -is [AggregateException]) {
    foreach ($cleanupFailure in $failure.InnerExceptions) {
        if ([object]::ReferenceEquals($cleanupFailure, $primary)) { $primaryPreserved = $true }
        if ([object]::ReferenceEquals($cleanupFailure, $cleanup)) { $cleanupPreserved = $true; $count++ }
    }
}
[Console]::Out.WriteLine((@{ actions = $observed.ToArray(); creatorExit = $state.creatorExit; primaryPreserved = $primaryPreserved; cleanupPreserved = $cleanupPreserved; cleanupFailures = $count } | ConvertTo-Json -Compress))
