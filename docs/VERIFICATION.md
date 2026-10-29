# Verification

Reviewed and tested on October 29, 2026. Baseline: MiniMax Code 3.1.7 and Electron 42.8.0, Linux x86-64.

## Installation and runtime

| Check | Fedora 44 | Debian 12 | Debian 13 |
| --- | --- | --- | --- |
| Documented prerequisites install | Passed | Passed | Passed |
| Full install as an unprivileged user | Passed | Passed | Passed |
| node-pty built from source on that distribution | Passed | Passed | Passed |
| SQLite query and real terminal subprocess in Electron | Passed | Passed | Passed |
| Application icon and launcher generation | Passed | Passed | Passed |
| Empty-profile GUI reaches sign-in | Passed | Passed | Passed |
| Local application runtime reaches ready state | Passed | Passed | Passed |
| Official update-feed check reports 3.1.7 current | Passed | Passed | Passed |

The Fedora and Debian 12 installs used a copy of the official 3.1.7 installer, independently checked against the feed's SHA-512 and 532,915,000-byte size. All runtime and native dependencies were downloaded by the installer and verified. These tests used fresh containers and separate users, with no copied account data.

Debian 13 used the default `bash install.sh` path: feed discovery, upstream download and checksum verification, native dependency installation, rebuild, and launcher setup all completed successfully.

The GUI checks used Xvfb with container-only `--no-sandbox --disable-gpu` flags. Those flags are not enabled by the normal installer. Screenshots show actual empty-profile sign-in screens, not signed-in coding sessions.

## Automated checks

All 36 tests passed on Fedora 44, Debian 12, and Debian 13, with the native Electron tests enabled. The regression suite covers installer argument validation, unrelated launcher preservation, icon extraction, interrupted downloads, incomplete runtime exclusion, damaged installs, cleanup boundaries, same-version rollback repair, invalid rollback rejection, process-inspection failure, uninstall profile preservation, and explicit purge.

The optional native tests run the updater under Electron. They confirm that reinstallation refuses a running app, rollback protects both app and fallback runtimes, the updater ignores its own process, and installation paths containing brackets work. Portable CI skips two tests when no Electron executable is supplied.

The review also exercised simultaneous update-lock contenders, recovery after killing the lock owner, migration from legacy PID files, failed activation recovery, reinstalling the same upstream version, malformed archive rejection, and the in-app update bridge. The bridge tests simulate update discovery, staging, disabled automatic downloads, profile isolation, and retry after a process-launch failure. They are not live account sign-in tests.

The refined installer successfully rebuilt existing Fedora 44 and Debian 12 installations at the same upstream version. Debian 13 also completed a new install from the official feed using installation, launcher and desktop-entry paths containing spaces and brackets. The terminal and SQLite checks passed again during each rebuild. Optional-platform ASAR entries absent from the official Windows package remain supported.

Shell syntax and JavaScript parsing are checked separately. CI runs portable tests on Node 18, 20 and 22; local container results are recorded here rather than represented as GitHub CI runs.

## Review fixes

| Original issue | Change |
| --- | --- |
| Fedora-built PTY shipped to other distributions; older glibc failures were tolerated | Build the terminal module locally and require a successful real terminal test before completing installation |
| Marker-only and unfinished versions could be selected | Share complete-runtime validation between launchers and updater |
| Unknown uninstall arguments could remove the installation | Validate arguments before side effects and preserve unrelated commands |
| Local version input could escape version-directory paths | Require numeric versions before constructing build paths |
| Interrupted downloads could hang | Use stream pipeline error handling |
| ASAR symlinks could escape the extraction tree | Reject ASAR symlinks |
| Prune and rollback could remove unrelated temporary folders | Restrict cleanup to numeric app-version directories |
| Rollback lacked live-process and complete-backup checks | Validate the backup, block running apps, ignore the updater itself, and fail closed on process-check errors |
| Process checks treated installation paths as regular expressions | Escape paths before matching |
| Desktop icon relied on a pre-existing installation | Extract the upstream icon during installation |
| Same-version reinstallation could keep an old embedded integration | Rebuild the app during installation and refuse to replace a running app |
| Stale PID-file recovery could let concurrent updaters overlap | Use kernel-managed flock, including crash recovery and legacy-lock migration |
| Failed activation could leave the old app renamed away | Restore the previous version if activation fails |
| Malformed archive headers and data offsets were unchecked | Validate archive bounds and close file descriptors on errors |
| A command mentioning an app path could appear to be the app | Anchor process matching to the executable at the start of the command |
| An updater process-launch exception could prevent retry | Clear the in-app running state after all results and bound diagnostic buffering |

## Remaining checks

Live account sign-in, sign-out, account persistence, paid prompts, long coding sessions, third-party browser authorization, screen capture and computer-control tools were not exercised. No user credentials or subscription usage were used.

Full GNOME/Wayland integration and normal desktop sandbox behavior need a real desktop check. A container startup test does not certify those. Update discovery and isolated rollback were tested; activation of a future upstream release and profile compatibility after downgrading remain unverified.

The proprietary upstream bundle was not audited in full. This review covers the custom Linux integration and the installation path. Windows session-transfer components remain excluded.
