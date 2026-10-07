# Blueprint OS - Windows starter. ASCII ONLY on purpose: Windows PowerShell 5.1 reads
# BOM-less files in the system codepage. One job: make sure Node.js exists, fetch the
# installer package, hand over to it. All real work happens in blueprint-os-install.js.
$ErrorActionPreference = "Continue"        # native exe failures are judged by $LASTEXITCODE, never by try/catch
$ProgressPreference = "SilentlyContinue"   # the progress bar makes Invoke-WebRequest ~10x slower on PS 5.1
$server = if ($env:SHOPOS_LICENSE_SERVER) { $env:SHOPOS_LICENSE_SERVER } else { "https://shop-os-license-server.glenn-15d.workers.dev" }
$shopos = Join-Path $env:USERPROFILE ".shopos"
$pkgDir = Join-Path $shopos "app\node_modules\@blueprintitai\shop-os-dashboard"
$alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
$code = "BP-" + (-join ((1..4) | ForEach-Object { $alpha[(Get-Random -Maximum $alpha.Length)] }))

function Fail($stage, $message) {
  Write-Host ""
  Write-Host "Setup hit a problem at ""$stage"". We've been notified and will email you shortly. If you contact us, quote support code $code." -ForegroundColor Red
  try {   # best effort, short timeout, must never delay or break the failure path
    $msg = ([string]$message).Replace($env:USERPROFILE, "%USERPROFILE%")
    if ($msg.Length -gt 400) { $msg = $msg.Substring(0, 400) }
    $body = @{ license_key = $env:SHOPOS_LICENSE_KEY; status = "error"; step = "starter:$stage"; error_message = $msg; support_code = $code
               machine = @{ os = [Environment]::OSVersion.VersionString; source = "installer-v2-starter" } } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Uri "$server/install-log" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 8 -UseBasicParsing | Out-Null
  } catch {}
  exit 1
}

New-Item -ItemType Directory -Force -Path $shopos | Out-Null

# 1. Node 20+: system Node if new enough, else a portable copy under ~/.shopos/runtime (no admin).
$nodeBin = $null
$v = & node --version 2>$null
if ($LASTEXITCODE -eq 0 -and "$v" -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) { $nodeBin = "node" }
if (-not $nodeBin) {
  $found = Get-ChildItem -Path (Join-Path $shopos "runtime") -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($found) { $nodeBin = $found.FullName }
}
if (-not $nodeBin) {
  Write-Host "Downloading Node.js (one time)..."
  try {
    $idx = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing
    $lts = $idx | Where-Object { $_.lts } | Select-Object -First 1
    $ver = if ($lts -and $lts.version -match '^v\d+\.\d+\.\d+$') { $lts.version } else { "v22.20.0" }
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { "arm64" } else { "x64" }
    $rt = Join-Path $shopos "runtime"; New-Item -ItemType Directory -Force -Path $rt | Out-Null
    $zip = Join-Path $env:TEMP "node-$ver.zip"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$ver/node-$ver-win-$arch.zip" -OutFile $zip -UseBasicParsing -ErrorAction Stop
    Expand-Archive -Path $zip -DestinationPath $rt -Force -ErrorAction Stop
    Remove-Item $zip -ErrorAction SilentlyContinue
    $nodeBin = Join-Path $rt "node-$ver-win-$arch\node.exe"
  } catch { Fail "node-download" $_.Exception.Message }
}
if ($nodeBin -ne "node" -and -not (Test-Path $nodeBin)) { Fail "node-download" "Node was not found after download." }

# 2. The installer package (test hook: SHOPOS_PACKAGE_DIR uses a local checkout).
if ($env:SHOPOS_PACKAGE_DIR) { $pkgDir = $env:SHOPOS_PACKAGE_DIR } else {
  Write-Host "Fetching the Blueprint OS installer..."
  $tgz = Join-Path $env:TEMP "blueprint-os-installer.tar.gz"
  try {
    New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
    Invoke-WebRequest -Uri "https://codeload.github.com/blueprintit-ai/shop-os-dashboard/tar.gz/refs/heads/main" -OutFile $tgz -UseBasicParsing -ErrorAction Stop
  } catch { Fail "package-download" $_.Exception.Message }
  $LASTEXITCODE = -1   # so a missing tar.exe cannot look like success via a stale 0
  & tar.exe -xzf $tgz -C $pkgDir --strip-components=1
  if ($LASTEXITCODE -ne 0) { Fail "package-extract" "tar.exe exited $LASTEXITCODE" }
  Remove-Item $tgz -ErrorAction SilentlyContinue
}
$entry = Join-Path $pkgDir "bin\blueprint-os-install.js"
if (-not (Test-Path $entry)) { Fail "package-extract" "bin\blueprint-os-install.js is missing after download." }

# 3. Hand over.
& $nodeBin $entry @args
exit $LASTEXITCODE
