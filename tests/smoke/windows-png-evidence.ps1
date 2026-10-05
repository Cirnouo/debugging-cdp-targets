[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $ImagePath,
    [Parameter(Mandatory = $true)] [string] $Points
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$bitmap = [Drawing.Bitmap]::new([IO.Path]::GetFullPath($ImagePath))
try {
    if ($bitmap.RawFormat.Guid -ne [Drawing.Imaging.ImageFormat]::Png.Guid) { throw 'Expected a PNG image.' }
    $pixels = @($Points.Split(';') | ForEach-Object {
        if ($_ -notmatch '^(\d+),(\d+)$') { throw 'Invalid PNG sample point.' }
        $x = [int]$Matches[1]
        $y = [int]$Matches[2]
        if ($x -ge $bitmap.Width -or $y -ge $bitmap.Height) { throw 'PNG sample point is outside the image.' }
        $color = $bitmap.GetPixel($x, $y)
        @{ x = $x; y = $y; r = [int]$color.R; g = [int]$color.G; b = [int]$color.B; a = [int]$color.A }
    })
    @{ width = $bitmap.Width; height = $bitmap.Height; pixels = $pixels } | ConvertTo-Json -Depth 4 -Compress
}
finally { $bitmap.Dispose() }
