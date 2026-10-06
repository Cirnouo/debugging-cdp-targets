[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $Output,
    [ValidateSet('asInvoker', 'requireAdministrator')] [string] $Level = 'asInvoker'
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$manifest = $Output + '.manifest'
$xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="' + $Level + '" uiAccess="false" /></requestedPrivileges></security></trustInfo></assembly>'
[IO.File]::WriteAllText($manifest, $xml, [Text.UTF8Encoding]::new($false))
$options = [CodeDom.Compiler.CompilerParameters]::new()
$options.GenerateExecutable = $true
$options.OutputAssembly = $Output
$options.CompilerOptions = '/target:winexe /win32manifest:"' + $manifest + '"'
[void] $options.ReferencedAssemblies.Add('System.dll')
[void] $options.ReferencedAssemblies.Add('System.Windows.Forms.dll')
[void] $options.ReferencedAssemblies.Add('System.Drawing.dll')
$compiler = [Microsoft.CSharp.CSharpCodeProvider]::new()
try {
    $result = $compiler.CompileAssemblyFromFile($options, (Join-Path $PSScriptRoot 'native-window.cs'))
    if ($result.Errors.HasErrors) { throw ($result.Errors | Out-String) }
}
finally { $compiler.Dispose() }
Add-Type -Path (Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs') -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
[Console]::Out.WriteLine((@{ requiresElevation = [DctNative]::NeedsElevation($Output, ''); currentElevation = [DctNative]::IsElevated(); shortPath = (New-Object -ComObject Scripting.FileSystemObject).GetFile($Output).ShortPath } | ConvertTo-Json -Compress))
