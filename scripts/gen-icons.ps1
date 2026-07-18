# Generates PWA icons (Windows GDI+, no deps): gradient rounded square with
# "NOTHING BUT LIES" angled bottom-left to top-right.
# Run: npm run icons   (or: powershell -ExecutionPolicy Bypass -File scripts/gen-icons.ps1)
Add-Type -AssemblyName System.Drawing

$out = Join-Path $PSScriptRoot '..\public\icons'
New-Item -ItemType Directory -Force $out | Out-Null

function New-Icon([int]$size, [bool]$maskable, [string]$file) {
  $S = [float]$size
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  if (-not $maskable) {
    $r = $S * 0.22
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $path.AddArc(0, 0, 2 * $r, 2 * $r, 180, 90)
    $path.AddArc($S - 2 * $r, 0, 2 * $r, 2 * $r, 270, 90)
    $path.AddArc($S - 2 * $r, $S - 2 * $r, 2 * $r, 2 * $r, 0, 90)
    $path.AddArc(0, $S - 2 * $r, 2 * $r, 2 * $r, 90, 90)
    $path.CloseFigure()
    $g.SetClip($path)
  }

  # diagonal purple -> magenta -> pink gradient (same palette as before)
  $rect = New-Object System.Drawing.RectangleF(0, 0, $S, $S)
  $c1 = [System.Drawing.Color]::FromArgb(124, 58, 237)
  $c2 = [System.Drawing.Color]::FromArgb(192, 38, 211)
  $c3 = [System.Drawing.Color]::FromArgb(219, 39, 119)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $c1, $c3, [float]45)
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend(3)
  $blend.Colors = @($c1, $c2, $c3)
  $blend.Positions = [float[]]@(0, 0.5, 1)
  $brush.InterpolationColors = $blend
  $g.FillRectangle($brush, $rect)

  # soft highlight top-left
  $hlPath = New-Object System.Drawing.Drawing2D.GraphicsPath
  $hlPath.AddEllipse($S * 0.3 - $S * 0.9, $S * 0.25 - $S * 0.9, $S * 1.8, $S * 1.8)
  $hl = New-Object System.Drawing.Drawing2D.PathGradientBrush($hlPath)
  $hl.CenterColor = [System.Drawing.Color]::FromArgb(42, 255, 255, 255)
  $hl.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 255, 255, 255))
  $g.FillRectangle($hl, $rect)

  # angled wordmark, rising bottom-left to top-right
  $k = if ($maskable) { 0.78 } else { 1.0 }
  $g.TranslateTransform($S / 2, $S / 2)
  $g.RotateTransform(-18)
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $shadow = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(90, 30, 0, 50))
  $white = [System.Drawing.Brushes]::White
  $fSmall = New-Object System.Drawing.Font('Segoe UI Black', [float]($S * 0.105 * $k), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $fBig = New-Object System.Drawing.Font('Segoe UI Black', [float]($S * 0.26 * $k), [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $lines = @(
    @{ t = 'NOTHING'; f = $fSmall; y = -0.185 },
    @{ t = 'BUT';     f = $fSmall; y = -0.07 },
    @{ t = 'LIES';    f = $fBig;   y = 0.115 }
  )
  $off = $S * 0.012
  foreach ($l in $lines) {
    $y = [float]($S * $l.y * $k)
    $g.DrawString($l.t, $l.f, $shadow, (New-Object System.Drawing.PointF([float]$off, [float]($y + $off))), $fmt)
    $g.DrawString($l.t, $l.f, $white, (New-Object System.Drawing.PointF([float]0, $y)), $fmt)
  }

  $g.Dispose()
  $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output "wrote $file"
}

New-Icon 512 $false 'icon-512.png'
New-Icon 192 $false 'icon-192.png'
New-Icon 512 $true 'icon-maskable-512.png'
New-Icon 180 $true 'icon-180.png'
