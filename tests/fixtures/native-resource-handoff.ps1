[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Directory,
    [Parameter(Mandatory = $true)] [string] $NodePath,
    [Parameter(Mandatory = $true)] [string] $NativeAssembly,
    [switch] $Creator,
    [switch] $ReceiverExit,
    [switch] $LostPacket,
    [string] $PipeName,
    [int] $MonitorPid,
    [long] $MonitorTicks
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'native-resource-dispose.ps1')
Add-Type -LiteralPath $NativeAssembly
$resources = $null
$target = $null
$reader = $null
$writer = $null
$pipe = $null
$helper = $null
$creatorIdentity = $null
$primary = $null
try {
    if ($Creator) {
        $pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::Asynchronous)
        $pipe.Connect(10000)
        [DctNative]::VerifyPeer($pipe, $MonitorPid, $MonitorTicks, $false)
        $reader = [IO.StreamReader]::new($pipe)
        $writer = [IO.StreamWriter]::new($pipe)
        $writer.AutoFlush = $true
        $request = $reader.ReadLine() | ConvertFrom-Json
        $resources = [DctNative]::PullResourceJob([long] $request.job, $MonitorPid, $MonitorTicks)
        $queryError = 0
        try { $null = [DctNative]::QueryActiveProcesses($resources) }
        catch {
            $failure = $_.Exception
            while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }
            if ($failure -is [ComponentModel.Win32Exception]) { $queryError = $failure.NativeErrorCode } else { throw }
        }
        $environment = @{}
        foreach ($variable in [Environment]::GetEnvironmentVariables().GetEnumerator()) { $environment[$variable.Key] = $variable.Value }
        $fixture = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'native-resource-child.ts'))
        $target = [DctNative]::Launch($NodePath, [string[]] @($fixture, 'root', $Directory), $Directory, $environment, $resources)
        if ($LostPacket) { return }
        $handle = [DctNative]::DuplicateTo($target, $MonitorPid)
        $writer.WriteLine((@{ pid = $target.ProcessId; started = $target.StartedAtUtc; handle = $handle; queryError = $queryError } | ConvertTo-Json -Compress))
        if ($reader.ReadLine() -ne 'observed' -and -not $ReceiverExit) { throw 'Missing monitor acknowledgment.' }
    } else {
        $resources = [DctNative]::CreateResources()
        $identity = [DctNative]::Inspect($PID)
        try { $ticks = $identity.CreatedTicks } finally { $identity.Dispose() }
        $name = 'dct-native-' + [Guid]::NewGuid().ToString('N')
        $pipe = [DctNative]::CreatePipe($name)
        $connected = $pipe.WaitForConnectionAsync()
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) 'WindowsPowerShell/v1.0/powershell.exe'
        $start.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + [DctNative]::Quote($PSCommandPath) + ' -Creator -Directory ' + [DctNative]::Quote($Directory) + ' -NodePath ' + [DctNative]::Quote($NodePath) + ' -NativeAssembly ' + [DctNative]::Quote($NativeAssembly) + ' -PipeName ' + $name + ' -MonitorPid ' + $PID + ' -MonitorTicks ' + $ticks
        if ($ReceiverExit) { $start.Arguments += ' -ReceiverExit' }
        if ($LostPacket) { $start.Arguments += ' -LostPacket' }
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $helper = [Diagnostics.Process]::Start($start)
        if (-not $connected.Wait(10000)) { throw 'Creator connection failed.' }
        $creatorIdentity = [DctNative]::Inspect($helper.Id)
        [DctNative]::VerifyPeer($pipe, $helper.Id, $creatorIdentity.CreatedTicks, $true)
        $reader = [IO.StreamReader]::new($pipe)
        $writer = [IO.StreamWriter]::new($pipe)
        $writer.AutoFlush = $true
        $writer.WriteLine((@{ job = $resources.Job.ToInt64() } | ConvertTo-Json -Compress))
        $replyText = $reader.ReadLine()
        if ($LostPacket) {
            [DctNative]::WaitForAcquisitionExit($creatorIdentity)
            $settled = [DctNative]::SettleResourceAcquisition($resources)
            if (-not $settled) { throw 'Acquisition resource proof unavailable.' }
            [Console]::Out.WriteLine((@{ event = 'acquisition-settled'; applicationMayExist = $false; creationPending = $false } | ConvertTo-Json -Compress))
            return
        }
        $reply = $replyText | ConvertFrom-Json
        if ($ReceiverExit) {
            # The unread/unadopted remote duplicate is reclaimed by this monitor's
            # natural process exit, never by a creator closing a remote slot.
            [Console]::Out.WriteLine((@{ receiverPid = $PID; received = $true } | ConvertTo-Json -Compress))
            return
        }
        $target = [DctNative]::Adopt([long] $reply.handle, [int] $reply.pid, $NodePath, [string] $reply.started, $false, $resources)
        [DctNative]::VerifyResources($target)
        $writer.WriteLine('observed')
        $helper.WaitForExit()
        $rootExit = [DctNative]::WaitForExit($target)
        [IO.File]::WriteAllText((Join-Path $Directory 'handoff-root-exited'), [string] $rootExit)
        $closed = [DctNative]::WaitForResourcesClosed($target)
        [Console]::Out.WriteLine((@{ rootExit = $rootExit; closed = $closed; active = [DctNative]::QueryActiveProcesses($resources); creatorQueryError = $reply.queryError; creatorExit = $helper.ExitCode } | ConvertTo-Json -Compress))
    }
} catch {
    $primary = $_.Exception
    throw
} finally {
    Invoke-NativeResourceDisposal -Primary $primary -Actions @(
        { if ($null -ne $writer) { $writer.Dispose() } },
        { if ($null -ne $reader) { $reader.Dispose() } },
        { if ($null -ne $pipe) { $pipe.Dispose() } },
        { if ($null -ne $target) { $target.Dispose() } },
        { if ($null -ne $resources) { $resources.Dispose() } },
        {
            # All pipe disposals are attempted before joining a creator awaiting acknowledgment.
            # This protects DLL lifetime; independent app exit receipts remain required.
            if ($null -ne $helper) {
                try { $helper.WaitForExit() } finally { $helper.Dispose() }
            }
        },
        { if ($null -ne $creatorIdentity) { $creatorIdentity.Dispose() } }
    )
}
