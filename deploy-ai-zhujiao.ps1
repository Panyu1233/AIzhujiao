param(
  [string]$Server = '120.27.24.69',
  [string]$SshUser = 'root',
  [string]$RemotePath = '/opt/ai-zhujiao',
  [string]$Pm2Name = 'ai-zhujiao',
  [string]$PublicUrl = 'https://zhujiao.mankanghui.com',
  [string]$IdentityFile = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archiveName = "ai-zhujiao-deploy-$timestamp.tar.gz"
$localArchive = Join-Path ([System.IO.Path]::GetTempPath()) $archiveName
$remoteArchive = "/tmp/$archiveName"
$target = "$SshUser@$Server"

if (-not (Get-Command tar.exe -ErrorAction SilentlyContinue)) { throw 'tar.exe not found' }
if (-not (Get-Command scp.exe -ErrorAction SilentlyContinue)) { throw 'scp.exe not found' }
if (-not (Get-Command ssh.exe -ErrorAction SilentlyContinue)) { throw 'ssh.exe not found' }

$scpArgs = @()
$sshArgs = @()
if ($IdentityFile) {
  $scpArgs += @('-i', $IdentityFile)
  $sshArgs += @('-i', $IdentityFile)
}

Write-Host '[1/4] Packaging project...' -ForegroundColor Cyan
Push-Location $projectRoot
try {
  & tar.exe -czf $localArchive `
    --exclude='./node_modules' `
    --exclude='./.next' `
    --exclude='./dist' `
    --exclude='./logs' `
    --exclude='./.pnpm-store' `
    --exclude='./tsconfig.tsbuildinfo' `
    --exclude='./knowledge-base' `
    --exclude='./.env.local' `
    --exclude='./.env' `
    --exclude='./.env.production' `
    --exclude='./.env.production.local' `
    --exclude='./ai-zhujiao-production.env' `
    --exclude='./ai-zhujiao-deploy-*.tar.gz' `
    --exclude='./$null' `
    .
  if ($LASTEXITCODE -ne 0) { throw 'Packaging failed' }
} finally {
  Pop-Location
}

Write-Host "[2/4] Uploading to $target..." -ForegroundColor Cyan
& scp.exe @scpArgs $localArchive "${target}:$remoteArchive"
if ($LASTEXITCODE -ne 0) { throw 'Upload failed. Check SSH password, network, or server address.' }

Write-Host '[3/4] Building and restarting on server...' -ForegroundColor Cyan
$remoteLines = @(
  'set -euo pipefail',
  'export PATH=/usr/local/node20/bin:$PATH',
  'mkdir -p __REMOTE_PATH__',
  'tar -xzf __REMOTE_ARCHIVE__ -C __REMOTE_PATH__',
  'cd __REMOTE_PATH__',
  "find scripts -type f -name '*.sh' -exec sed -i 's/\r$//' {} +",
  'if [ -f .env.production ]; then',
  '  set -a',
  '  . ./.env.production',
  '  set +a',
  'fi',
  'unset NODE_ENV',
  'pnpm install --no-frozen-lockfile --reporter=append-only',
  'pnpm build',
  'if pm2 describe __PM2_NAME__ >/dev/null 2>&1; then pm2 delete __PM2_NAME__; fi',
  'if command -v fuser >/dev/null 2>&1; then fuser -k 5000/tcp >/dev/null 2>&1 || true; fi',
  'sleep 2',
  'if ss -lntp | grep -q ":5000 "; then',
  '  echo "Port 5000 is still occupied:"',
  '  ss -lntp | grep ":5000 "',
  '  exit 1',
  'fi',
  'APP_ENV=PROD NODE_ENV=production PORT=5000 pm2 start /usr/local/node20/bin/node --name __PM2_NAME__ --cwd __REMOTE_PATH__ -- dist/server.js',
  'pm2 save',
  'sleep 3',
  'code=$(curl -sS -o /dev/null -w "%{http_code}" http://127.0.0.1:5000/admin/staging)',
  'if [ "$code" != "200" ]; then echo "Local /admin/staging returned $code"; exit 1; fi',
  'rm -f __REMOTE_ARCHIVE__'
)
$remoteCommand = ($remoteLines -join "`n").Replace('__REMOTE_PATH__', $RemotePath).Replace('__REMOTE_ARCHIVE__', $remoteArchive).Replace('__PM2_NAME__', $Pm2Name)
& ssh.exe @sshArgs $target $remoteCommand
if ($LASTEXITCODE -ne 0) { throw 'Remote build or restart failed' }

Write-Host '[4/4] Checking public site...' -ForegroundColor Cyan
$publicStatus = & curl.exe -sS -o NUL -w "%{http_code}" "$PublicUrl/admin/staging"
Write-Host "HTTP_STATUS=$publicStatus"
if ($LASTEXITCODE -ne 0 -or $publicStatus -ne '200') {
  throw "Public /admin/staging did not return 200 (actual: $publicStatus)"
}
if ($LASTEXITCODE -ne 0) { throw 'Public site check failed' }

Remove-Item -LiteralPath $localArchive -Force -ErrorAction SilentlyContinue
Write-Host 'Deployment completed.' -ForegroundColor Green

