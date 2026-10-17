[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string] $NativeAssembly)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs'))
# CodeDom takes the literal output path; PS5 Add-Type -OutputAssembly expands brackets.
$options = [CodeDom.Compiler.CompilerParameters]::new()
$options.GenerateExecutable = $false
$options.OutputAssembly = $NativeAssembly
$options.TempFiles = [CodeDom.Compiler.TempFileCollection]::new([IO.Path]::GetDirectoryName($NativeAssembly), $true)
foreach ($reference in @('System.dll', 'System.Core.dll', 'System.Xml.dll')) {
    [void] $options.ReferencedAssemblies.Add($reference)
}
$compiler = [Microsoft.CSharp.CSharpCodeProvider]::new()
try {
    $result = $compiler.CompileAssemblyFromFile($options, $source)
    if ($result.Errors.HasErrors) { throw ($result.Errors | Out-String) }
} finally { $compiler.Dispose() }
Add-Type -LiteralPath $NativeAssembly
if ([DctNative].Assembly.Location -ne $NativeAssembly) { throw 'Prepared native assembly identity unavailable.' }
[Console]::Out.WriteLine('dct-native-assembly-ready')
