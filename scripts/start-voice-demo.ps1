$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$runtimePath = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe'
if (-not (Test-Path -LiteralPath $runtimePath)) { $runtimePath = (Get-Command node -ErrorAction Stop).Source }
$outputPath = Join-Path $projectRoot 'outputs/phone-runtime'
New-Item -ItemType Directory -Path $outputPath -Force | Out-Null
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4318/health' -TimeoutSec 2
  if ($health.ready) { Write-Output 'Voice bridge is already running.'; exit 0 }
} catch {}
$managerPath = Join-Path $PSScriptRoot 'start-phone.mjs'
Start-Process -FilePath $runtimePath -ArgumentList ('"' + $managerPath + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $outputPath 'manager.log') -RedirectStandardError (Join-Path $outputPath 'manager-error.log') | Out-Null
for ($attempt = 0; $attempt -lt 25; $attempt++) {
  Start-Sleep -Seconds 2
  try {
    $health = Invoke-RestMethod -Uri 'http://127.0.0.1:4318/health' -TimeoutSec 1
    if ($health.ready) { Write-Output 'Voice bridge is ready.'; exit 0 }
  } catch {}
}
throw 'Voice bridge did not start. Check outputs/phone-runtime/manager-error.log.'
