# Gera o pacote ZIP para a Chrome Web Store a partir da pasta dist.
# Uso: npm run empacotar  (ou)  powershell -ExecutionPolicy Bypass -File tools\empacotar_loja.ps1
$ErrorActionPreference = "Stop"

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

Write-Host "[1/3] Compilando (npm run build)..."
npm run build
if ($LASTEXITCODE -ne 0) { throw "Falha no build. Corrija os erros e tente de novo." }

$manifest = Get-Content ".\dist\manifest.json" -Raw | ConvertFrom-Json
$versao = [string]$manifest.version

$pastaLoja = Join-Path $raiz "loja"
$destino = Join-Path $pastaLoja ("assistente-ai-blogger-v" + $versao + ".zip")

Write-Host "[2/3] Montando o pacote..."
if (-not (Test-Path $pastaLoja)) { New-Item -ItemType Directory -Path $pastaLoja | Out-Null }
if (Test-Path $destino) { Remove-Item $destino -Force }

Compress-Archive -Path ".\dist\*" -DestinationPath $destino

Write-Host "[3/3] Pacote pronto: $destino"
Write-Host "Envie esse arquivo ZIP no Painel do desenvolvedor da Chrome Web Store (Adicionar novo item)."
