#!/bin/sh
# Usage: uninstall.sh [--purge] (also delete user data) | --revert (restore pre-updater install) | --rollback (go back one version)
set -eu
case "${1:-}" in
  --help|-h) echo 'Usage: uninstall.sh [--purge|--revert|--rollback]'; exit 0;;
  ''|--purge|--revert|--rollback) ;;
  *) echo 'Unknown option. Use --help.' >&2; exit 2;;
esac
[ "$#" -le 1 ] || { echo 'Expected at most one option.' >&2; exit 2; }
ID=minimax-code; BIN=minimax-code
OPT="${MINIMAX_CODE_ROOT:-$HOME/.local/opt/$ID}"; DATA="${XDG_DATA_HOME:-$HOME/.local/share}"; UNIT="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
OPT=$(readlink -m "$OPT")
case "$OPT" in ""|/|"$HOME"|"$HOME/.local"|"$HOME/.local/opt") echo 'unsafe installation root' >&2; exit 1;; esac
[ -f "$OPT/minimax-code.sh" ] && [ -f "$OPT/updater/minimax-update.js" ] || { echo 'not a MiniMax Code installation' >&2; exit 1; }
case "${1:-}" in --rollback) exec "$OPT/updater/run-update.sh" --rollback;; esac
# Escape installation paths before using them as a process-matching expression.
MATCH=$(printf '%s\n' "$OPT" | sed 's/[][\\.^$*+?(){}|]/\\&/g')
pkill -u "$(id -u)" -f "^$MATCH/app-[0-9][^/]*/minimax-code( |$)" 2>/dev/null || true
if command -v systemctl >/dev/null; then systemctl --user disable --now $ID-update.timer 2>/dev/null || true; fi
rm -f "$UNIT/$ID-update.timer" "$UNIT/$ID-update.service"; systemctl --user daemon-reload 2>/dev/null || true
rm -f "$DATA/applications/minimax-code.desktop" "${XDG_CONFIG_HOME:-$HOME/.config}/autostart/minimax-code.desktop"
for s in 16 22 24 32 48 64 128 256 512; do rm -f "$DATA/icons/hicolor/${s}x${s}/apps/minimax-code.png"; done
rm -rf "$OPT" "${XDG_CACHE_HOME:-$HOME/.cache}/$ID-updater"

if [ "${1:-}" = "--revert" ] && [ -d "$HOME/.local/opt/$ID.pre-updater" ]; then
  mv "$HOME/.local/opt/$ID.pre-updater" "$OPT"; echo "restored pre-updater install at $OPT (re-run its own install.sh to restore launcher/desktop entries)"
else
  for alias in minimax-code minimaxcode minimaxdeck; do
    link="${XDG_BIN_HOME:-$HOME/.local/bin}/$alias"
    if [ -L "$link" ] && [ "$(readlink "$link")" = "$OPT/minimax-code.sh" ]; then rm -f "$link"; fi
  done
fi
[ "${1:-}" = "--purge" ] && rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/minimax-code" "${XDG_CACHE_HOME:-$HOME/.cache}/minimax-code-updater"
echo "$ID removed"
