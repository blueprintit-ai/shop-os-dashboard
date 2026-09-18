#!/bin/bash
# Shop OS Dashboard — macOS Setup Bootstrap
#
# Downloads this package's setup script to a file and runs the file, rather
# than piping curl straight into bash — same non-cradle principle as the
# Windows bootstrap (see installer/setup-windows.ps1's header comment).
set -euo pipefail

RAW="https://raw.githubusercontent.com/blueprintit-ai/shop-os-dashboard/main/installer"
TMP_SCRIPT="$(mktemp -t shop-os-dashboard-setup)"
trap 'rm -f "$TMP_SCRIPT"' EXIT

curl -fsSL "$RAW/run-setup.sh" -o "$TMP_SCRIPT"
chmod +x "$TMP_SCRIPT"
"$TMP_SCRIPT" "$@"
