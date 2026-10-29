# Development

MinimaxDeck maintains the Linux integration around the upstream MiniMax Code desktop application. It does not include the proprietary application bundle or a separate chat frontend.

## Source layout

| Path | Purpose |
| --- | --- |
| `install.sh`, `uninstall.sh` | Per-user installation and removal |
| `minimax-code.sh` | Desktop launcher and background updates |
| `updater/minimax-update.js` | Verified upstream download, Linux rebuild, staging and rollback |
| `updater/upd-core.js` | Downloads, ASAR handling and runtime verification |
| `updater/select-runtime.sh` | Complete-runtime selection shared by both launchers |
| `updater/shim/linux-shim.js` | MiniMax updater bridge and Linux window/profile integration |
| `updater/runtime-pins.json` | Supported native dependency mapping and terminal version |
| `tests` | Disposable integration regression tests |

## Check changes

```bash
node --test tests/*.test.cjs
for f in install.sh minimax-code.sh uninstall.sh updater/*.sh; do sh -n "$f" || exit; done
for f in updater/*.js updater/shim/*.js; do node --check "$f" || exit; done
```

Run the optional native rollback test with `MINIMAX_TEST_ELECTRON=/absolute/path/to/minimax-code`. It uses fixture directories and a harmless subprocess, not your real installation.

## Isolated installs

Use a disposable container or separate Linux user for full installs. Override `MINIMAX_CODE_ROOT`, `MINIMAX_UPDATE_CACHE`, `XDG_BIN_HOME`, and `XDG_DATA_HOME`. For GUI checks, also isolate `XDG_CONFIG_HOME` and `MINIMAX_CODE_USERDATA` and disable background staging.

Installation builds node-pty 1.1.0 with node-gyp 11.4.2 on that distribution. Do not copy Fedora's compiled PTY into Debian. Before a new app directory receives its completion marker, the updater tests the database and a real terminal subprocess under its Electron runtime. Reinstallation uses `--rebuild` so changes to the embedded Linux shim are applied without needing a newer upstream release.

Update operations use `flock` from util-linux. The kernel releases the lock after a crash; the lock file remains on disk. Active PID files from the previous updater are respected during migration. Do not remove an active lock file to bypass another updater.

Application bundles, runtime archives, compiled modules, profiles and credentials must remain outside Git. Review upstream native dependency changes before updating the supported baseline.
