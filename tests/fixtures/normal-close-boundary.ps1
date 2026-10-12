[CmdletBinding()]
param([Parameter(Mandatory = $true)] [string] $Mode)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../src/adapters/windows-native-process.cs'))
# Replace only user32 P/Invoke declarations at the native I/O seam. No selection,
# qualification, process identity, receipts or production method bodies are changed.
$bodies = @{
    EnumWindows = 'return NormalCloseBoundary.Enumerate(delegate(IntPtr window) { return callback(window, parameter); });'
    GetWindowThreadProcessId = 'return NormalCloseBoundary.ProcessId(window, out pid);'
    IsWindow = 'return NormalCloseBoundary.Exists(window);'
    IsWindowVisible = 'return NormalCloseBoundary.Visible(window);'
    IsWindowEnabled = 'return NormalCloseBoundary.Enabled(window);'
    IsIconic = 'return NormalCloseBoundary.Mode == "minimized-zero";'
    GetWindow = 'return NormalCloseBoundary.Owner(window);'
    GetWindowRect = 'rectangle = new WindowRectangle { Left = 0, Top = 0, Right = NormalCloseBoundary.ZeroWidth(window) ? 0 : 200, Bottom = 100 }; return NormalCloseBoundary.Rectangle();'
    GetWindowLongPointer = 'return new IntPtr(NormalCloseBoundary.Style(window, index));'
    GetWindowLong32 = 'return checked((int)NormalCloseBoundary.Style(window, index));'
    PostMessage = 'return NormalCloseBoundary.Post(window, message, wParam, lParam);'
}
foreach ($name in $bodies.Keys) {
    $pattern = '\[DllImport\("user32.dll"[^\r\n]*\)\] private static extern ([^\r\n]+\b' + $name + '\([^;\r\n]*\));'
    $matches = [Text.RegularExpressions.Regex]::Matches($source, $pattern)
    if ($matches.Count -ne 1) { throw ('Native I/O declaration unavailable: ' + $name) }
    $replacement = 'private static ' + $matches[0].Groups[1].Value + ' { ' + $bodies[$name] + ' }'
    $source = [Text.RegularExpressions.Regex]::Replace($source, $pattern, [Text.RegularExpressions.MatchEvaluator] { param($match) $replacement })
}
Add-Type -TypeDefinition ($source + [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'normal-close-boundary.cs')).Replace('using System;', '').Replace('using System.Collections;', '').Replace('using System.Diagnostics;', '').Replace('using System.Runtime.InteropServices;', '')) -ReferencedAssemblies 'System.dll', 'System.Core.dll', 'System.Xml.dll'
[Console]::Out.WriteLine(([NormalCloseBoundary]::Run($Mode) | ConvertTo-Json -Compress))
