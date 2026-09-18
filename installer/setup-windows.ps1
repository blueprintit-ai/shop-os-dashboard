# Shop OS Dashboard — Windows Setup Bootstrap
#
# Downloads this package's setup CLI and runs it. Deliberately NOT an
# `irm URL | iex` cradle (bypass-policy + env var + pipe-to-iex is exactly the
# shape Defender's Trojan:Win32/Commando.A!ml classifier flagged in the old
# shop-os-installer flow — see notes/windows-defender-false-positive.md in
# that repo). Download to a file, then run the file with -File.
#
# No admin relaunch: nothing here needs elevation. Portable Node and the
# dashboard package both install per-user under %USERPROFILE%\.shopos.

$ErrorActionPreference = "Stop"
$raw = "https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer"

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$setupPs1 = Join-Path $env:TEMP "shop-os-dashboard-setup-$([guid]::NewGuid().ToString('N')).ps1"
try {
  # irm decodes to a string; writing it back with an explicit BOM is what
  # makes Windows PowerShell 5.1's later -File load decode it as UTF-8
  # regardless of system codepage — see the note above.
  $content = Invoke-RestMethod -Uri "$raw/run-setup.ps1" -UseBasicParsing
  [System.IO.File]::WriteAllText($setupPs1, $content, (New-Object System.Text.UTF8Encoding($true)))
  & $setupPs1 @args
} finally {
  Remove-Item $setupPs1 -ErrorAction SilentlyContinue
}
