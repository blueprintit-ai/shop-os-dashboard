#!/bin/bash
# Blueprint OS - macOS starter. One job: make sure Node.js exists, fetch the installer
# package, hand over to blueprint-os-install.js. All real work happens there.
set -u
SERVER="${SHOPOS_LICENSE_SERVER:-https://shop-os-license-server.glenn-15d.workers.dev}"
SHOPOS="$HOME/.shopos"
PKG_DIR="$SHOPOS/app/node_modules/@blueprintitai/shop-os-dashboard"
ALPHA=ABCDEFGHJKLMNPQRSTUVWXYZ23456789
CODE="BP-"; for _ in 1 2 3 4; do CODE="$CODE${ALPHA:$((RANDOM % 32)):1}"; done

json_str() { # $1 text -> JSON-safe: home dir hidden, non-printable dropped, cut at 400, THEN \ and " escaped
  local t="~" s="$1"; s="${s//"$HOME"/$t}"
  s="$(printf '%s' "$s" | LC_ALL=C tr -cd '\040-\176')"; s="${s:0:400}"
  printf '%s' "$s" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'
}

fail() { # $1 stage, $2 message
  echo; echo "Setup hit a problem at \"$1\". We've been notified and will email you shortly. If you contact us, quote support code $CODE."
  curl -fsS -m 8 -X POST "$SERVER/install-log" -H 'Content-Type: application/json' \
    -d "{\"license_key\":\"$(json_str "${SHOPOS_LICENSE_KEY:-unknown}")\",\"status\":\"error\",\"step\":\"starter:$1\",\"error_message\":\"$(json_str "$2")\",\"support_code\":\"$CODE\",\"machine\":{\"os\":\"macOS $(json_str "$(sw_vers -productVersion 2>/dev/null)")\",\"source\":\"installer-v2-starter\"}}" >/dev/null 2>&1 || true
  exit 1
}
mkdir -p "$SHOPOS" || fail setup "could not create ~/.shopos"

# 1. Node 20+: system Node if new enough, else a portable copy under ~/.shopos/runtime (checksummed).
node_ok() { [ "$("$1" --version 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/')" -ge 20 ] 2>/dev/null; }
NODE_BIN=""
if command -v node >/dev/null 2>&1 && node_ok node; then NODE_BIN="$(command -v node)"; fi
if [ -z "$NODE_BIN" ]; then
  while IFS= read -r f; do node_ok "$f" && { NODE_BIN="$f"; break; }; done < <(find "$SHOPOS/runtime" -maxdepth 3 -name node -type f 2>/dev/null)
fi
if [ -z "$NODE_BIN" ]; then
  echo "Downloading Node.js (one time)..."
  [ "$(uname -m)" = "arm64" ] && NA=arm64 || NA=x64
  # No node yet to parse JSON with: the first LTS entry of a supported major (22 or 24) in index.json.
  VER="$(curl -fsSL -m 60 https://nodejs.org/dist/index.json 2>/dev/null | tr '}' '\n' | grep '"lts":"' | grep -oE '"version":"v(22|24)\.[0-9]+\.[0-9]+"' | head -n1 | grep -oE 'v[0-9.]+')"
  [[ "$VER" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || VER="v22.20.0"
  NAME="node-$VER-darwin-$NA"; BASE="https://nodejs.org/dist/$VER"
  TMP="$(mktemp -d "$SHOPOS/tmp.XXXXXX")" || fail node-download "could not create a temp folder"
  curl -fsSL "$BASE/$NAME.tar.gz" -o "$TMP/node.tar.gz" || fail node-download "download failed (curl exit $?)"
  curl -fsSL -m 60 "$BASE/SHASUMS256.txt" -o "$TMP/sums" || fail node-download "checksum list download failed (curl exit $?)"
  WANT="$(grep " $NAME.tar.gz\$" "$TMP/sums" | awk '{print $1}' | head -n1)"
  GOT="$(shasum -a 256 "$TMP/node.tar.gz" | awk '{print $1}')"
  { [ -n "$WANT" ] && [ "$WANT" = "$GOT" ]; } || fail node-download "Node checksum did not match"
  mkdir "$TMP/x" && tar -xzf "$TMP/node.tar.gz" -C "$TMP/x" || fail node-download "extract failed (tar exit $?)"
  mkdir -p "$SHOPOS/runtime" && rm -rf "$SHOPOS/runtime/$NAME" && mv "$TMP/x/$NAME" "$SHOPOS/runtime/$NAME" || fail node-download "could not move Node into place"
  rm -rf "$TMP"
  NODE_BIN="$SHOPOS/runtime/$NAME/bin/node"
  node_ok "$NODE_BIN" || fail node-download "Node did not run after download."
fi

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
