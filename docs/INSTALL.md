# Install MinimaxDeck

Fedora and Debian use the same installer. Linux x86-64, Node 18 or newer, internet access, and several gigabytes of temporary disk space are required.

## System packages

**Fedora 44**

```bash
sudo dnf install nodejs npm git tar make gcc-c++ python3 7zip diffutils procps-ng util-linux gtk3 nss alsa-lib libXScrnSaver libXtst libxkbcommon mesa-libgbm
```

**Debian 12**

```bash
sudo apt update
sudo apt install nodejs npm git tar build-essential python3 7zip ca-certificates diffutils procps util-linux libgtk-3-0 libnss3 libasound2 libxss1 libxtst6 libxkbcommon0 libgbm1
```

**Debian 13**

```bash
sudo apt update
sudo apt install nodejs npm git tar build-essential python3 7zip ca-certificates diffutils procps util-linux libgtk-3-0t64 libnss3 libasound2t64 libxss1 libxtst6 libxkbcommon0 libgbm1
```

See [verification](VERIFICATION.md) for tested distributions and limitations.

## Install and launch

Clone the repository using an account with access, or use your existing local checkout:

```bash
git clone https://github.com/OSINTCabal/MinimaxDeck.git
cd MinimaxDeck
bash install.sh
~/.local/bin/minimaxdeck
```

Run the installer as your normal user. Install system packages separately with sudo. The installer builds the terminal module on the target distribution, downloads and verifies upstream dependencies, checks the database and terminal in Electron, and adds application-menu and terminal launchers.

If `~/.local/bin` is on your `PATH`, `minimaxdeck` works directly. Otherwise use the full path above. Close MiniMax Code before reinstalling. Reinstallation rebuilds the app with the current Linux integration even when the upstream version is unchanged. Existing profiles are preserved. Run one installer at a time; updater operations use a kernel lock to prevent overlapping stage, prune, and rollback operations.

For a local upstream package:

```bash
bash install.sh --from-file "/path/to/MiniMax Code Setup 3.1.7.exe" --version 3.1.7
```

The supplied version must match the package. Local packages do not receive independent feed verification. Feed downloads use official SHA-512 metadata; Electron downloads use its published checksums, and dependency downloads use npm integrity or GitHub asset digests.

## Desktop settings

- `MINIMAX_FORCE_X11=1` selects XWayland instead of automatic display selection.
- `MINIMAX_NO_AUTO_UPDATE=1` disables background update staging.
- `MINIMAX_LINUX_DEBUG=1` enables Linux integration logs.
- `MINIMAX_CODE_USERDATA` selects an isolated desktop profile.

The launcher preserves Electron sandboxing by default. Container-only GUI tests may disable it; that does not belong in a normal desktop launcher.
