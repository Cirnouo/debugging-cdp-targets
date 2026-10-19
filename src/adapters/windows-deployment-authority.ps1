[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $Path)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    if ($Path.Length -gt 32768 -or $Path -match "[\x00\r\n]" -or $Path -notmatch '^[A-Za-z]:\\') {
        throw 'Invalid deployment authority path.'
    }
    Add-Type -Path (Join-Path $PSScriptRoot 'windows-deployment-authority.cs')
    $result = [DctDeploymentAuthority]::Inspect($Path)
    [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 6 -Compress))
} catch {
    [Console]::Error.WriteLine('Deployment native authority query failed.')
    exit 1
}
