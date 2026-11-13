$ErrorActionPreference = "Stop"

$workspace = if ($env:APP_WORKSPACE_PATH) { $env:APP_WORKSPACE_PATH } else { (Get-Location).Path }
$defaultPort = 5000
$port = if ($env:APP_RUN_PORT) { $env:APP_RUN_PORT } elseif ($env:PORT) { $env:PORT } else { $defaultPort }
Set-Location $workspace

Write-Host "Starting HTTP service on port $port for deploy..."
$env:PORT = "$port"
if (-not $env:APP_ENV) { $env:APP_ENV = "PROD" }
& node dist/server.js
exit $LASTEXITCODE
