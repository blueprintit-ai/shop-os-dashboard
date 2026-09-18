# Shop OS Dashboard — run-setup.ps1
# Fetched and run by setup-windows.ps1. No Node exists on this machine yet
# when this runs, so it uses only native PowerShell (Expand-Archive, tar.exe
# — bundled since Windows 10 1803) rather than installer/node-runtime.js,
# which is Node code. See this task's header note for why.
$ErrorActionPreference = "Stop"
$shoposHome = Join-Path $env:USERPROFILE ".shopos"
$appDir = Join-Path $shoposHome "app"
$pkgDir = Join-Path $appDir "node_modules\@blueprintitai\shop-os-dashboard"
New-Item -ItemType Directory -Force -Path $shoposHome, $appDir | Out-Null

function Find-QualifyingNode {
  try {
    $v = & node --version 2>$null
    if ($LASTEXITCODE -eq 0 -and $v -match '^v(\d+)\.' -and [int]$Matches[1] -ge 20) { return "node" }
  } catch {}
  $portable = Get-ChildItem -Path (Join-Path $shoposHome "runtime") -Filter "node.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portable) { return $portable.FullName }
  return $null
}

$nodeBin = Find-QualifyingNode
if (-not $nodeBin) {
  Write-Host "Downloading portable Node.js..."
  $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/index.json" -UseBasicParsing
  $lts = $index | Where-Object { $_.lts } | Select-Object -First 1
  $version = if ($lts -and $lts.version -match '^v\d+\.\d+\.\d+$') { $lts.version } else { "v22.20.0" }
  $runtimeDir = Join-Path $shoposHome "runtime"
  New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
  $zipPath = Join-Path $env:TEMP "node-$version.zip"
  Invoke-WebRequest -Uri "https://nodejs.org/dist/$version/node-$version-win-x64.zip" -OutFile $zipPath -UseBasicParsing
  Expand-Archive -Path $zipPath -DestinationPath $runtimeDir -Force
  Remove-Item $zipPath -ErrorAction SilentlyContinue
  $nodeBin = Join-Path $runtimeDir "node-$version-win-x64\node.exe"
}
# Find-QualifyingNode returns the literal "node" for the system-Node case
# (no ".exe" to replace, so a bare -replace leaves it unchanged as "node" —
# not a valid npm invocation). Only the portable/full-path case can use the
# node.exe -> npm.cmd sibling substitution; the system case needs npm.cmd
# directly, since it's already on PATH alongside node.
$npmBin = if ($nodeBin -eq "node") { "npm.cmd" } else { $nodeBin -replace "node\.exe$", "npm.cmd" }

if (-not (Test-Path (Join-Path $pkgDir "bin\shop-os-dashboard-setup.js"))) {
  Write-Host "Installing Shop OS Dashboard..."
  & $npmBin install --prefix $appDir "@blueprintitai/shop-os-dashboard@latest" 2>$null
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $pkgDir "bin\shop-os-dashboard-setup.js"))) {
    Write-Host "npm registry unavailable for this package, fetching from GitHub instead..."
    New-Item -ItemType Directory -Force -Path $pkgDir | Out-Null
    $tarPath = Join-Path $env:TEMP "shop-os-dashboard.tar.gz"
    Invoke-WebRequest -Uri "https://codeload.github.com/blueprintit-ai/shop-os-dashboard/tar.gz/refs/heads/main" -OutFile $tarPath -UseBasicParsing
    & tar -xzf $tarPath -C $pkgDir --strip-components=1
    Remove-Item $tarPath -ErrorAction SilentlyContinue
    Push-Location $pkgDir
    & $npmBin install --production 2>$null
    Pop-Location
  }
}

& $nodeBin (Join-Path $pkgDir "bin\shop-os-dashboard-setup.js") @args
