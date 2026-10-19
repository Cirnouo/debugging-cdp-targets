[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$nativeProcess = $null

function Write-Event {
    param([object] $Value)
    [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 5 -Compress))
}

try {
    $line = [Console]::In.ReadLine()
    if ([string]::IsNullOrEmpty($line) -or $line.Length -gt 65536) { throw 'Invalid fixed watch request.' }
    $request = $line | ConvertFrom-Json
    $watch = $request.action -ceq 'watch-parent'
    if (-not $watch -and $request.action -cne 'inspect-current') { throw 'Invalid fixed watch action.' }
    $names = @($request.PSObject.Properties.Name)
    if ($names.Count -ne $(if ($watch) { 3 } else { 2 }) -or $names -cnotcontains 'processId' -or
        $names -cnotcontains 'action' -or ($watch -and $names -cnotcontains 'parent')) { throw 'Invalid fixed watch fields.' }
    $requestedId = [int] $request.processId
    if ($requestedId -lt 1) { throw 'Invalid watch process identity.' }
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-native-process.cs')
    # Inspect retains QUERY_LIMITED_INFORMATION | SYNCHRONIZE. No Close API is used.
    $nativeProcess = [DctNative]::Inspect($requestedId)
    $evidence = [DctNative]::ParentWatchEvidence($nativeProcess)
    $identity = @{ processId = $nativeProcess.ProcessId; startedAtUtc = $nativeProcess.StartedAtUtc;
        executablePath = $nativeProcess.ExecutablePath }
    if ($watch) {
        $parentNames = @($request.parent.PSObject.Properties.Name)
        if ($parentNames.Count -ne 3 -or $parentNames -cnotcontains 'processId' -or
            $parentNames -cnotcontains 'startedAtUtc' -or $parentNames -cnotcontains 'executablePath' -or
            $request.parent.processId -ne $identity.processId -or
            $request.parent.startedAtUtc -cne $identity.startedAtUtc -or
            $request.parent.executablePath -cne $identity.executablePath) { throw 'Exact read-only parent identity changed.' }
        [DctNative]::BeginCancellation()
        if ([DctNative]::Cancelled) { throw 'Read-only parent observation cancelled.' }
    }
    $evidence.event = 'parent-native-ready-v1'
    $evidence.identity = $identity
    Write-Event $evidence
    if ($watch) {
        # Null is cancellation, never a successful or artificial exit status.
        $actualExitCode = [DctNative]::WaitForExit($nativeProcess)
        if ($null -eq $actualExitCode) { throw 'Read-only parent observation cancelled.' }
        Write-Event @{ event = 'parent-exited-v1'; processId = $identity.processId;
            startedAtUtc = $identity.startedAtUtc; executablePath = $identity.executablePath;
            processExited = $true; waitResult = 0; waitError = 0; exitCode = $actualExitCode }
    }
}
catch {
    Write-Event @{ event = 'parent-observation-failed-v1' }
}
finally {
    if ($null -ne $nativeProcess) { $nativeProcess.Dispose() }
}
