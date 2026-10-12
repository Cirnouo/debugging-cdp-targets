[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string] $Directory, [Parameter(Mandatory = $true)] [string] $Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$executable = Join-Path $Directory 'close-window.exe'
Add-Type -Path (Join-Path $PSScriptRoot 'normal-close-window.cs') -OutputAssembly $executable -OutputType WindowsApplication
Add-Type -Path (Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
$marker = Join-Path $Directory 'window'
$start = [Diagnostics.ProcessStartInfo]::new($executable, ('"' + $marker + '" ' + $Mode))
$start.UseShellExecute = $false
$start.WorkingDirectory = $Directory
$process = [Diagnostics.Process]::Start($start)
$close = $null
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while (-not [IO.File]::Exists($marker + '.ready')) {
        if ($process.HasExited -or [DateTime]::UtcNow -ge $deadline) {
            $failure = if ([IO.File]::Exists($marker + '.setup-failed')) { [IO.File]::ReadAllText($marker + '.setup-failed') } else { 'missing-readiness' }
            throw ('Owned fixture failed readiness: ' + $failure)
        }
        Start-Sleep -Milliseconds 20
    }
    $windows = [IO.File]::ReadAllLines($marker + '.ready')
    $close = [DctNative]::RequestClose($process.Id, $executable, $process.StartTime.ToUniversalTime().ToString('o'))
    $result = [DctNative]::WaitForClose($close)
    $process.WaitForExit()
    [Console]::Out.WriteLine((@{
        gui = $windows[0]; excluded = $windows[1]; oldMain = $windows[2];
        result = $result; closes = @([IO.File]::ReadAllLines($marker + '.closes'));
        expired = [IO.File]::Exists($marker + '.expired'); exitCode = $process.ExitCode
    } | ConvertTo-Json -Depth 5 -Compress))
}
finally {
    # The owned timer ends its message loop normally even when assertions or close fail.
    $process.WaitForExit()
    if ($null -ne $close) { $close.Dispose() }
    $process.Dispose()
}
