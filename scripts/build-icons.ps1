# Recrée les icônes (bonhomme violet + moins) en carré parfait
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Split-Path -Parent $root
$iconsDir = Join-Path $projectRoot "icons"
$src = Join-Path $projectRoot "assets\icon-source.png"

if (-not (Test-Path $src)) {
  Write-Error "Image source introuvable: $src"
  exit 1
}

New-Item -ItemType Directory -Force -Path $iconsDir | Out-Null
Add-Type -AssemblyName System.Drawing

$img = [System.Drawing.Image]::FromFile($src)
$size = [Math]::Min($img.Width, $img.Height)
$x = [int](($img.Width - $size) / 2)
$y = [int](($img.Height - $size) / 2)

$crop = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($crop)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.DrawImage($img, 0, 0, [System.Drawing.Rectangle]::new($x, $y, $size, $size), [System.Drawing.GraphicsUnit]::Pixel)
$g.Dispose()
$img.Dispose()

foreach ($out in @(32, 48, 96, 128)) {
  $bmp = New-Object System.Drawing.Bitmap $out, $out
  $g2 = [System.Drawing.Graphics]::FromImage($bmp)
  $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g2.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g2.DrawImage($crop, 0, 0, $out, $out)
  $bmp.Save((Join-Path $iconsDir "icon-$out.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g2.Dispose()
  $bmp.Dispose()
  Write-Host "icon-$out.png OK ($out x $out)"
}

$crop.Dispose()
