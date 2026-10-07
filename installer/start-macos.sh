#!/bin/bash
# Blueprint OS - macOS starter. One job: make sure Node.js exists, fetch the installer
# package, hand over to blueprint-os-install.js. All real work happens there.
set -u
SERVER="${SHOPOS_LICENSE_SERVER:-https://shop-os-license-server.glenn-15d.workers.dev}"
SHOPOS="$HOME/.shopos"
PKG_DIR="$SHOPOS/app/node_modules/@blueprintitai/shop-os-dashboard"
ALPHA=ABCDEFGHJKLMNPQRSTUVWXYZ23456789
CODE="BP-"; for _ in 1 2 3 4; do CODE="$CODE${ALPHA:$((RANDOM % 32)):1}"; done

json_str() { # $1 text -> JSON-safe: home dir hidden, control chars dropped, \ and " escaped, 400 chars max
  local s="${1//"$HOME"/\~}"
  s="$(printf '%s' "$s" | LC_ALL=C tr -d '\000-\037' | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  printf '%s' "${s:0:400}"
}

fail() { # $1 stage, $2 message
  echo; echo "Setup hit a problem at \"$1\". We've been notified and will email you shortly. If you contact us, quote support code $CODE."
  curl -fsS -m 8 -X POST "$SERVER/install-log" -H 'Content-Type: application/json' \
    -d "{\"license_key\":\"$(json_str "${SHOPOS_LICENSE_KEY:-unknown}")\",\"status\":\"error\",\"step\":\"starter:$1\",\"error_message\":\"$(json_str "$2")\",\"support_code\":\"$CODE\",\"machine\":{\"os\":\"macOS $(json_str "$(sw_vers -productVersion 2>/dev/null)")\",\"source\":\"installer-v2-starter\"}}" >/dev/null 2>&1 || true
  exit 1
}
mkdir -p "$SHOPOS" || fail setup "could not create ~/.shopos"

# 1. Node 20+: system Node if new enough, else a portable copy under ~/.shopos/runtime.
NODE_BIN=""
if command -v node >/dev/null 2>&1 && [ "$(node --version 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/')" -ge 20 ] 2>/dev/null; then NODE_BIN="$(command -v node)"; fi
[ -z "$NODE_BIN" ] && NODE_BIN="$(find "$SHOPOS/runtime" -maxdepth 3 -name node -type f 2>/dev/null | head -n1)"
if [ -z "$NODE_BIN" ]; then
  echo "Downloading Node.js (one time)..."
  [ "$(uname -m)" = "arm64" ] && NA=arm64 || NA=x64
  # No node yet to parse JSON with: the first index.json entry carrying an "lts" name is the newest LTS.
  VER="$(curl -fsSL -m 60 https://nodejs.org/dist/index.json 2>/dev/null | tr '}' '\n' | grep '"lts":"' | head -n1 | grep -o '"version":"v[0-9][0-9.]*"' | grep -o 'v[0-9.]*')"
  [[ "$VER" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || VER="v22.20.0"
  mkdir -p "$SHOPOS/runtime"
  curl -fsSL "https://nodejs.org/dist/$VER/node-$VER-darwin-$NA.tar.gz" -o "$SHOPOS/runtime/node.tar.gz" || fail node-download "download failed (curl exit $?)"
  tar -xzf "$SHOPOS/runtime/node.tar.gz" -C "$SHOPOS/runtime" || fail node-download "extract failed (tar exit $?)"
  rm -f "$SHOPOS/runtime/node.tar.gz"
  NODE_BIN="$SHOPOS/runtime/node-$VER-darwin-$NA/bin/node"
fi
[ -x "$NODE_BIN" ] || fail node-download "Node was not found after download."

# 2. The installer package (test hook: SHOPOS_PACKAGE_DIR uses a local checkout).
if [ -n "${SHOPOS_PACKAGE_DIR:-}" ]; then PKG_DIR="$SHOPOS_PACKAGE_DIR"; else
  echo "Fetching the Blueprint OS installer..."
  mkdir -p "$PKG_DIR" || fail package-download "could not create the package folder"
  curl -fsSL "https://codeload.github.com/blueprintit-ai/shop-os-dashboard/tar.gz/refs/heads/main" -o "$SHOPOS/installer.tar.gz" || fail package-download "download failed (curl exit $?)"
  tar -xzf "$SHOPOS/installer.tar.gz" -C "$PKG_DIR" --strip-components=1 || fail package-extract "extract failed (tar exit $?)"
  rm -f "$SHOPOS/installer.tar.gz"
fi
[ -f "$PKG_DIR/bin/blueprint-os-install.js" ] || fail package-extract "bin/blueprint-os-install.js is missing after download."

# 3. Hand over (exec: the installer's exit code is ours).
exec "$NODE_BIN" "$PKG_DIR/bin/blueprint-os-install.js" "$@"
