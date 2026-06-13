# Soumission Firefox Add-ons (AMO)
# 1. Créez vos clés API : https://addons.mozilla.org/developers/addon/api/key/
# 2. Copiez ce fichier en .amo-credentials (2 lignes : clé JWT puis secret JWT)
# 3. Lancez : .\publish-amo.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$credsFile = Join-Path $root ".amo-credentials"
if (-not (Test-Path $credsFile)) {
    Write-Host "Fichier .amo-credentials introuvable." -ForegroundColor Yellow
    Write-Host "Ouvrez https://addons.mozilla.org/developers/addon/api/key/ pour créer vos clés."
    Start-Process "https://addons.mozilla.org/developers/addon/api/key/"
    exit 1
}

$lines = Get-Content $credsFile | Where-Object { $_.Trim() -ne "" }
if ($lines.Count -lt 2) {
    Write-Error "Le fichier .amo-credentials doit contenir 2 lignes (API key puis secret)."
}

$env:WEB_EXT_API_KEY = $lines[0].Trim()
$env:WEB_EXT_API_SECRET = $lines[1].Trim()

$env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")

Write-Host "Lint de l'extension..." -ForegroundColor Cyan
web-ext lint --source-dir $root

Write-Host "Soumission sur Firefox Add-ons (canal public)..." -ForegroundColor Cyan
web-ext sign `
  --source-dir $root `
  --channel listed `
  --amo-metadata (Join-Path $root "amo\listing.json") `
  --api-key $env:WEB_EXT_API_KEY `
  --api-secret $env:WEB_EXT_API_SECRET `
  --approval-timeout 0

Write-Host "Terminé. Vérifiez le statut sur https://addons.mozilla.org/developers/addons" -ForegroundColor Green
