[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Snapshot')]
    [string] $Action,

    [Parameter(Mandatory = $true)]
    [int] $RootProcessId,

    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 65535)]
    [int] $Port
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

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


try {
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
    $currentSessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    $root = Get-Process -ErrorAction Stop | Where-Object { $_.Id -eq $RootProcessId }

    if ($Action -eq 'Snapshot') {
        $rootData = [ordered]@{ exists = $false }
        $processIds = @()
        if ($null -ne $root) {
            # Process.Path uses MainModule/VM_READ on Windows PowerShell. A normal
            # gateway instead queries path/time through a limited-query handle.
            $identity = [DctNative]::Inspect($RootProcessId)
            try {
                $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($identity.ExecutablePath)
                $rootData = [ordered]@{
                    exists = $true
                    executablePath = $identity.ExecutablePath
                    sessionId = [int] $root.SessionId
                    startedAtUtc = $identity.StartedAtUtc
                    productName = [string] $versionInfo.ProductName
                    companyName = [string] $versionInfo.CompanyName
                    originalFilename = [string] $versionInfo.OriginalFilename
                }
            }
            finally {
                $identity.Dispose()
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


}
catch {
    Write-Result ([ordered]@{
        ok = $false
        errorCode = 'WINDOWS_HELPER_FAILED'
        message = 'Windows process identity or listener inspection failed.'
    })
    exit 1
}
