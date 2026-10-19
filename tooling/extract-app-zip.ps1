param(
    [Parameter(Mandatory = $true)][string]$Archive,
    [Parameter(Mandatory = $true)][string]$Destination,
    [Parameter(Mandatory = $true)][long]$ExpectedBytes,
    [Parameter(Mandatory = $true)][string]$ExpectedSha256
)
$ErrorActionPreference = 'Stop'
if ($ExpectedBytes -le 0 -or $ExpectedBytes -gt 9007199254740991 -or $ExpectedSha256 -cnotmatch '^[a-f0-9]{64}$') {
    throw 'Invalid independently expected archive identity.'
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = [IO.Path]::GetFullPath($Destination)
$prefix = $root.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
if ([IO.Directory]::Exists($root) -or [IO.File]::Exists($root)) {
    throw 'Archive destination must be absent.'
}
# FileShare.Read denies writes and deletion on this Windows source for the entire
# hash/ZipArchive/inventory lifetime. Neither hash is computed by reopening a path.
$source = [IO.File]::Open([IO.Path]::GetFullPath($Archive), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
$zip = $null
$sha = [Security.Cryptography.SHA256]::Create()
try {
    if ($source.Length -ne $ExpectedBytes -or
        [Convert]::ToHexString($sha.ComputeHash($source)).ToLowerInvariant() -cne $ExpectedSha256) {
        throw 'App archive digest or length changed.'
    }
    $source.Position = 0
    $zip = [IO.Compression.ZipArchive]::new($source, [IO.Compression.ZipArchiveMode]::Read, $true)
    if ($zip.Entries.Count -eq 0 -or $zip.Entries.Count -gt 100000) { throw 'Invalid archive entry count.' }
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $aliases = [Collections.Generic.Dictionary[string,string]]::new([StringComparer]::OrdinalIgnoreCase)
    $inventory = [Collections.Generic.SortedDictionary[string,object]]::new([StringComparer]::Ordinal)
    function Add-Directory([string]$Name) {
        if ($aliases.ContainsKey($Name)) {
            if ($aliases[$Name] -cne $Name -or $inventory[$Name].type -cne 'directory') {
                throw 'Archive contains an aliased or conflicting parent.'
            }
        } else {
            $aliases.Add($Name, $Name)
            $inventory.Add($Name, [ordered]@{ type = 'directory'; path = $Name; executableBits = $null })
        }
    }
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName
        $directory = $name.EndsWith('/')
        $relative = if ($directory) { $name.Substring(0, $name.Length - 1) } else { $name }
        $target = [IO.Path]::GetFullPath([IO.Path]::Combine($root, $relative))
        $kind = ($entry.ExternalAttributes -shr 16) -band 61440
        $unsafePart = @($relative.Split('/') | Where-Object {
            $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' -or
            $_ -match '[\\:\x00-\x1f\x7f<>"|?*]' -or $_.EndsWith('.') -or $_.EndsWith(' ') -or
            $_ -match '^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)'
        }).Count -ne 0
        if ($unsafePart -or $relative.Normalize([Text.NormalizationForm]::FormC) -cne $relative -or
            -not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or
            -not $names.Add($relative) -or
            ($kind -ne 0 -and $kind -ne 32768 -and $kind -ne 16384) -or
            ($directory -and $kind -eq 32768) -or (-not $directory -and $kind -eq 16384) -or
            $entry.Length -lt 0 -or $entry.Length -gt 9007199254740991 -or ($directory -and $entry.Length -ne 0)) {
            throw 'Archive contains an unsafe, duplicate or unsupported entry.'
        }
        $slash = $relative.LastIndexOf('/')
        while ($slash -ge 0) {
            Add-Directory $relative.Substring(0, $slash)
            $slash = $relative.LastIndexOf('/', $slash - 1)
        }
        if ($directory) { Add-Directory $relative }
        else {
            if ($aliases.ContainsKey($relative)) { throw 'Archive contains an aliased or conflicting file.' }
            $aliases.Add($relative, $relative)
            $inventory.Add($relative, [ordered]@{
                type = 'file'; path = $relative; bytes = $entry.Length; sha256 = ''; executableBits = $null
            })
        }
        if ($inventory.Count -gt 100000) { throw 'Archive inventory exceeds its entry bound.' }
    }
    [IO.Directory]::CreateDirectory($root) | Out-Null
    foreach ($entry in $zip.Entries) {
        $name = $entry.FullName
        $relative = $name.TrimEnd('/')
        $target = [IO.Path]::Combine($root, $relative)
        if ($name.EndsWith('/')) { [IO.Directory]::CreateDirectory($target) | Out-Null; continue }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        $original = $entry.Open()
        $output = $null
        $hash = [Security.Cryptography.IncrementalHash]::CreateHash([Security.Cryptography.HashAlgorithmName]::SHA256)
        try {
            $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            $buffer = [byte[]]::new(65536)
            $total = [long]0
            while (($count = $original.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $total += $count
                if ($total -gt $entry.Length) { throw 'Archive entry exceeds its original byte length.' }
                $hash.AppendData($buffer, 0, $count)
                $output.Write($buffer, 0, $count)
            }
            if ($total -ne $entry.Length) { throw 'Archive entry is truncated.' }
            $inventory[$relative].sha256 = [Convert]::ToHexString($hash.GetHashAndReset()).ToLowerInvariant()
        } finally {
            if ($null -ne $output) { $output.Dispose() }
            $original.Dispose()
            $hash.Dispose()
        }
    }
    $zip.Dispose()
    $zip = $null
    $source.Position = 0
    if ($source.Length -ne $ExpectedBytes -or
        [Convert]::ToHexString($sha.ComputeHash($source)).ToLowerInvariant() -cne $ExpectedSha256) {
        throw 'App archive source changed during extraction.'
    }
    [ordered]@{
        schemaVersion = 1
        archive = [ordered]@{ bytes = $ExpectedBytes; sha256 = $ExpectedSha256 }
        entries = @($inventory.Values)
    } | ConvertTo-Json -Depth 8 -Compress
} finally {
    if ($null -ne $zip) { $zip.Dispose() }
    $source.Dispose()
    $sha.Dispose()
}
