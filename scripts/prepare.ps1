$ErrorActionPreference = "Stop"

$workspace = if ($env:APP_WORKSPACE_PATH) { $env:APP_WORKSPACE_PATH } else { (Get-Location).Path }
Set-Location $workspace

Write-Host "Installing dependencies..."
& pnpm install --prefer-frozen-lockfile --prefer-offline --loglevel debug --reporter=append-only
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}





