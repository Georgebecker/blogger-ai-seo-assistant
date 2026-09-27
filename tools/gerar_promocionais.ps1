# Gera as imagens promocionais (banner do repositorio e imagem pequena da Chrome Web Store).
# Sem dependencias: usa apenas o System.Drawing do Windows.
# Uso: powershell -ExecutionPolicy Bypass -File tools\gerar_promocionais.ps1
Add-Type -AssemblyName System.Drawing

$raiz = Split-Path -Parent $PSScriptRoot
$saida = Join-Path $raiz "docs\img"
if (-not (Test-Path $saida)) { New-Item -ItemType Directory -Path $saida | Out-Null }

function Desenhar-Lupa($g, [double]$cx, [double]$cy, [double]$r) {
  $canetaAnel = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::White), ([single]($r * 0.34))
  $g.DrawEllipse($canetaAnel, [single]($cx - $r), [single]($cy - $r), [single]($r * 2), [single]($r * 2))
  $verde = New-Object System.Drawing.SolidBrush -ArgumentList ([System.Drawing.Color]::FromArgb(34, 197, 94))
  $rv = $r * 0.36
  $g.FillEllipse($verde, [single]($cx - $rv), [single]($cy - $rv), [single]($rv * 2), [single]($rv * 2))
  $canetaCabo = New-Object System.Drawing.Pen -ArgumentList ([System.Drawing.Color]::White), ([single]($r * 0.32))
  $canetaCabo.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $canetaCabo.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($canetaCabo, [single]($cx + $r * 0.70), [single]($cy + $r * 0.70), [single]($cx + $r * 1.32), [single]($cy + $r * 1.28))
  $canetaAnel.Dispose(); $canetaCabo.Dispose(); $verde.Dispose()
}

function Gerar-Imagem([int]$largura, [int]$altura, [string]$arquivo, [single]$tamTitulo, [single]$tamTexto) {
  $bmp = New-Object System.Drawing.Bitmap -ArgumentList $largura, $altura
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  $ret = New-Object System.Drawing.Rectangle -ArgumentList 0, 0, $largura, $altura
  $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush -ArgumentList $ret, ([System.Drawing.Color]::FromArgb(79, 70, 229)), ([System.Drawing.Color]::FromArgb(124, 58, 237)), ([single]45.0)
  $g.FillRectangle($grad, $ret)

  Desenhar-Lupa $g ($largura / 2.0) ($altura * 0.235) ($altura * 0.085)

  $branco = [System.Drawing.Brushes]::White
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center

  $fonteTitulo = New-Object System.Drawing.Font -ArgumentList "Segoe UI", $tamTitulo, ([System.Drawing.FontStyle]::Bold)
  $rectTitulo = New-Object System.Drawing.RectangleF -ArgumentList 0, ([single]($altura * 0.42)), $largura, ([single]($altura * 0.25))
  $g.DrawString("Assistente AI Blogger", $fonteTitulo, $branco, $rectTitulo, $sf)

  $fonteTexto = New-Object System.Drawing.Font -ArgumentList "Segoe UI", $tamTexto
  $rectTexto = New-Object System.Drawing.RectangleF -ArgumentList 0, ([single]($altura * 0.42 + $tamTitulo * 1.9)), $largura, ([single]($altura * 0.30))
  $texto = "Cria, otimiza e audita posts no editor do Blogger.`nSEO, imagens com ALT e checklist em tempo real."
  $g.DrawString($texto, $fonteTexto, $branco, $rectTexto, $sf)

  $fonteRodape = New-Object System.Drawing.Font -ArgumentList "Segoe UI", ([single]($tamTexto * 0.85))
  $rectRodape = New-Object System.Drawing.RectangleF -ArgumentList 0, ([single]($altura * 0.86)), $largura, ([single]($altura * 0.10))
  $g.DrawString("BYOK: DeepSeek e Google Gemini - chave criptografada no navegador", $fonteRodape, $branco, $rectRodape, $sf)

  $bmp.Save($arquivo, [System.Drawing.Imaging.ImageFormat]::Png)

  $fonteTitulo.Dispose(); $fonteTexto.Dispose(); $fonteRodape.Dispose()
  $grad.Dispose(); $g.Dispose(); $bmp.Dispose()
}

Gerar-Imagem 1280 640 (Join-Path $saida "banner.png") 46 16
Gerar-Imagem 440 280 (Join-Path $saida "loja-440x280.png") 22 10
Write-Host "Imagens geradas em docs\img (banner.png e loja-440x280.png)."
