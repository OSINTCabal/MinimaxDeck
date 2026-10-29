#!/bin/sh
set -eu
SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT="${MINIMAX_CODE_ROOT:-$HOME/.local/opt/minimax-code}"
BIN="${XDG_BIN_HOME:-$HOME/.local/bin}"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
case "${1:-}" in --help|-h) echo 'Usage: bash install.sh [--from-file setup.exe --version X.Y.Z]'; exit 0;; esac
if [ "$#" -ne 0 ]; then
  [ "$#" -eq 4 ] && [ "$1" = --from-file ] && [ "$3" = --version ] && [ -f "$2" ] && printf '%s\n' "$4" | grep -Eq '^[0-9]+(\.[0-9]+)+$' || { echo 'Invalid arguments. Use --help.' >&2; exit 2; }
fi
case "$ROOT" in /*) ;; *) echo 'Installation root must be absolute.' >&2; exit 1;; esac
ROOT=$(readlink -m "$ROOT")
case "$ROOT" in /|"$HOME"|"$HOME/.local"|"$HOME/.local/opt"|"$SRC") echo 'Unsafe installation root.' >&2; exit 1;; esac
for alias in minimaxdeck minimax-code minimaxcode; do
  target="$BIN/$alias"
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -L "$target" ] && [ "$(readlink "$target")" = "$ROOT/minimax-code.sh" ] || { echo "Refusing to replace $target" >&2; exit 1; }
  fi
done
[ "$(uname -s)" = Linux ] || { echo 'MinimaxDeck requires Linux.' >&2; exit 1; }
case "$(uname -m)" in x86_64) ;; *) echo 'MinimaxDeck currently requires Linux x86-64.' >&2; exit 1;; esac
for tool in node npm tar git make g++ python3 cmp pgrep flock; do
  command -v "$tool" >/dev/null || { echo "Missing $tool. See docs/INSTALL.md for Fedora and Debian prerequisites." >&2; exit 1; }
done
node -e 'if(Number(process.versions.node.split(".")[0])<18)process.exit(1)'
command -v 7zz >/dev/null || command -v 7z >/dev/null || { echo 'Install 7zip first.' >&2; exit 1; }
node - "$ROOT" "$SRC/updater/upd-core.js" <<'JS'
const fs = require('fs'), path = require('path'), C = require(process.argv[3]);
const root = process.argv[2];
if (fs.existsSync(root)) for (const d of fs.readdirSync(root)) {
  if (/^(app|rollback)-\d+(\.\d+)+$/.test(d) && C.isRunning(path.join(root,d))) throw new Error('Close MiniMax Code before reinstalling.');
}
JS
mkdir -p "$ROOT/updater/shim" "$ROOT/updater/assets" "$ROOT/share" "$BIN" "$DATA/applications"
cp "$SRC"/updater/*.js "$SRC"/updater/*.json "$SRC"/updater/*.sh "$ROOT/updater/"
cp "$SRC"/updater/shim/* "$ROOT/updater/shim/"
cp "$SRC/minimax-code.sh" "$SRC/uninstall.sh" "$SRC/VERSION" "$ROOT/"
cp -R "$SRC/share/." "$ROOT/share/"
chmod +x "$ROOT/minimax-code.sh" "$ROOT/uninstall.sh" "$ROOT/updater/run-update.sh"
# npm verifies registry integrity; keep the native build outside the source tree.
npm install --prefix "$ROOT/updater/native-build" --ignore-scripts --no-audit --no-fund --save-exact node-pty@1.1.0 node-gyp@11.4.2
node "$ROOT/updater/native-build/node_modules/node-gyp/bin/node-gyp.js" rebuild --directory "$ROOT/updater/native-build/node_modules/node-pty"
PTY="$ROOT/updater/native-build/node_modules/node-pty/build/Release/pty.node"
[ -f "$PTY" ] || { echo 'node-pty build produced no pty.node' >&2; exit 1; }
node -e 'require(process.argv[1])' "$PTY"
cp "$PTY" "$ROOT/updater/assets/pty.node"
if [ -f "$(dirname "$PTY")/spawn-helper" ]; then cp "$(dirname "$PTY")/spawn-helper" "$ROOT/updater/assets/spawn-helper"; fi
MINIMAX_CODE_ROOT="$ROOT" node "$ROOT/updater/minimax-update.js" --stage --rebuild "$@"
. "$ROOT/updater/select-runtime.sh"
APP=$(select_runtime)
node "$ROOT/updater/install-icon.js" "$APP/resources/app.asar" "$ROOT/share/minimax-code.png"
for alias in minimaxdeck minimax-code minimaxcode; do
  target="$BIN/$alias"
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -L "$target" ] && [ "$(readlink "$target")" = "$ROOT/minimax-code.sh" ] || { echo "Refusing to replace $target" >&2; exit 1; }
  fi
  ln -sfn "$ROOT/minimax-code.sh" "$target"
done
node -e 'const fs=require("fs");fs.writeFileSync(process.argv[2],fs.readFileSync(process.argv[1],"utf8").replace(/^Exec=@BIN@/gm,()=>"Exec="+JSON.stringify(process.argv[3])).replaceAll("@BIN@",()=>process.argv[3]).replaceAll("Icon=minimax-code",()=>"Icon="+process.argv[4]))' "$ROOT/share/minimax-code.desktop" "$DATA/applications/minimax-code.desktop" "$BIN/minimaxdeck" "$ROOT/share/minimax-code.png"
echo "Installed. Run: $BIN/minimaxdeck"
