// Shared per-user updater core (runs under ELECTRON_RUN_AS_NODE=1 or plain node >=18).
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), https = require('https'), cp = require('child_process');
process.noAsar = true;
const C = module.exports = {};
C.log = (...a) => process.stderr.write('[updater] ' + a.join(' ') + '\n');
C.emit = (o) => { if (C.json) process.stdout.write(JSON.stringify(o) + '\n'); else C.log(JSON.stringify(o)); };
C.vcmp = (a, b) => { const x = String(a).split(/[.-]/).map(Number), y = String(b).split(/[.-]/).map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0 ? 1 : -1; } return 0; };
C.isRunning = (directory) => {
  const escaped = path.join(directory, 'minimax-code').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const p = cp.spawnSync('pgrep', ['-u', String(process.getuid()), '-f', '^' + escaped + '( |$)'], { encoding: 'utf8' });
  if (p.status !== 0 && p.status !== 1) throw new Error('application process check failed');
  return String(p.stdout).trim().split(/\s+/).filter(Boolean).some(pid => Number(pid) !== process.pid);
};
C.UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
C.request = function (url, { method = 'GET', headers = {}, body = null, file = null, maxRedirects = 8, onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    if (u.protocol !== 'https:') return reject(new Error('refusing non-https URL ' + url));
    const req = https.request(u, { method, headers: Object.assign({ 'User-Agent': C.UA }, headers), timeout: 60000 }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && maxRedirects > 0) { res.resume(); return resolve(C.request(new URL(res.headers.location, u).href, { method: res.statusCode === 303 ? 'GET' : method, headers, body, file, maxRedirects: maxRedirects - 1, onProgress })); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} for ${url}`)); }
      if (onProgress) { const tot = +res.headers['content-length'] || 0; let got = 0, last = 0; res.on('data', (d) => { got += d.length; const n = Date.now(); if (n - last > 500) { last = n; onProgress(got, tot); } }); }
      if (file) { const tmp = file + '.part'; const w = fs.createWriteStream(tmp); require('stream').pipeline(res, w, err => { if (err) return reject(err); try { fs.renameSync(tmp, file); resolve(file); } catch (e) { reject(e); } }); }
      else { const ch = []; res.on('data', (d) => ch.push(d)); res.on('end', () => resolve(Buffer.concat(ch))); res.on('error', reject); }
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
    if (body) req.write(body); req.end();
  });
};
C.hashFile = (f, algo = 'sha256', enc = 'hex') => new Promise((res, rej) => { const h = crypto.createHash(algo); fs.createReadStream(f).on('data', (d) => h.update(d)).on('end', () => res(h.digest(enc))).on('error', rej); });
// download into cache, verify (algo, expected digest, encoding, size); reuse cached file if it verifies
C.fetchVerified = async function (url, dest, { algo = 'sha256', digest, enc = 'hex', size, onProgress } = {}) {
  if (!digest) throw new Error('no digest supplied for ' + url);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const ok = async () => fs.existsSync(dest) && (!size || fs.statSync(dest).size === size) && (await C.hashFile(dest, algo, enc)) === digest;
  if (await ok()) { C.log('cache hit', dest); return dest; }
  for (let i = 1; ; i++) { try { C.log('downloading', url); await C.request(url, { file: dest, onProgress }); break; } catch (e) { fs.rmSync(dest + '.part', { force: true }); if (i >= 3) throw e; C.log('retry', i, String(e.message || e)); await new Promise((r) => setTimeout(r, 3000 * i)); } }
  if (!(await ok())) { const got = await C.hashFile(dest, algo, enc); fs.rmSync(dest, { force: true }); throw new Error(`${algo} mismatch for ${url}: got ${got} want ${digest}`); }
  return dest;
};
C.sevenZip = (root) => { const c = [path.join(root, 'updater', '7zz'), ...String(process.env.PATH || '').split(path.delimiter).flatMap(d => [path.join(d, '7zz'), path.join(d, '7z')])].find(p => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } }); if (!c) throw new Error('install 7-Zip (7zz or 7z)'); return c; };
C.x7z = (zz, archive, out, files = []) => { fs.mkdirSync(out, { recursive: true }); const r = cp.spawnSync(zz, ['x', '-y', '-bso0', '-bsp0', `-o${out}`, archive, ...files], { stdio: ['ignore', 'ignore', 'pipe'] }); if (r.status !== 0) throw new Error('7zz failed: ' + String(r.stderr)); };
// asar (pickle) extractor -> directory; merges <asar>.unpacked
C.extractAsar = function (asar, out) {
  const fd = fs.openSync(asar, 'r');
  try {
  const size = fs.fstatSync(fd).size, b = Buffer.alloc(16);
  if (fs.readSync(fd, b, 0, 16, 0) !== 16 || b.readUInt32LE(0) !== 4) throw new Error('invalid ASAR prefix');
  const hdrSize = b.readUInt32LE(4), jsonLen = b.readUInt32LE(12);
  if (jsonLen > 32 * 1024 * 1024 || hdrSize < 8 + jsonLen || 8 + hdrSize > size) throw new Error('invalid ASAR header bounds');
  const jb = Buffer.alloc(jsonLen);
  if (fs.readSync(fd, jb, 0, jsonLen, 16) !== jsonLen) throw new Error('truncated ASAR header');
  const hdr = JSON.parse(jb.toString('utf8'));
  const base = 8 + hdrSize; const unpackedDir = asar + '.unpacked';
  const walk = (node, rel) => {
    for (const [name, e] of Object.entries(node.files || {})) {
      if (!name || /[/\\\0]/.test(name) || name === '..' || name === '.') throw new Error('unsafe asar entry ' + name);
      const p = path.join(out, rel, name);
      if (e.files) { fs.mkdirSync(p, { recursive: true }); walk(e, path.join(rel, name)); }
      else if (e.link) { throw new Error('asar symlinks are not supported: ' + name); }
      else if (e.unpacked) {
        const src = path.join(unpackedDir, rel, name);
        // Windows packages retain ASAR references to omitted optional-platform files.
        if (!fs.existsSync(src)) continue;
        const st = fs.lstatSync(src);
        if (!st.isFile() || st.size !== e.size) throw new Error('invalid unpacked ASAR file: ' + name);
        fs.copyFileSync(src, p);
      }
      else {
        const offset = Number(e.offset || 0);
        if (!Number.isSafeInteger(e.size) || e.size < 0 || !Number.isSafeInteger(offset) || offset < 0 || base + offset + e.size > size) throw new Error('invalid ASAR file bounds: ' + name);
        const buf = Buffer.alloc(e.size);
        if (e.size && fs.readSync(fd, buf, 0, e.size, base + offset) !== e.size) throw new Error('truncated ASAR file: ' + name);
        fs.writeFileSync(p, buf, { mode: e.executable ? 0o755 : 0o644 });
      }
    }
  };
  fs.mkdirSync(out, { recursive: true }); walk(hdr, '');
  } finally { fs.closeSync(fd); }
};
C.cpR = (a, b) => fs.cpSync(a, b, { recursive: true, verbatimSymlinks: true });
// Electron runtime from GitHub, verified against SHASUMS256.txt
C.electron = async function (ver, cacheDir, zz) {
  const name = `electron-v${ver}-linux-x64.zip`, base = `https://github.com/electron/electron/releases/download/v${ver}/`;
  const local = path.join(cacheDir, name);
  const sums = (await C.request(base + 'SHASUMS256.txt')).toString();
  const m = sums.split('\n').map((l) => l.trim().split(/\s+\*?/)).find((x) => x[1] === name);
  if (!m) throw new Error('electron zip not listed in SHASUMS256 for ' + ver);
  await C.fetchVerified(base + name, local, { digest: m[0] });
  return local;
};
C.syntaxCheck = (file) => { const src = fs.readFileSync(file, 'utf8'); new (require('vm').Script)('(function (exports, require, module, __filename, __dirname) {' + src.replace(/^#!.*/, '') + '\n})', { filename: file }); };
C.patchText = (file, edits) => { let s = fs.readFileSync(file, 'utf8'); for (const [re, rep, need] of edits) { const n = (s.match(re) || []).length; if (need !== undefined && n < need) throw new Error(`patch anchor not found in ${path.basename(file)}: ${re}`); s = s.replace(re, rep); } fs.writeFileSync(file, s); };
C.lock = (root) => new Promise((resolve, reject) => {
  // The kernel releases flock on process exit, including crashes. Never unlink the lock file.
  const lockFile = path.join(root, '.update.lock');
  // Respect an updater from the previous PID-file implementation during migration.
  try {
    const old = fs.readFileSync(lockFile, 'utf8').trim();
    if (/^[1-9]\d*$/.test(old)) {
      try { process.kill(Number(old), 0); }
      catch (e) { if (e.code !== 'ESRCH') throw e; }
      if (fs.existsSync('/proc/' + old)) throw Object.assign(new Error('a legacy update is running'), { code: 'UPDATE_BUSY' });
    }
  } catch (e) { if (e.code !== 'ENOENT') return reject(e); }
  const child = cp.spawn('flock', ['-n', '-E', '75', lockFile, 'sh', '-c', 'printf "locked\\n"; cat >/dev/null'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let acquired = false, error = '';
  const closed = new Promise(done => child.once('close', done));
  child.once('error', reject);
  child.stderr.on('data', data => { error = (error + data).slice(-2048); });
  child.once('close', code => {
    if (!acquired) reject(Object.assign(new Error(code === 75 ? 'another update is running' : 'update lock failed: ' + error), { code: code === 75 ? 'UPDATE_BUSY' : 'UPDATE_LOCK_FAILED' }));
  });
  child.stdout.once('data', () => {
    acquired = true;
    try { fs.writeFileSync(lockFile, ''); }
    catch (e) { child.stdin.end(); reject(e); return; }
    const releaseOnExit = () => child.stdin.destroy();
    process.once('exit', releaseOnExit);
    let released = false;
    resolve(async () => {
      if (!released) { released = true; process.removeListener('exit', releaseOnExit); child.stdin.end(); }
      await closed;
    });
  });
  child.stdin.on('error', () => {});
});
C.installedVersions = (root) => fs.readdirSync(root).filter((d) => {
  if (!/^app-\d+(\.\d+)+$/.test(d) || !fs.existsSync(path.join(root, d, '.complete'))) return false;
  try { const exe=path.join(root,d,'minimax-code'), archive=fs.statSync(path.join(root,d,'resources/app.asar')); fs.accessSync(exe,fs.constants.X_OK); return fs.statSync(exe).isFile() && archive.isFile() && archive.size > 0; } catch { return false; }
}).map((d) => d.slice(4)).sort(C.vcmp);
// swap: tmp -> app-<v>; keep exactly one rollback-<old>; prune others
C.commit = function (root, tmp, ver, { keepCurrent = true } = {}) {
  fs.writeFileSync(path.join(tmp, '.complete'), new Date().toISOString());
  const dst = path.join(root, `app-${ver}`);
  const previous = dst + '.old-' + Date.now();
  const existed = fs.existsSync(dst);
  if (existed) fs.renameSync(dst, previous);
  try { fs.renameSync(tmp, dst); }
  catch (e) { if (existed) fs.renameSync(previous, dst); throw e; }
  return dst;
};
C.rotate = function (root, cur) {
  // called by launcher at startup of new version: older app-* -> rollback-<v> (only one kept)
  const vs = C.installedVersions(root); const latest = vs[vs.length - 1]; if (!latest) return;
  for (const v of vs) if (v !== latest && v !== cur) {
    for (const d of fs.readdirSync(root)) if (/^rollback-\d+(\.\d+)+$/.test(d)) fs.rmSync(path.join(root, d), { recursive: true, force: true });
    fs.renameSync(path.join(root, `app-${v}`), path.join(root, `rollback-${v}`));
  }
  for (const d of fs.readdirSync(root)) if (/^app-\d+(\.\d+)+(\.tmp|\.old-\d+)$/.test(d)) fs.rmSync(path.join(root, d), { recursive: true, force: true });
};
C.smoke = function (exe, env = {}) {
  const r = cp.spawnSync(exe, ['-e', 'process.stdout.write(process.versions.electron)'], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }, env), encoding: 'utf8', timeout: 30000 });
  if (r.status !== 0 || !/^\d+\./.test(r.stdout)) throw new Error('smoke test failed: ' + (r.stderr || r.status));
  return r.stdout;
};

// asar packer: dir -> asar (+ <asar>.unpacked for files where unpack(rel) is true). Electron loads resources/app.asar
// BEFORE resources/app, so the re-shimmed tree must replace app.asar itself.
C.packAsar = function (dir, out, unpack) {
  const files = []; let offset = 0;
  const walk = (d, rel) => {
    const node = { files: {} };
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name), r = rel ? rel + '/' + name : name, st = fs.lstatSync(p);
      if (st.isDirectory()) node.files[name] = walk(p, r);
      else if (st.isSymbolicLink()) node.files[name] = { link: path.relative(dir, path.resolve(path.dirname(p), fs.readlinkSync(p))) };
      else if (unpack(r)) { node.files[name] = { size: st.size, unpacked: true }; if (st.mode & 0o111) node.files[name].executable = true;
        const dst = path.join(out + '.unpacked', r); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(p, dst); fs.chmodSync(dst, st.mode & 0o777); }
      else { node.files[name] = { size: st.size, offset: String(offset) }; if (st.mode & 0o111) node.files[name].executable = true; files.push(p); offset += st.size; }
    }
    return node;
  };
  fs.rmSync(out + '.unpacked', { recursive: true, force: true });
  const hdr = Buffer.from(JSON.stringify(walk(dir, '')));
  const padded = (hdr.length + 3) & ~3;
  const hp = Buffer.alloc(8 + padded); hp.writeUInt32LE(4 + padded, 0); hp.writeUInt32LE(hdr.length, 4); hdr.copy(hp, 8);
  const sp = Buffer.alloc(8); sp.writeUInt32LE(4, 0); sp.writeUInt32LE(hp.length, 4);
  const fd = fs.openSync(out + '.part', 'w'); fs.writeSync(fd, sp); fs.writeSync(fd, hp);
  for (const f of files) fs.writeSync(fd, fs.readFileSync(f));
  fs.closeSync(fd); fs.renameSync(out + '.part', out);
};
// files that the original asar kept unpacked (native modules etc.)
C.unpackedSet = (unpackedDir) => { const s = new Set(); const w = (d, r) => { if (!fs.existsSync(d)) return; for (const n of fs.readdirSync(d)) { const p = path.join(d, n), rr = r ? r + '/' + n : n; fs.statSync(p).isDirectory() ? w(p, rr) : s.add(rr); } }; w(unpackedDir, ''); return s; };
// verify via Electron's own asar reader that main points at the shim
C.asarMain = (exe, asar) => cp.execFileSync(exe, ['-e', `process.stdout.write(require(${JSON.stringify(asar + '/package.json')}).main)`], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }).toString();
