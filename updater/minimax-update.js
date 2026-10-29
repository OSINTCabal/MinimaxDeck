#!/usr/bin/env node
// MiniMax Code for Linux — per-user updater. Run with the bundled Electron in node mode (run-update.sh).
//   --check | --stage [--json] [--feed URL] [--current V] [--from-file setup.exe --version V] | --rollback | --prune
// Feed: MiniMax's official electron-updater generic feed (latest.yml). The Windows setup .exe is verified by
// sha512+size from latest.yml, unpacked with 7zz and rebuilt into app-<ver>/ on the matching official Electron
// Linux runtime; Windows native modules are swapped for verified Linux builds (npm integrity / GitHub digests).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const C = require('./upd-core.js');
const args = process.argv.slice(2); C.json = args.includes('--json');
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ROOT = process.env.MINIMAX_CODE_ROOT || path.dirname(__dirname);
const UPD = path.join(ROOT, 'updater');
const CACHE = process.env.MINIMAX_UPDATE_CACHE || path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'minimax-code-updater');
// same URL the app computes in dist/main/modules/updater/config.js (prod, en); app-update.yml points at a dead path
const DEFAULT_FEED = 'https://file.cdn.minimax.io/public/minimax-agent-prod/release/';
const BIN = 'minimax-code';
const PINS = () => JSON.parse(fs.readFileSync(path.join(UPD, 'runtime-pins.json'), 'utf8'));

const feedUrl = () => { const u = opt('--feed') || process.env.MINIMAX_UPDATE_URL || DEFAULT_FEED; return u.endsWith('/') ? u : u + '/'; };
function parseLatest(t) {
  const g = (k) => { const m = t.match(new RegExp('^' + k + ":\\s*'?([^'\\n]*)'?\\s*$", 'm')); return m ? m[1].trim() : null; };
  const o = { version: g('version'), path: g('path'), sha512: g('sha512'), releaseDate: g('releaseDate'), files: [] };
  const fm = t.match(/^files:\n((?:[ \t]+.*\n?)*)/m);
  if (fm) for (const blk of fm[1].split(/\n\s*-\s+/).map((s) => s.replace(/^\s*-\s+/, ''))) {
    const f = {}; for (const l of blk.split('\n')) { const m = l.match(/^\s*(url|sha512|size):\s*(.+?)\s*$/); if (m) f[m[1]] = m[1] === 'size' ? +m[2] : m[2]; } if (f.url) o.files.push(f); }
  if (!o.version || !/^\d+(\.\d+)+$/.test(o.version)) throw new Error('bad latest.yml (version)');
  const f = o.files.find((x) => /\.exe$/i.test(x.url) && !/arm64/i.test(x.url)) || { url: o.path, sha512: o.sha512 };
  if (!f.url || !f.sha512) throw new Error('bad latest.yml (files)');
  o.file = f; return o;
}
function current() { if (opt('--current')) return opt('--current'); const vs = C.installedVersions(ROOT); return vs[vs.length - 1] || '0.0.0'; }
function electronVersionOf(exe) {
  const fd = fs.openSync(exe, 'r'); const sz = fs.fstatSync(fd).size, chunk = 16 << 20, re = /Electron\/(\d+\.\d+\.\d+)/; let pos = 0, prev = '';
  try { while (pos < sz) { const b = Buffer.alloc(Math.min(chunk, sz - pos)); fs.readSync(fd, b, 0, b.length, pos); const s = prev + b.toString('latin1'); const m = s.match(re); if (m) return m[1]; prev = s.slice(-64); pos += b.length; } }
  finally { fs.closeSync(fd); }
  throw new Error('cannot detect Electron version in ' + exe);
}
function sh(cmd, a, o = {}) { const r = cp.spawnSync(cmd, a, Object.assign({ stdio: ['ignore', 'ignore', 'pipe'] }, o)); if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')} failed: ${r.stderr}`); }

// npm package (exact version) -> node_modules/<name>, verified against the registry's sha512 integrity
async function npmPkg(name, ver, dest) {
  const meta = JSON.parse((await C.request(`https://registry.npmjs.org/${name.replace('/', '%2F')}/${ver}`)).toString());
  const integ = meta.dist.integrity.replace(/^sha512-/, '');
  const tgz = await C.fetchVerified(meta.dist.tarball, path.join(CACHE, 'npm', `${name.replace('/', '+')}-${ver}.tgz`), { algo: 'sha512', enc: 'base64', digest: integ });
  fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
  sh('tar', ['-xzf', tgz, '-C', dest, '--strip-components=1', '--no-same-owner']);
}
// better-sqlite3 official prebuild for this Electron ABI, verified against the GitHub release asset digest
async function betterSqlite(A, exe) {
  const d = path.join(A, 'node_modules', 'better-sqlite3'); if (!fs.existsSync(d)) return 'absent';
  const v = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version;
  const abi = cp.execFileSync(exe, ['-p', 'process.versions.modules'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).toString().trim();
  const name = `better-sqlite3-v${v}-electron-v${abi}-linux-x64.tar.gz`;
  const rel = JSON.parse((await C.request(`https://api.github.com/repos/WiseLibs/better-sqlite3/releases/tags/v${v}`, { headers: { Accept: 'application/vnd.github+json' } })).toString());
  const a = (rel.assets || []).find((x) => x.name === name); if (!a) throw new Error('no better-sqlite3 prebuild ' + name);
  if (!/^sha256:[0-9a-f]{64}$/.test(a.digest || '')) throw new Error('no digest for ' + name);
  const tgz = await C.fetchVerified(a.browser_download_url, path.join(CACHE, 'npm', name), { digest: a.digest.slice(7), size: a.size });
  const rd = path.join(d, 'build', 'Release'); fs.rmSync(rd, { recursive: true, force: true }); fs.mkdirSync(rd, { recursive: true });
  sh('tar', ['-xzf', tgz, '-C', d, '--no-same-owner', 'build/Release/better_sqlite3.node']);
  return `${v} (electron abi ${abi})`;
}
function nodePty(A) {
  const d = path.join(A, 'node_modules', 'node-pty'); if (!fs.existsSync(d)) return 'absent';
  const pins = PINS(); const v = JSON.parse(fs.readFileSync(path.join(d, 'package.json'), 'utf8')).version;
  if (v !== pins.nodePty.version) throw new Error(`node-pty ${v} needs a reviewed Linux build (pinned ${pins.nodePty.version})`);
  for (const x of ['prebuilds/win32-x64', 'prebuilds/win32-arm64', 'deps/winpty', 'third_party', 'build']) fs.rmSync(path.join(d, x), { recursive: true, force: true });
  fs.mkdirSync(path.join(d, 'prebuilds', 'linux-x64'), { recursive: true }); fs.copyFileSync(path.join(UPD, pins.nodePty.file), path.join(d, 'prebuilds', 'linux-x64', 'pty.node'));

  const helper = path.join(UPD, 'assets', 'spawn-helper');
  if (fs.existsSync(helper)) { const target = path.join(d, 'prebuilds', 'linux-x64', 'spawn-helper'); fs.copyFileSync(helper, target); fs.chmodSync(target, 0o755); }
  return v;
}

async function buildFromApp(appSrc, ver, zz) {
  const exe = fs.readdirSync(appSrc).find((f) => /^minimax code\.exe$/i.test(f)); if (!exe) throw new Error('MiniMax Code.exe not in package');
  const eVer = electronVersionOf(path.join(appSrc, exe));
  const tmp = path.join(ROOT, `app-${ver}.tmp`); fs.rmSync(tmp, { recursive: true, force: true });
  C.emit({ status: 'downloading', version: ver, step: 'electron ' + eVer });
  C.x7z(zz, await C.electron(eVer, path.join(CACHE, 'electron'), zz), tmp);
  fs.renameSync(path.join(tmp, 'electron'), path.join(tmp, BIN));
  fs.rmSync(path.join(tmp, 'resources', 'default_app.asar'), { force: true });
  const R = path.join(tmp, 'resources'), A = path.join(R, 'app');
  C.emit({ status: 'installing', version: ver, step: 'app.asar' });
  C.extractAsar(path.join(appSrc, 'resources', 'app.asar'), A);
  const un = C.unpackedSet(path.join(appSrc, 'resources', 'app.asar.unpacked'));
  const pj = JSON.parse(fs.readFileSync(path.join(A, 'package.json'), 'utf8'));
  if (pj.version !== ver) throw new Error(`package.json version ${pj.version} != feed version ${ver}`);
  // native modules: Windows -> Linux
  C.emit({ status: 'installing', version: ver, step: 'native modules' });
  const NM = path.join(A, 'node_modules'), mods = {};
  for (const [win, lin] of Object.entries(PINS().npmLinuxPackages)) {
    const wd = path.join(NM, win); if (!fs.existsSync(path.join(wd, 'package.json'))) continue;
    const v = JSON.parse(fs.readFileSync(path.join(wd, 'package.json'), 'utf8')).version;
    await npmPkg(lin, v, path.join(NM, lin)); fs.rmSync(wd, { recursive: true, force: true }); mods[lin] = v;
    if (pj.dependencies && pj.dependencies[win]) { delete pj.dependencies[win]; pj.dependencies[lin] = v; }
  }
  mods['better-sqlite3'] = await betterSqlite(A, path.join(tmp, BIN));
  mods['node-pty'] = nodePty(A);
  fs.rmSync(path.join(NM, '@minimax', 'mcode-sandbox-runtime', 'vendor', 'srt-win'), { recursive: true, force: true });
  fs.rmSync(path.join(NM, '@earendil-works', 'pi-tui', 'native', 'win32'), { recursive: true, force: true });
  // Linux entry shim
  fs.copyFileSync(path.join(UPD, 'shim', 'linux-shim.js'), path.join(A, 'dist', 'main', 'linux-shim.js'));
  pj.main = 'dist/main/linux-shim.js'; pj.desktopName = 'minimax-code.desktop';
  fs.writeFileSync(path.join(A, 'package.json'), JSON.stringify(pj, null, 2));
  C.syntaxCheck(path.join(A, 'dist', 'main', 'linux-shim.js'));
  const linuxPkgs = Object.keys(mods).filter((m) => !['better-sqlite3', 'node-pty'].includes(m)).map((m) => 'node_modules/' + m + '/');
  C.packAsar(A, path.join(R, 'app.asar'), (r) => un.has(r) || /\.node$/.test(r) || linuxPkgs.some((p) => r.startsWith(p)) || r.startsWith('node_modules/node-pty/') || r.startsWith('node_modules/better-sqlite3/'));
  fs.rmSync(A, { recursive: true, force: true });
  const m = C.asarMain(path.join(tmp, BIN), path.join(R, 'app.asar')); if (m !== 'dist/main/linux-shim.js') throw new Error('repacked asar main is ' + m);
  fs.writeFileSync(path.join(R, 'app-update.yml'), `provider: generic\nurl: ${DEFAULT_FEED}\nupdaterCacheDirName: '@mmx-agentelectron-updater'\n`);
  // extra resources: drop Windows-only binaries (no Linux build of mavis-session-transfer-client / registry.node is published)
  C.emit({ status: 'installing', version: ver, step: 'resources' });
  const RR = path.join(R, 'resources'); C.cpR(path.join(appSrc, 'resources', 'resources'), RR);
  fs.rmSync(path.join(RR, 'session-transfer'), { recursive: true, force: true });
  for (const f of fs.readdirSync(RR)) if (/\.(nsh|ico|icns|plist)$|^dmg-background|^install-mcode-test\.sh$/.test(f)) fs.rmSync(path.join(RR, f));
  for (const f of ['LICENSE.electron.txt', 'LICENSES.chromium.html']) if (fs.existsSync(path.join(appSrc, f))) fs.copyFileSync(path.join(appSrc, f), path.join(tmp, f + '.win'));
  fs.writeFileSync(path.join(tmp, 'linux-build.json'), JSON.stringify({ version: ver, electron: eVer, modules: mods, built: new Date().toISOString() }, null, 2));
  const got = C.smoke(path.join(tmp, BIN)); if (got !== eVer) throw new Error(`electron ${got} != ${eVer}`);
  // Test the database and terminal in the exact Electron runtime before marking complete.
  const t = cp.spawnSync(path.join(tmp, BIN), ['-e', `const a=${JSON.stringify(path.join(R, 'app.asar'))};const r=require('module').createRequire(a+'/package.json');
    const db=new (r('better-sqlite3'))(':memory:');db.prepare('select 1').get();db.close();r('@ubjs/node');r('node-screenshots');require('fs').accessSync(r.resolve('@vscode/ripgrep-linux-x64/bin/rg'),1);
    const p=r('node-pty').spawn('/bin/sh',['-c','printf MINIMAX_PTY_OK'],{cols:80,rows:24,env:process.env});
    let output='';p.onData(d=>output+=d);p.onExit(e=>{if(e.exitCode!==0||!output.includes('MINIMAX_PTY_OK'))process.exit(1);console.log('native-ok')});
    setTimeout(()=>process.exit(1),10000).unref()`],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: 60000 });
  if (t.status !== 0 || !/native-ok/.test(t.stdout || '')) throw new Error('native module load test failed: ' + (t.stderr + t.stdout).slice(-1500));
  return tmp;
}

async function main() {
  fs.mkdirSync(CACHE, { recursive: true });
  if (args.includes('--rollback')) return withLock(rollback);
  if (args.includes('--prune')) return withLock(prune);
  const cur = current(); const local = opt('--from-file');
  const rebuild = args.includes('--rebuild');
  let o;
  if (local) { o = { version: opt('--version'), file: { url: local } }; if (!o.version || !/^\d+(\.\d+)+$/.test(o.version)) throw new Error('--from-file needs a numeric --version'); }
  else { C.emit({ status: 'checking', current: cur }); const feed = feedUrl(); o = parseLatest((await C.request(feed + 'latest.yml')).toString()); o.feed = feed; }
  const meta = { version: o.version, releaseDate: o.releaseDate };
  if (!local && C.vcmp(o.version, cur) < 0 && rebuild) throw new Error('update feed is older than the installed version; use a matching local installer');
  if (!local && C.vcmp(o.version, cur) <= 0 && !rebuild) { C.emit(Object.assign({ status: 'up_to_date' }, meta, { version: cur, latest: o.version })); return; }
  if (args.includes('--check')) { C.emit(Object.assign({ status: C.installedVersions(ROOT).includes(o.version) ? 'ready_to_install' : 'available' }, meta)); return; }
  return withLock(async () => {
  if (rebuild && C.installedVersions(ROOT).some(v => C.isRunning(path.join(ROOT, 'app-' + v)))) throw new Error('close MiniMax Code before reinstalling');
  if (C.installedVersions(ROOT).includes(o.version) && !rebuild) { C.emit(Object.assign({ status: 'ready_to_install' }, meta)); return; }
  if (fs.readdirSync(ROOT).some(d => /^rollback-\d+(\.\d+)+$/.test(d) && C.isRunning(path.join(ROOT,d)))) throw new Error('close MiniMax Code before replacing a running rollback copy');
  let setup;
  if (local) setup = local;
  else {
    const u = new URL(o.file.url, o.feed).href; let lastP = -1;
    C.emit({ status: 'downloading', version: o.version, percent: 0 });
    setup = await C.fetchVerified(u, path.join(CACHE, 'pending', `MiniMax-Code-Setup-${o.version}.exe`), { algo: 'sha512', enc: 'base64', digest: o.file.sha512, size: o.file.size,
      onProgress: (g, t) => { const tot = t || o.file.size || 0; const p = tot ? Math.floor(g * 100 / tot) : 0; if (p !== lastP) { lastP = p; C.emit({ status: 'downloading', version: o.version, percent: p, transferred: g, total: tot }); } } });
    C.emit({ status: 'downloading', version: o.version, percent: 100 });
  }
  const zz = C.sevenZip(ROOT); const work = fs.mkdtempSync(path.join(CACHE, 'work-'));
  try {
    C.emit({ status: 'installing', version: o.version, step: 'unpack' });
    C.x7z(zz, setup, path.join(work, 'nsis'), ['$PLUGINSDIR/app-64.7z']);
    const a7 = path.join(work, 'nsis', '$PLUGINSDIR', 'app-64.7z'); if (!fs.existsSync(a7)) throw new Error('app-64.7z not in installer');
    C.x7z(zz, a7, path.join(work, 'app')); fs.rmSync(path.join(work, 'nsis'), { recursive: true, force: true });
    const tmp = await buildFromApp(path.join(work, 'app'), o.version, zz);
    if (C.installedVersions(ROOT).includes(cur)) {
      for (const d of fs.readdirSync(ROOT)) if (/^rollback-\d+(\.\d+)+$/.test(d)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
      cp.execFileSync('cp', ['-al', path.join(ROOT, `app-${cur}`), path.join(ROOT, `rollback-${cur}`)]);
    }
    C.commit(ROOT, tmp, o.version);
    if (!local) fs.rmSync(path.join(CACHE, 'pending'), { recursive: true, force: true });
    C.emit(Object.assign({ status: 'ready_to_install' }, meta));
  } catch (e) { fs.rmSync(path.join(ROOT, `app-${o.version}.tmp`), { recursive: true, force: true }); throw e; }
  finally { fs.rmSync(work, { recursive: true, force: true }); }
  });
}
async function withLock(action) {
  const release = await C.lock(ROOT);
  try { return await action(); }
  finally { await release(); }
}
function prune() {
  const vs = C.installedVersions(ROOT); const keep = vs[vs.length - 1];
  for (const v of vs) if (v !== keep) { const d = path.join(ROOT, `app-${v}`);
    if (!C.isRunning(d)) fs.rmSync(d, { recursive: true, force: true }); }
  for (const d of fs.readdirSync(ROOT)) if (/^app-\d+(\.\d+)+(\.tmp|\.old-\d+)$/.test(d)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  C.emit({ status: 'pruned', keep });
}
function rollback() {
  const rb = fs.readdirSync(ROOT).filter(d => /^rollback-\d+(\.\d+)+$/.test(d)).sort((a,b) => C.vcmp(a.slice(9),b.slice(9))).pop(); if (!rb) throw new Error('no rollback copy');
  const v = rb.slice(9);
  if (!/^\d+(\.\d+)+$/.test(v)) throw new Error('invalid rollback version');
  const rollbackExe = path.join(ROOT, rb, BIN), rollbackArchive = path.join(ROOT, rb, 'resources/app.asar');
  fs.accessSync(rollbackExe, fs.constants.X_OK);
  if (!fs.statSync(rollbackExe).isFile() || !fs.statSync(rollbackArchive).isFile() || !fs.statSync(rollbackArchive).size || !fs.existsSync(path.join(ROOT, rb, '.complete'))) throw new Error('rollback copy is incomplete');
  for (const directory of fs.readdirSync(ROOT).filter(d => /^(app|rollback)-\d+(\.\d+)+$/.test(d))) {
    if (C.isRunning(path.join(ROOT, directory))) throw new Error('close MiniMax Code before rollback');
  }
  for (const d of fs.readdirSync(ROOT)) if (/^app-\d+(\.\d+)+$/.test(d) && C.vcmp(d.slice(4), v) >= 0) fs.renameSync(path.join(ROOT, d), path.join(ROOT, d + '.tmp'));
  fs.renameSync(path.join(ROOT, rb), path.join(ROOT, `app-${v}`));
  for (const d of fs.readdirSync(ROOT)) if (/^app-\d+(\.\d+)+\.tmp$/.test(d)) fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
  C.emit({ status: 'rolled_back', version: v });
}
main().catch((e) => { if (args.includes('--prune') && e.code === 'UPDATE_BUSY') C.emit({ status: 'prune_skipped', reason: e.message }); else { C.emit({ status: 'error', message: String(e.message || e) }); process.exitCode = 1; } });
