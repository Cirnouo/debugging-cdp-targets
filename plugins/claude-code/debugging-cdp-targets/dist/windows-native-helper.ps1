[CmdletBinding()]
param(
    [switch] $Elevated,
    [string] $PipeName,
    [int] $MonitorPid,
    [long] $MonitorTicks
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$phase = 'inspecting-permission'
$nativeProcess = $null

function Write-Event {
    param([object] $Value)
    [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 10 -Compress))
}

function Invoke-Launch {
    param([object] $Launch)
    $environment = @{}
    foreach ($variable in $Launch.env.PSObject.Properties) { $environment[$variable.Name] = [string] $variable.Value }
    return [DctNative]::Launch([string] $Launch.executablePath, [string[]] $Launch.arguments, [string] $Launch.cwd, $environment)
}

function Open-Close {
    param([object] $Target)
    return [DctNative]::RequestClose([int] $Target.processId, [string] $Target.executablePath, [string] $Target.startedAtUtc)
}

function Get-NativeError {
    param([Exception] $Failure)
    while ($null -ne $Failure.InnerException) { $Failure = $Failure.InnerException }
    if ($Failure -is [ComponentModel.Win32Exception]) { return $Failure.NativeErrorCode }
    return 0
}

function Invoke-Elevated {
    param([object] $Request)
    Write-Event @{ event = 'phase'; phase = 'awaiting-permission' }
    $name = 'dct-native-' + [Guid]::NewGuid().ToString('N')
    $pipe = [DctNative]::CreatePipe($name)
    $monitor = [DctNative]::Inspect($PID)
    $reader = $null
    $writer = $null
    $child = $null
    try {
        $connected = $pipe.WaitForConnectionAsync()
        $powershell = Join-Path ([Environment]::GetFolderPath([Environment+SpecialFolder]::System)) 'WindowsPowerShell/v1.0/powershell.exe'
        $arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File ' + [DctNative]::Quote($PSCommandPath) +
            ' -Elevated -PipeName ' + $name + ' -MonitorPid ' + $PID + ' -MonitorTicks ' + $monitor.CreatedTicks
        # ShellExecute's runas verb decides whether Windows policy requires a UAC prompt.
        # Only this fixed helper is elevated; its authenticated one-shot pipe carries launch data.
        $child = [DctNative]::ElevateHelper($powershell, $arguments)
        $script:phase = 'permission-handshake'
        if (-not $connected.Wait(30000)) { throw 'The native permission helper did not connect.' }
        [DctNative]::VerifyPeer($pipe, $child.ProcessId, $child.CreatedTicks, $true)
        $script:phase = 'native-operation'
        $encoding = [Text.UTF8Encoding]::new($false)
        $reader = [IO.StreamReader]::new($pipe, $encoding, $false, 4096, $true)
        $writer = [IO.StreamWriter]::new($pipe, $encoding, 4096, $true)
        $writer.AutoFlush = $true
        if ([DctNative]::Cancelled) { $Request = @{ action = 'cancel' } }
        $writer.WriteLine(($Request | ConvertTo-Json -Depth 10 -Compress))
        $reply = $reader.ReadLine()
        if ([string]::IsNullOrEmpty($reply)) { throw 'The native permission helper exited without a result.' }
        $value = $reply | ConvertFrom-Json
        if ($value.event -eq 'close-requested') {
            Write-Event $value
            $script:phase = 'wait-exit'
            $reply = $reader.ReadLine()
            if ([string]::IsNullOrEmpty($reply)) { throw 'Native close observer ended without actual application exit evidence.' }
            $value = $reply | ConvertFrom-Json
        }
        if ($value.event -eq 'created') {
            # Identity arrives before handle transfer. Later failures retain the real target for normal cleanup.
            Write-Event @{ event = 'started'; processId = $value.processId; executablePath = $value.executablePath; startedAtUtc = $value.startedAtUtc; elevated = $true }
            $transfer = $reader.ReadLine() | ConvertFrom-Json
            if ($transfer.event -ne 'handle') { throw 'Native observation handle transfer failed after application creation.' }
            $value | Add-Member -NotePropertyName handle -NotePropertyValue $transfer.handle
            $writer.WriteLine('observed')
        }
        return $value
    }
    finally {
        if ($null -ne $writer) { $writer.Dispose() }
        if ($null -ne $reader) { $reader.Dispose() }
        if ($null -ne $child) { $child.Dispose() }
        $pipe.Dispose()
        $monitor.Dispose()
    }
}

try {
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
    if ($Elevated) {
        if (-not [DctNative]::IsElevated() -or $PipeName -notmatch '^dct-native-[0-9a-f]{32}$') { throw 'Invalid elevated helper invocation.' }
        $pipe = [IO.Pipes.NamedPipeClientStream]::new('.', $PipeName, [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::Asynchronous, [Security.Principal.TokenImpersonationLevel]::Identification)
        $reader = $null
        $writer = $null
        try {
            $pipe.Connect(30000)
            [DctNative]::VerifyPeer($pipe, $MonitorPid, $MonitorTicks, $false)
            $encoding = [Text.UTF8Encoding]::new($false)
            $reader = [IO.StreamReader]::new($pipe, $encoding, $false, 4096, $true)
            $writer = [IO.StreamWriter]::new($pipe, $encoding, 4096, $true)
            $writer.AutoFlush = $true
            try {
                $request = $reader.ReadLine() | ConvertFrom-Json
                if ($request.action -eq 'cancel') { $result = @{ event = 'cancelled' } }
                elseif ($request.action -eq 'launch') {
                    $nativeProcess = Invoke-Launch $request.launch
                    $writer.WriteLine((@{ event = 'created'; processId = $nativeProcess.ProcessId; executablePath = $nativeProcess.ExecutablePath; startedAtUtc = $nativeProcess.StartedAtUtc; elevated = $true } | ConvertTo-Json -Compress))
                    $handle = [DctNative]::DuplicateTo($nativeProcess, $MonitorPid)
                    $writer.WriteLine((@{ event = 'handle'; handle = $handle } | ConvertTo-Json -Compress))
                    $ack = $reader.ReadLineAsync()
                    if (-not $ack.Wait(30000) -or $ack.Result -ne 'observed') { throw 'Native monitor did not acknowledge application identity.' }
                    $result = $null
                }
                elseif ($request.action -eq 'close') {
                    $close = Open-Close $request.target
                    try {
                        $writer.WriteLine(($close.Evidence | ConvertTo-Json -Depth 10 -Compress))
                        $result = [DctNative]::WaitForClose($close)
                    }
                    finally { $close.Dispose() }
                }
                else { throw 'Invalid native operation.' }
            }
            catch {
                $nativeError = Get-NativeError $_.Exception
                if ($null -ne $nativeProcess) {
                    try { $null = [DctNative]::Close($nativeProcess.ProcessId, $nativeProcess.ExecutablePath, $nativeProcess.StartedAtUtc) } catch { }
                }
                $result = @{ event = 'error'; phase = 'launching'; nativeError = $nativeError; category = 'native-operation-failed' }
            }
            if ($null -ne $result) { $writer.WriteLine(($result | ConvertTo-Json -Depth 10 -Compress)) }
        }
        finally {
            if ($null -ne $writer) { $writer.Dispose() }
            if ($null -ne $reader) { $reader.Dispose() }
            $pipe.Dispose()
        }
        exit 0
    }

    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    [DctNative]::BeginCancellation()
    if ([DctNative]::Cancelled) { Write-Event @{ event = 'cancelled' }; exit 0 }
    if ($request.action -eq 'launch') {
        Write-Event @{ event = 'phase'; phase = $phase }
        $compatibility = $request.launch.env.PSObject.Properties['__COMPAT_LAYER']
        $layer = if ($null -eq $compatibility) { '' } else { [string] $compatibility.Value }
        $needsElevation = [DctNative]::NeedsElevation([string] $request.launch.executablePath, $layer)
        if (-not $needsElevation) {
            $phase = 'launching'
            Write-Event @{ event = 'phase'; phase = $phase }
            if ([DctNative]::Cancelled) { Write-Event @{ event = 'cancelled' }; exit 0 }
            try { $nativeProcess = Invoke-Launch $request.launch }
            catch {
                if ((Get-NativeError $_.Exception) -ne 740) { throw }
                $needsElevation = $true
            }
        }
        if ($needsElevation) {
            $phase = 'awaiting-permission'
            $reply = Invoke-Elevated $request
            if ($reply.event -ne 'created') { Write-Event $reply; exit 0 }
            $nativeProcess = [DctNative]::Adopt([long] $reply.handle, [int] $reply.processId, $true)
        }
        else {
            Write-Event @{ event = 'started'; processId = $nativeProcess.ProcessId; executablePath = $nativeProcess.ExecutablePath; startedAtUtc = $nativeProcess.StartedAtUtc; elevated = $nativeProcess.Elevated }
        }
        $phase = 'wait-exit'
        $code = [DctNative]::WaitForExit($nativeProcess)
        if ($null -ne $code) { Write-Event @{ event = 'exited'; processId = $nativeProcess.ProcessId; exitCode = $code } }
    }
    elseif ($request.action -eq 'close') {
        $phase = 'normal-close'
        $close = $null
        $needsElevation = $false
        $canElevate = -not [DctNative]::IsElevated()
        try {
            $needsElevation = $canElevate -and [DctNative]::IsProcessElevated([int] $request.target.processId)
            if (-not $needsElevation) {
                $close = Open-Close $request.target
                $needsElevation = $canElevate -and $close.Evidence.nativeError -eq 5
            }
        }
        catch {
            if (-not $canElevate -or (Get-NativeError $_.Exception) -ne 5) { throw }
            $needsElevation = $true
        }
        if ($needsElevation) {
            if ($null -ne $close) { $close.Dispose(); $close = $null }
            $phase = 'awaiting-permission'
            $result = Invoke-Elevated $request
        }
        else {
            try {
                Write-Event $close.Evidence
                $phase = 'wait-exit'
                $result = [DctNative]::WaitForClose($close)
            }
            finally { if ($null -ne $close) { $close.Dispose() } }
        }
        Write-Event $result
    }
    else { throw 'Invalid native helper action.' }
}
catch {
    $code = Get-NativeError $_.Exception
    $category = if ($code -eq 1223) { 'authorization-cancelled' } elseif ($code -eq 5) { 'access-denied' } elseif ($phase -eq 'wait-exit') { 'native-monitor-failed' } else { 'native-operation-failed' }
    Write-Event @{ event = 'error'; phase = $phase; nativeError = $code; category = $category; exceptionType = $_.Exception.GetType().Name }
    exit 1
}
finally {
    if ($null -ne $nativeProcess) { $nativeProcess.Dispose() }
}
