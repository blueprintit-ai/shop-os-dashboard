#!/bin/bash
# Shop OS Dashboard — run-setup.sh
# Fetched and run by setup-macos.sh. Same reasoning as run-setup.ps1's header
# comment: no Node exists yet, so this uses only native shell tools (curl,
# tar — both preinstalled on macOS).
set -euo pipefail

SHOPOS_HOME="$HOME/.shopos"
APP_DIR="$SHOPOS_HOME/app"
PKG_DIR="$APP_DIR/node_modules/@blueprintitai/shop-os-dashboard"
mkdir -p "$SHOPOS_HOME" "$APP_DIR"

find_qualifying_node() {
  if command -v node >/dev/null 2>&1; then
    major="$(node --version | sed -E 's/^v([0-9]+)\..*/\1/')"
    if [ "$major" -ge 20 ] 2>/dev/null; then command -v node; return; fi
  fi
  found="$(find "$SHOPOS_HOME/runtime" -maxdepth 3 -name node -type f 2>/dev/null | head -n1 || true)"
  [ -n "$found" ] && echo "$found"
}

NODE_BIN="$(find_qualifying_node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "Downloading portable Node.js..."
  ARCH="$(uname -m)"; [ "$ARCH" = "arm64" ] && NODE_ARCH="arm64" || NODE_ARCH="x64"
  # No node yet to parse JSON with — grep the first "lts" entry's version instead.
  VERSION="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v[0-9.]*","date":"[0-9-]*","files":\[[^]]*\],"npm":"[0-9.]*","lts":"[A-Za-z]' | head -n1 | grep -o 'v[0-9.]*' | head -n1)"
  [ -z "$VERSION" ] && VERSION="v22.20.0"
  RUNTIME_DIR="$SHOPOS_HOME/runtime"
  mkdir -p "$RUNTIME_DIR"
  curl -fsSL "https://nodejs.org/dist/$VERSION/node-$VERSION-darwin-$NODE_ARCH.tar.gz" -o "$RUNTIME_DIR/node.tar.gz"
  tar -xzf "$RUNTIME_DIR/node.tar.gz" -C "$RUNTIME_DIR"
  rm -f "$RUNTIME_DIR/node.tar.gz"
  NODE_BIN="$RUNTIME_DIR/node-$VERSION-darwin-$NODE_ARCH/bin/node"
fi
NPM_BIN="$(dirname "$NODE_BIN")/npm"
[ -x "$NPM_BIN" ] || NPM_BIN="npm"

if [ ! -f "$PKG_DIR/bin/shop-os-dashboard-setup.js" ]; then
  echo "Installing Shop OS Dashboard..."
  if ! "$NPM_BIN" install --prefix "$APP_DIR" "@blueprintitai/shop-os-dashboard@latest" >/dev/null 2>&1 || [ ! -f "$PKG_DIR/bin/shop-os-dashboard-setup.js" ]; then
    echo "npm registry unavailable for this package, fetching from GitHub instead..."
    mkdir -p "$PKG_DIR"
    curl -fsSL "https://codeload.github.com/blueprintit-ai/shop-os-dashboard/tar.gz/refs/heads/main" -o "$SHOPOS_HOME/shop-os-dashboard.tar.gz"
    tar -xzf "$SHOPOS_HOME/shop-os-dashboard.tar.gz" -C "$PKG_DIR" --strip-components=1
    rm -f "$SHOPOS_HOME/shop-os-dashboard.tar.gz"
    (cd "$PKG_DIR" && "$NPM_BIN" install --production >/dev/null 2>&1)
  fi
fi

exec "$NODE_BIN" "$PKG_DIR/bin/shop-os-dashboard-setup.js" "$@"
