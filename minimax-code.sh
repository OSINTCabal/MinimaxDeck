#!/bin/sh
# MiniMax Code (Linux) launcher: runs the highest complete app-<ver>/ under ~/.local/opt/minimax-code
#   minimax-code [--check-updates] [args]  |  minimax-code --update [--check|--stage|--rollback|--prune] [--json]
# Single instance: the app holds Electron's single-instance lock; a second launch (or a minimax:// link,
# or --check-updates) is forwarded to the running window and exits.
# Env: MINIMAX_FORCE_X11=1 (XWayland), MINIMAX_NO_SANDBOX=1, MINIMAX_NO_AUTO_UPDATE=1, MINIMAX_LINUX_DEBUG=1
ROOT="${MINIMAX_CODE_ROOT:-$(dirname "$(readlink -f "$0")")}"
export MINIMAX_CODE_ROOT="$ROOT" MINIMAX_CODE_LAUNCHER="$(readlink -f "$0")"
. "$ROOT/updater/select-runtime.sh"
if [ "${1:-}" = "--update" ]; then shift; exec "$ROOT/updater/run-update.sh" "$@"; fi
APP=$(select_runtime) || { echo "minimax-code: no complete installed version in $ROOT" >&2; exit 1; }
MATCH=$(printf '%s\n' "$ROOT" | sed 's/[][\\.^$*+?(){}|]/\\&/g')
if [ "${1:-}" = "--check-updates" ] && ! pgrep -u "$(id -u)" -f "^$MATCH/(app|rollback)-[0-9][^/]*/minimax-code( |$)" >/dev/null 2>&1; then
  # app not running: stage now, report via notification (the running app checks in-app instead)
  R=$("$ROOT/updater/run-update.sh" --stage --json 2>/dev/null | tail -1)
  case "$R" in *ready_to_install*) M="Update installed. Start MiniMax Code to use it.";; *up_to_date*) M="You have the latest version.";; *) M="Update check failed: $R";; esac
  command -v notify-send >/dev/null && notify-send -i minimax-code -a "MiniMax Code" "MiniMax Code" "$M" || echo "$M"; exit 0
fi
# background: prune superseded versions; at most every 6h stage a newer release (used on next launch)
(
  sleep 60; "$ROOT/updater/run-update.sh" --prune
  S="${XDG_CACHE_HOME:-$HOME/.cache}/minimax-code-updater/.last-check"
  if [ -z "${MINIMAX_NO_AUTO_UPDATE:-}" ] && { [ ! -f "$S" ] || [ -n "$(find "$S" -mmin +360 2>/dev/null)" ]; }; then
    mkdir -p "$(dirname "$S")"; touch "$S"; "$ROOT/updater/run-update.sh" --stage --json >/dev/null 2>&1
  fi
) >/dev/null 2>&1 &
export CHROME_DESKTOP=minimax-code.desktop
FLAGS="--enable-features=WebRTCPipeWireCapturer,GlobalShortcutsPortal,WaylandWindowDecorations"
if [ -n "${MINIMAX_FORCE_X11:-}" ]; then FLAGS="$FLAGS --ozone-platform=x11"; else FLAGS="$FLAGS --ozone-platform-hint=auto"; [ -n "${WAYLAND_DISPLAY:-}" ] && FLAGS="$FLAGS --enable-wayland-ime"; fi
[ -n "${MINIMAX_NO_SANDBOX:-}" ] && FLAGS="$FLAGS --no-sandbox"
exec "$APP/minimax-code" $FLAGS "$@"
