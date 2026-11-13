$ErrorActionPreference = "Stop"

$workspace = if ($env:APP_WORKSPACE_PATH) { $env:APP_WORKSPACE_PATH } else { (Get-Location).Path }
Set-Location $workspace

Write-Host "Running validate..."
& pnpm validate
exit $LASTEXITCODE


