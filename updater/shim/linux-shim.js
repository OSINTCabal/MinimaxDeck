// MiniMax Code for Linux entry (package.json main). Loads Linux integration, then the original dist/main/index.js.
//  * electron-updater's autoUpdater -> MiniMaxLinuxUpdater (drives updater/minimax-update.js: official latest.yml ->
//    verified Windows setup.exe -> rebuilt Linux app-<ver>/ -> relaunch through the launcher).
//  * `minimax-code --check-updates` (first or second instance) runs an in-app update check.
//  * Chrome-on-Linux User-Agent for third-party web sign-in pages (Google/Apple/GitHub/Microsoft reject "Electron").
//  * desktop-file name for taskbar grouping / xdg-settings protocol registration.
'use strict';
const { app } = require('electron');
const path = require('path'), fs = require('fs'), cp = require('child_process'), EventEmitter = require('events'), Module = require('module');
if (process.platform === 'linux') {
  const ROOT = process.env.MINIMAX_CODE_ROOT || path.resolve(path.dirname(process.execPath), '..');
  const UPD = path.join(ROOT, 'updater', 'minimax-update.js');
  const LAUNCHER = process.env.MINIMAX_CODE_LAUNCHER || path.join(ROOT, 'minimax-code.sh');
  const dbg = (...a) => { if (process.env.MINIMAX_LINUX_DEBUG) console.error('[minimax-linux]', ...a); };
  try { app.setDesktopName('minimax-code.desktop'); } catch {}
  // Own userData (=> own single-instance lock, caches, logs) so this port coexists with a separately installed
  // "MiniMax Agent" (~/.config/MiniMax Agent). The app's later setPath('userData') calls are redirected here too.
  const UD = process.env.MINIMAX_CODE_USERDATA || path.join(app.getPath('appData'), 'minimax-code');
  const origSetPath = app.setPath.bind(app);
  origSetPath('userData', UD); try { origSetPath('sessionData', UD); } catch {}
  app.setPath = (n, p) => (n === 'userData' || n === 'sessionData') ? origSetPath(n, UD) : origSetPath(n, p);
  // Never claim the minimax:// scheme (xdg-settings) from the other install; sign-in completes via the app's own polling.
  app.setAsDefaultProtocolClient = () => false;
  app.removeAsDefaultProtocolClient = () => false;

  class MiniMaxLinuxUpdater extends EventEmitter {
    constructor() {
      super();
      this.autoDownload = true; this.autoInstallOnAppQuit = false; this.disableWebInstaller = true; this.disableDifferentialDownload = true;
      this.forceDevUpdateConfig = false; this.allowPrerelease = false; this.allowDowngrade = false; this.channel = null; this.fullChangelog = false;
      this.logger = null; this.feed = process.env.MINIMAX_UPDATE_URL || null; this.pending = null; this.running = null; this.info = null;
      this.requestHeaders = null;
    }
    get currentVersion() { return { version: app.getVersion(), toString() { return app.getVersion(); } }; }
    get available() { return fs.existsSync(UPD); }
    setFeedURL(o) { const u = typeof o === 'string' ? o : o && o.url; if (u && !process.env.MINIMAX_UPDATE_URL) this.feed = u; }
    getFeedURL() { return this.feed; }
    addAuthHeader() {}
    _log(l, m) { try { this.logger && this.logger[l] && this.logger[l]('[linux-updater] ' + m); } catch {} dbg('updater', m); }
    _run(mode) {
      if (this.running) return this.running;
      const running = new Promise((resolve) => {
        const a = [UPD, mode, '--json', '--current', app.getVersion()]; if (this.feed) a.push('--feed', this.feed);
        let p; try { p = cp.spawn(process.execPath, a, { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', MINIMAX_CODE_ROOT: ROOT }), stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { return resolve({ status: 'error', message: String(e) }); }
        let buf = '', last = null, err = '';
        p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { const m = JSON.parse(l); last = m; this._msg(m); } catch {} } });
        p.stderr.on('data', (d) => { err = (err + d).slice(-16384); this._log('info', String(d).trim()); });
        p.on('error', (e) => { last = { status: 'error', message: String(e) }; });
        p.on('close', (code) => { if (!last || (code !== 0 && last.status !== 'error')) last = { status: 'error', message: err.trim().split('\n').pop() || 'updater exited ' + code }; resolve(last); });
      });
      this.running = running;
      const clear = () => { if (this.running === running) this.running = null; };
      running.then(clear, clear);
      return running;
    }
    _msg(m) { if (m.status === 'downloading' && typeof m.percent === 'number') this.emit('download-progress', { percent: m.percent, transferred: m.transferred || 0, total: m.total || 0, bytesPerSecond: 0, delta: 0 }); }
    _info(r) { return { version: r.version, releaseNotes: r.releaseNotes || null, releaseName: null, releaseDate: r.releaseDate || new Date().toISOString(), files: [], path: '', sha512: '' }; }
    async checkForUpdates() {
      if (!this.available) return null;
      this.emit('checking-for-update');
      const r = await this._run('--check');
      if (r.status === 'error') { const e = new Error(r.message); this.emit('error', e); throw e; }
      const info = this.info = this._info(r);
      if (r.status !== 'available' && r.status !== 'ready_to_install') { this.emit('update-not-available', info); return { isUpdateAvailable: false, updateInfo: info, versionInfo: info }; }
      this.emit('update-available', info);
      const downloadPromise = this.autoDownload ? this.downloadUpdate() : null;
      if (downloadPromise) downloadPromise.catch(() => {});
      return { isUpdateAvailable: true, updateInfo: info, versionInfo: info, downloadPromise, cancellationToken: { cancel() {} } };
    }
    checkForUpdatesAndNotify() { return this.checkForUpdates(); }
    async downloadUpdate() {
      const r = await this._run('--stage');
      if (r.status !== 'ready_to_install') { const e = new Error(r.message || 'update staging failed: ' + r.status); this.emit('error', e); throw e; }
      this.pending = r.version; const dir = path.join(ROOT, 'app-' + r.version);
      this.emit('update-downloaded', Object.assign({}, this.info || this._info(r), { version: r.version, downloadedFile: dir }));
      return [dir];
    }
    quitAndInstall() {
      this._log('info', 'restarting into ' + (this.pending || 'newest installed version'));
      this.emit('before-quit-for-update');
      const keep = process.argv.slice(1).filter((a) => !/^--(check-updates|enable-features=|ozone-platform|enable-wayland-ime|inspect)/.test(a) && !/^minimax[-a-z]*:/.test(a));
      try { app.relaunch({ execPath: fs.existsSync(LAUNCHER) ? LAUNCHER : process.execPath, args: keep }); } catch (e) { this._log('error', String(e)); }
      setImmediate(() => app.quit()); setTimeout(() => app.exit(0), 8000).unref();
    }
    isUpdaterActive() { return this.available; }
  }
  const upd = globalThis.__minimaxLinuxUpdater = new MiniMaxLinuxUpdater();
  // electron-updater on Linux would pick AppImageUpdater (no AppImage here): substitute ours for every require()
  const origLoad = Module._load;
  Module._load = function (req, parent, isMain) {
    const m = origLoad.apply(this, arguments);
    if (req === 'electron-updater' && m && !m.__minimaxLinux) {
      return new Proxy(m, { get: (t, k) => (k === 'autoUpdater' ? upd : k === '__minimaxLinux' ? true : t[k]) });
    }
    return m;
  };
  const wants = (argv) => Array.isArray(argv) && argv.includes('--check-updates');
  app.on('second-instance', (_e, argv) => { if (wants(argv)) upd.checkForUpdates().catch(() => {}); });
  if (wants(process.argv)) app.whenReady().then(() => setTimeout(() => upd.checkForUpdates().catch(() => {}), 5000));

  // Windows hides the native menu row (integrated title bar); on Linux keep the GNOME-decorated frame but auto-hide the
  // menu bar (Alt shows it; accelerators keep working)
  app.on('browser-window-created', (_e, w) => { try { w.setAutoHideMenuBar(true); w.setMenuBarVisibility(false); } catch {} });

  // third-party web sign-in: present a plain Chrome-on-Linux UA (header) so OAuth providers do not block the embedded login
  const CHROME_UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`;
  const AUTH = /^https:\/\/(accounts\.google\.com|accounts\.youtube\.com|appleid\.apple\.com|github\.com\/(login|session|sessions)|login\.microsoftonline\.com|login\.live\.com)(\/|$)/;
  app.on('session-created', (s) => {
    try { s.webRequest.onBeforeSendHeaders({ urls: ['https://*/*'] }, (d, cb) => { if (AUTH.test(d.url)) d.requestHeaders['User-Agent'] = CHROME_UA; cb({ requestHeaders: d.requestHeaders }); }); } catch (e) { dbg('ua hook', e); }
  });
  app.on('web-contents-created', (_e, wc) => {
    wc.on('did-start-navigation', (d) => { try { if (d.isMainFrame && AUTH.test(d.url) && wc.getUserAgent() !== CHROME_UA) wc.setUserAgent(CHROME_UA); } catch {} });
  });
}
require('./index.js');
