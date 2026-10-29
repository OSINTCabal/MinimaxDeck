#!/bin/sh
ROOT="${MINIMAX_CODE_ROOT:-$(dirname "$(dirname "$(readlink -f "$0")")")}"
export MINIMAX_CODE_ROOT="$ROOT"
. "$ROOT/updater/select-runtime.sh"
APP=$(select_runtime) && EXE="$APP/minimax-code" || EXE=$(command -v node)
[ -x "$EXE" ] || { echo "No MiniMax Code runtime or Node found" >&2; exit 1; }
ELECTRON_RUN_AS_NODE=1 exec "$EXE" "$ROOT/updater/minimax-update.js" "$@"
