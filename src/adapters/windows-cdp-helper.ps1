[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Snapshot', 'Close')]
    [string] $Action,

    [Parameter(Mandatory = $true)]
    [int] $RootProcessId,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int] $Port,
    [string] $ExecutablePath,
    [string] $StartedAtUtc,
    [ValidateSet('OwnedExclusive', 'ProcessIdentityOnly')]
    [string] $ListenerPolicy = 'OwnedExclusive',
    [ValidateRange(1, 300)]
    [int] $TimeoutSeconds = 10
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Result {
    param([Parameter(Mandatory = $true)] [hashtable] $Value)
    [Console]::Out.WriteLine(($Value | ConvertTo-Json -Depth 8 -Compress))
}

function Get-ProcessTreeIds {
    param([Parameter(Mandatory = $true)] [int] $RootId)

    $processes = @(Get-CimInstance -ClassName Win32_Process | Select-Object ProcessId, ParentProcessId, CreationDate, SessionId)
    $byId = [System.Collections.Generic.Dictionary[int, object]]::new()
    foreach ($process in $processes) {
        $byId[[int] $process.ProcessId] = $process
    }
    if (-not $byId.ContainsKey($RootId)) {
        throw "The root process $RootId is missing from the Win32_Process snapshot."
    }

    $accepted = [System.Collections.Generic.Dictionary[int, object]]::new()
    $accepted.Add($RootId, $byId[$RootId])
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $processes) {
            $processId = [int] $process.ProcessId
            $parentId = [int] $process.ParentProcessId
            if ($accepted.ContainsKey($processId) -or -not $accepted.ContainsKey($parentId)) { continue }
            $parent = $accepted[$parentId]
            if ([int] $process.SessionId -ne [int] $parent.SessionId) { continue }
            $childCreated = ([DateTime] $process.CreationDate).ToUniversalTime()
            $parentCreated = ([DateTime] $parent.CreationDate).ToUniversalTime()
            if ($childCreated -lt $parentCreated) { continue }
            $accepted.Add($processId, $process)
            $changed = $true
        }
    }
    return @($accepted.Keys)
}

function Test-PortHasListener {
    param([Parameter(Mandatory = $true)] [int] $LocalPort)
    return @(
        Get-NetTCPConnection -ErrorAction Stop |
            Where-Object { $_.State -eq 'Listen' -and [int] $_.LocalPort -eq $LocalPort }
    ).Count -gt 0
}

function Test-OwnedPortListener {
    param(
        [Parameter(Mandatory = $true)] [int] $LocalPort,
        [Parameter(Mandatory = $true)] [int[]] $OwnedProcessIds
    )
    return @(
        Get-NetTCPConnection -ErrorAction Stop |
            Where-Object { $_.State -eq 'Listen' -and [int] $_.LocalPort -eq $LocalPort } |
            Where-Object { [int] $_.OwningProcess -in $OwnedProcessIds }
    ).Count -gt 0
}

try {
    $currentSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    $root = Get-Process -ErrorAction Stop | Where-Object { $_.Id -eq $RootProcessId }

    if ($Action -eq 'Snapshot') {
        $rootData = [ordered]@{ exists = $false }
        $processIds = @()
        if ($null -ne $root) {
            $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo([string] $root.Path)
            $rootData = [ordered]@{
                exists = $true
                executablePath = [string] $root.Path
                sessionId = [int] $root.SessionId
                startedAtUtc = $root.StartTime.ToUniversalTime().ToString('o', [Globalization.CultureInfo]::InvariantCulture)
                productName = [string] $versionInfo.ProductName
                companyName = [string] $versionInfo.CompanyName
                originalFilename = [string] $versionInfo.OriginalFilename
            }
            $processIds = @(Get-ProcessTreeIds -RootId $RootProcessId)
        }

        $listeners = @(
            Get-NetTCPConnection -ErrorAction Stop |
                Where-Object { $_.State -eq 'Listen' -and [int] $_.LocalPort -eq $Port } |
                ForEach-Object {
                    [ordered]@{
                        localAddress = [string] $_.LocalAddress
                        localPort = [int] $_.LocalPort
                        owningProcess = [int] $_.OwningProcess
                    }
                }
        )
        Write-Result ([ordered]@{
            ok = $true
            currentSessionId = $currentSessionId
            root = $rootData
            processIds = $processIds
            listeners = $listeners
        })
        exit 0
    }

    if ($null -eq $root) {
        $listenerPresent = Test-PortHasListener -LocalPort $Port
        Write-Result ([ordered]@{
            ok = $true
            closed = if ($ListenerPolicy -eq 'ProcessIdentityOnly') { $true } else { -not $listenerPresent }
            rootProcessId = $RootProcessId
            reason = if ($ListenerPolicy -eq 'ProcessIdentityOnly') { 'root-absent' } elseif ($listenerPresent) { 'listener-present' } else { 'root-and-listener-absent' }
        })
        exit 0
    }
    $expectedPath = [IO.Path]::GetFullPath($ExecutablePath)
    $actualPath = [IO.Path]::GetFullPath([string] $root.Path)
    $recordedStart = [DateTime]::Parse(
        $StartedAtUtc,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::AssumeUniversal
    ).ToUniversalTime()
    $actualStart = $root.StartTime.ToUniversalTime()
    $identityMatches = $actualPath.Equals($expectedPath, [StringComparison]::OrdinalIgnoreCase) -and
        $root.SessionId -eq $currentSessionId -and
        [Math]::Abs(($actualStart - $recordedStart).TotalMilliseconds) -le 1000
    if (-not $identityMatches) {
        Write-Result ([ordered]@{
            ok = $false
            errorCode = 'TARGET_IDENTITY_MISMATCH'
            message = 'The process no longer matches the recorded executable, start time, or Windows session.'
        })
        exit 1
    }

    $ownedProcessIds = @(Get-ProcessTreeIds -RootId $RootProcessId)
    $currentListeners = @(
        Get-NetTCPConnection -ErrorAction Stop |
            Where-Object { $_.State -eq 'Listen' -and [int] $_.LocalPort -eq $Port }
    )
    $ownedListenerPresent = @(
        $currentListeners | Where-Object { [int] $_.OwningProcess -in $ownedProcessIds }
    ).Count -gt 0
    $foreignListenerPresent = @(
        $currentListeners | Where-Object { [int] $_.OwningProcess -notin $ownedProcessIds }
    ).Count -gt 0
    if ($ListenerPolicy -eq 'OwnedExclusive' -and (-not $ownedListenerPresent -or $foreignListenerPresent)) {
        Write-Result ([ordered]@{
            ok = $false
            errorCode = 'TARGET_IDENTITY_MISMATCH'
            message = 'The CDP listener is no longer owned exclusively by the recorded process tree.'
        })
        exit 1
    }
    [void] $root.CloseMainWindow()
    $closed = $root.WaitForExit($TimeoutSeconds * 1000)
    $listenerRemains = if ($ListenerPolicy -eq 'OwnedExclusive') {
        Test-PortHasListener -LocalPort $Port
    } else {
        Test-OwnedPortListener -LocalPort $Port -OwnedProcessIds $ownedProcessIds
    }
    if ($closed -and $listenerRemains) {
        $closed = $false
    }
    Write-Result ([ordered]@{
        ok = $true
        closed = [bool] $closed
        rootProcessId = $RootProcessId
        reason = if ($closed) { 'root-and-listener-closed' } else { 'listener-present' }
    })
    exit 0
}
catch {
    Write-Result ([ordered]@{
        ok = $false
        errorCode = 'WINDOWS_HELPER_FAILED'
        message = $_.Exception.Message
    })
    exit 1
}
