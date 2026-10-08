# Blueprint OS - Windows starter. ASCII ONLY on purpose: PowerShell 5.1 reads BOM-less files in the system
# codepage. One job: make sure Node.js exists, fetch the installer package, hand over to blueprint-os-install.js.
$ErrorActionPreference = "Continue"        # native exe failures are judged by $LASTEXITCODE, never by try/catch
$ProgressPreference = "SilentlyContinue"   # the progress bar makes Invoke-WebRequest ~10x slower on PS 5.1
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072   # TLS 1.2 on old PS 5.1
$server = if ($env:SHOPOS_LICENSE_SERVER) { $env:SHOPOS_LICENSE_SERVER } else { "https://shop-os-license-server.glenn-15d.workers.dev" }
$shopos = Join-Path $env:USERPROFILE ".shopos"
$pkgDir = Join-Path $shopos "app\node_modules\@blueprintitai\shop-os-dashboard"
$alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
$code = "BP-" + (-join ((1..4) | ForEach-Object { $alpha[(Get-Random -Maximum $alpha.Length)] }))
$runId = [guid]::NewGuid().ToString()   # groups this starter's reports on the server (36 chars, hex and dashes)

function Fail($stage, $message) {
  Write-Host ""
  Write-Host "Setup hit a problem at ""$stage"". We've been notified and will email you shortly. If you contact us, quote support code $code." -ForegroundColor Red
  try {   # best effort, short timeout, must never delay or break the failure path
    $msg = [string]$message   # TEMP first: it usually lives inside USERPROFILE
    foreach ($p in @(@($env:TEMP, "%TEMP%"), @($env:USERPROFILE, "%USERPROFILE%"))) { if ($p[0]) { $msg = $msg -ireplace [regex]::Escape($p[0]), $p[1] } }
    if ($msg.Length -gt 400) { $msg = $msg.Substring(0, 400) }
    $lk = if ($env:SHOPOS_LICENSE_KEY) { $env:SHOPOS_LICENSE_KEY } else { "unknown" }   # JSON null would be a 400
    $body = @{ license_key = $lk; status = "error"; run_id = $runId; step = "starter:$stage"; error_message = $msg; support_code = $code
               machine = @{ os = [Environment]::OSVersion.VersionString; source = "installer-v2-starter" } } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Uri "$server/install-log" -Method Post -ContentType "application/json" -Body $body -TimeoutSec 8 -UseBasicParsing | Out-Null
  } catch {}
  exit 1
}

New-Item -ItemType Directory -Force -Path $shopos | Out-Null

# 1. Node 20+: system Node if new enough, else a portable copy under ~/.shopos/runtime (checksummed, no admin).
function Test-Node($exe) {
  $global:LASTEXITCODE = -1
  try { $v = & $exe --version 2>$null } catch {}
  return ($LASTEXITCODE -eq 0 -and "$v" -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20)
}
$rt = Join-Path $shopos "runtime"; $nodeBin = $null
if (Test-Node "node") { $nodeBin = "$((Get-Command node -ErrorAction SilentlyContinue | Select-Object -First 1).Source)"; if (-not $nodeBin) { $nodeBin = "node" } }
if (-not $nodeBin) {
  foreach ($f in @(Get-ChildItem -LiteralPath $rt -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue)) { if (Test-Node $f.FullName) { $nodeBin = $f.FullName; break } }
}
if (-not $nodeBin) {
  Write-Host "Downloading Node.js (one time)..."
  $ver = "v22.20.0"   # pinned fallback when the version list cannot be fetched (the checksum is still verified)
  try {
    $idx = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing
    $lts = $idx | Where-Object { $_.lts -and $_.version -match '^v(22|24)\.\d+\.\d+$' } | Select-Object -First 1
    if ($lts) { $ver = $lts.version }
  } catch {}
  try {
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64" -or $env:PROCESSOR_ARCHITEW6432 -eq "ARM64") { "arm64" } else { "x64" }
    $name = "node-$ver-win-$arch"
    $tmp = Join-Path $shopos ("tmp-" + [guid]::NewGuid().ToString("N"))   # same volume as runtime, so the final move is a rename
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null; $zip = Join-Path $tmp "$name.zip"; $sums = Join-Path $tmp "SHASUMS256.txt"
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$ver/$name.zip" -OutFile $zip -UseBasicParsing -ErrorAction Stop
    Invoke-WebRequest -Uri "https://nodejs.org/dist/$ver/SHASUMS256.txt" -OutFile $sums -UseBasicParsing -ErrorAction Stop
    $line = Get-Content -LiteralPath $sums | Where-Object { $_ -match ("^[0-9a-fA-F]{64}\s+" + [regex]::Escape("$name.zip") + "$") } | Select-Object -First 1
    $want = if ($line) { ($line -split '\s+')[0] } else { "" }
    $got = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash
    if (-not $want -or $want -ne $got) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue; Fail "node-download" "Node checksum did not match" }
    $global:LASTEXITCODE = -1; & "$env:SystemRoot\System32\tar.exe" -xf $zip -C $tmp
    if ($LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue; Fail "node-download" "tar.exe exited $LASTEXITCODE" }
    New-Item -ItemType Directory -Force -Path $rt | Out-Null; $dest = Join-Path $rt $name
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction Stop }
    Move-Item -LiteralPath (Join-Path $tmp $name) -Destination $dest -ErrorAction Stop
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    $nodeBin = Join-Path $dest "node.exe"
  } catch { if ($tmp) { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }; Fail "node-download" $_.Exception.Message }
  if (-not (Test-Node $nodeBin)) { Fail "node-download" "Node did not run after download." }
}

# 2. The installer package (test hook: SHOPOS_PACKAGE_DIR uses a local checkout).
if ($env:SHOPOS_PACKAGE_DIR) { $pkgDir = $env:SHOPOS_PACKAGE_DIR } else {
  Write-Host "Fetching the Blueprint OS installer..."
  $tgz = Join-Path $env:TEMP "blueprint-os-installer.tar.gz"
  $ref = if ($env:SHOPOS_INSTALLER_REF -match '^[A-Za-z0-9._-]{1,64}$' -and $env:SHOPOS_INSTALLER_REF -notmatch '^\.') { $env:SHOPOS_INSTALLER_REF } else { "refs/heads/main" }   # server-set pin
  try {
    New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
    Invoke-WebRequest -Uri "https://codeload.github.com/blueprintit-ai/shop-os-dashboard/tar.gz/$ref" -OutFile $tgz -UseBasicParsing -ErrorAction Stop
  } catch { Fail "package-download" $_.Exception.Message }
  $global:LASTEXITCODE = -1; & "$env:SystemRoot\System32\tar.exe" -xzf $tgz -C $pkgDir --strip-components=1
  if ($LASTEXITCODE -ne 0) { Fail "package-extract" "tar.exe exited $LASTEXITCODE" }
  Remove-Item $tgz -ErrorAction SilentlyContinue
}
$entry = Join-Path $pkgDir "bin\blueprint-os-install.js"
if (-not (Test-Path -LiteralPath $entry)) { Fail "package-extract" "bin\blueprint-os-install.js is missing after download." }

$env:SHOPOS_NODE_BIN = $nodeBin   # stable node path for the autostart
& $nodeBin $entry @args
exit $LASTEXITCODE
