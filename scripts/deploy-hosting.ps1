# Deploy Hosting from THIS repo root only. Prevents uploading an old copy when firebase deploy
# is accidentally run from another clone or a parent folder without your latest public/* changes.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$index = Join-Path $root "public\index.html"
if (-not (Test-Path $index)) {
  Write-Error "public\index.html not found. Current directory must be the Fair Flow app root (with public/). Root: $root"
}

$html = Get-Content $index -Raw -Encoding UTF8
if (-not $html.Contains('Permissions'', ''Documents')) {
  Write-Error "public\index.html is missing the Staff 'Documents' tab (old file?). Fix or deploy from the correct folder. Root: $root"
}

if ($html -match 'JSON\.parse\(localStorage\.getItem') {
  Write-Error "public\index.html still has JSON.parse(localStorage...) — run scripts/replace-index-localstorage-json.mjs before deploy. Root: $root"
}

Write-Host "OK: index.html contains Staff Documents tab and no raw JSON.parse(localStorage)." -ForegroundColor Green
Write-Host "Deploying Hosting from: $root" -ForegroundColor Cyan
firebase deploy --only hosting
