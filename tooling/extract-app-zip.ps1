param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$Destination
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($Destination)
$prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$zip = [IO.Compression.ZipFile]::OpenRead([IO.Path]::GetFullPath($Archive))
try {
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName
        $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $name))
        $kind = ($entry.ExternalAttributes -shr 16) -band 61440
        $parts = $name.TrimEnd('/').Split('/')
        $unsafePart = @($parts | Where-Object {
            $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' -or $_.EndsWith('.') -or $_.EndsWith(' ')
        }).Count -ne 0
        if ($name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/') -or
            $unsafePart -or
            -not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not $names.Add($target.TrimEnd([IO.Path]::DirectorySeparatorChar)) -or
            ($kind -ne 0 -and $kind -ne 32768 -and $kind -ne 16384)) {
            throw 'Archive contains an unsafe or duplicate entry.'
        }
    }
    [IO.Directory]::CreateDirectory($root) | Out-Null
    foreach ($entry in $zip.Entries) {
        $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $entry.FullName))
        if ($entry.FullName.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null }
        else {
            [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
        }
    }
} finally { $zip.Dispose() }
