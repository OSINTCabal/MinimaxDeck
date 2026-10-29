const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const C = require('../updater/upd-core.js');
const script = path.resolve(__dirname, '../updater/minimax-update.js');
test('interrupted downloads reject instead of hanging', async t => {
  const https = require('node:https'), { PassThrough } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const original = https.request;
  t.after(() => { https.request = original; });
  https.request = (_url, _opts, callback) => {
    const req = new EventEmitter();
    req.end = () => queueMicrotask(() => {
      const response = new PassThrough(); response.statusCode = 200;
      callback(response); response.destroy(new Error('interrupted fixture'));
    });
    return req;
  };
  const root = fixture(t);
  await assert.rejects(C.request('https://fixture.invalid/file', { file: path.join(root, 'download') }), /interrupted fixture/);
  assert.equal(fs.existsSync(path.join(root, 'download')), false);
});
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minimaxdeck-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function app(root, name) {
  fs.mkdirSync(path.join(root, name));
  fs.writeFileSync(path.join(root, name, '.complete'), 'fixture');
  fs.writeFileSync(path.join(root, name, 'minimax-code'), '#!/bin/sh\necho runtime\n', { mode: 0o755 });
  fs.mkdirSync(path.join(root, name, 'resources'));
  fs.writeFileSync(path.join(root, name, 'resources/app.asar'), 'fixture');
}
for (const action of ['--prune', '--rollback']) test(action + ' preserves unrelated directories', t => {
  const root = fixture(t);
  app(root, 'app-3.2.20');
  if (action === '--rollback') app(root, 'rollback-3.2.9');
  fs.mkdirSync(path.join(root, 'notes.tmp'));
  const r = cp.spawnSync(process.execPath, [script, action], { env: { ...process.env, MINIMAX_CODE_ROOT: root, MINIMAX_UPDATE_CACHE: path.join(root, 'cache') } });
  assert.equal(r.status, 0, String(r.stderr));
  assert.ok(fs.existsSync(path.join(root, 'notes.tmp')));
});
test('local version cannot escape root', t => {
  const root = fixture(t);
  const r = cp.spawnSync(process.execPath, [script, '--from-file', 'missing.exe', '--version', '../../../escape', '--json'], { encoding: 'utf8', env: { ...process.env, MINIMAX_CODE_ROOT: root, MINIMAX_UPDATE_CACHE: path.join(root, 'cache') } });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /numeric --version/);
});
test('version ordering excludes incomplete builds', t => {
  const root = fixture(t);
  app(root, 'app-3.2.9'); app(root, 'app-3.2.100');
  fs.mkdirSync(path.join(root, 'app-9.0.0'));
  assert.deepEqual(C.installedVersions(root), ['3.2.9', '3.2.100']);
});
test('asar round trip preserves bytes', t => {
  const root = fixture(t), src = path.join(root, 'source'), out = path.join(root, 'out');
  fs.mkdirSync(src); fs.writeFileSync(path.join(src, 'sample'), 'payload');
  C.packAsar(src, path.join(root, 'test.asar'), () => false);
  C.extractAsar(path.join(root, 'test.asar'), out);
  assert.equal(fs.readFileSync(path.join(out, 'sample'), 'utf8'), 'payload');
});
test('asar rejects symlinks before following them', t => {
  const root = fixture(t), src = path.join(root, 'source');
  fs.mkdirSync(src); fs.symlinkSync('/tmp', path.join(src, 'external'));
  C.packAsar(src, path.join(root, 'test.asar'), () => false);
  assert.throws(() => C.extractAsar(path.join(root, 'test.asar'), path.join(root, 'out')), /symlinks/);
});
for (const purge of [false, true]) test('uninstall profile handling: purge=' + purge, t => {
  const root = fixture(t), opt = path.join(root, 'app'), bin = path.join(root, 'bin'), config = path.join(root, 'config');
  fs.mkdirSync(path.join(opt, 'updater'), { recursive: true }); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(opt, 'minimax-code.sh'), 'fixture');
  fs.writeFileSync(path.join(opt, 'updater/minimax-update.js'), 'fixture');
  fs.mkdirSync(path.join(config, 'minimax-code'), { recursive: true });
  for (const command of ['pkill', 'systemctl']) fs.writeFileSync(path.join(bin, command), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  for (const alias of ['minimaxdeck', 'minimaxcode', 'minimax-code']) fs.symlinkSync(path.join(opt, 'minimax-code.sh'), path.join(bin, alias));
  const r = cp.spawnSync('sh', [path.resolve(__dirname, '../uninstall.sh'), ...(purge ? ['--purge'] : [])], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH, MINIMAX_CODE_ROOT: opt, XDG_BIN_HOME: bin, XDG_CONFIG_HOME: config, XDG_DATA_HOME: path.join(root, 'data'), XDG_CACHE_HOME: path.join(root, 'cache') } });
  assert.equal(r.status, 0, String(r.stderr));
  assert.equal(fs.existsSync(path.join(config, 'minimax-code')), !purge);
  assert.equal(fs.existsSync(opt), false);
  assert.equal(fs.readdirSync(bin).some(x => x.startsWith('minimax')), false);
});
for (const args of [['--help'], ['--unknown'], ['--purge','extra']]) test('uninstall safely handles ' + args.join(' '), t => {
  const root=fixture(t); fs.mkdirSync(path.join(root,'updater')); fs.writeFileSync(path.join(root,'minimax-code.sh'),'fixture'); fs.writeFileSync(path.join(root,'updater/minimax-update.js'),'fixture');
  const r=cp.spawnSync('sh',[path.resolve(__dirname,'../uninstall.sh'),...args],{env:{...process.env,MINIMAX_CODE_ROOT:root}});
  assert.equal(r.status,args[0]==='--help'?0:2); assert.ok(fs.existsSync(path.join(root,'minimax-code.sh')));
});
test('bootstrap ignores unfinished builds and supports rollback fallback', t => {
  const root=fixture(t); app(root,'app-3.2.20'); app(root,'app-99.0.0.tmp');
  const select=()=>cp.execFileSync('sh',['-c','. "$1"; select_runtime','sh',path.resolve(__dirname,'../updater/select-runtime.sh')],{encoding:'utf8',env:{...process.env,ROOT:root}}).trim();
  assert.equal(select(),path.join(root,'app-3.2.20'));
  fs.unlinkSync(path.join(root,'app-3.2.20/resources/app.asar')); app(root,'rollback-3.2.19');
  assert.equal(select(),path.join(root,'rollback-3.2.19'));
  assert.deepEqual(C.installedVersions(root),[]);
});
test('damaged marker is not treated as an installed application', t => {
  const root=fixture(t); app(root,'app-3.2.20'); fs.unlinkSync(path.join(root,'app-3.2.20/minimax-code'));
  const r=cp.spawnSync(process.execPath,[script,'--from-file','missing.exe','--version','3.2.20','--json'],{encoding:'utf8',env:{...process.env,MINIMAX_CODE_ROOT:root,MINIMAX_UPDATE_CACHE:path.join(root,'cache')}});
  assert.notEqual(r.status,0); assert.doesNotMatch(r.stdout,/ready_to_install/);
});
test('rollback restores a damaged same-version app and preserves unrelated rollback folders', t => {
  const root=fixture(t); app(root,'app-3.1.7'); app(root,'rollback-3.1.7');
  fs.unlinkSync(path.join(root,'app-3.1.7/resources/app.asar')); fs.mkdirSync(path.join(root,'rollback-notes'));
  const r=cp.spawnSync(process.execPath,[script,'--rollback','--json'],{encoding:'utf8',env:{...process.env,MINIMAX_CODE_ROOT:root,MINIMAX_UPDATE_CACHE:path.join(root,'cache')}});
  assert.equal(r.status,0,r.stdout+r.stderr); assert.deepEqual(C.installedVersions(root),['3.1.7']);
  assert.ok(fs.existsSync(path.join(root,'rollback-notes')));
});
test('incomplete rollback is rejected without removing the working app', t => {
  const root=fixture(t); app(root,'app-3.1.7'); app(root,'rollback-3.1.6');
  fs.unlinkSync(path.join(root,'rollback-3.1.6/resources/app.asar'));
  const r=cp.spawnSync(process.execPath,[script,'--rollback','--json'],{encoding:'utf8',env:{...process.env,MINIMAX_CODE_ROOT:root,MINIMAX_UPDATE_CACHE:path.join(root,'cache')}});
  assert.equal(r.status,1); assert.deepEqual(C.installedVersions(root),['3.1.7']);
});
test('prune fails closed if process inspection fails', t => {
  const root=fixture(t); app(root,'app-3.1.6'); app(root,'app-3.1.7');
  const bin=path.join(root,'bin'); fs.mkdirSync(bin); fs.writeFileSync(path.join(bin,'pgrep'),'#!/bin/sh\nexit 2\n',{mode:0o755});
  const r=cp.spawnSync(process.execPath,[script,'--prune','--json'],{encoding:'utf8',env:{...process.env,PATH:bin+path.delimiter+process.env.PATH,MINIMAX_CODE_ROOT:root,MINIMAX_UPDATE_CACHE:path.join(root,'cache')}});
  assert.equal(r.status,1); assert.deepEqual(C.installedVersions(root),['3.1.6','3.1.7']);
});
test('native rollback ignores itself but blocks another running app in a path with brackets', { skip: !process.env.MINIMAX_TEST_ELECTRON }, async t => {
  const root=path.join(fixture(t),'install[1]'); fs.mkdirSync(root); app(root,'app-3.2.20'); app(root,'rollback-3.2.19'); fs.mkdirSync(path.join(root,'updater'));
  for(const name of ['minimax-update.js','upd-core.js','select-runtime.sh']) fs.copyFileSync(path.resolve(__dirname,'../updater',name),path.join(root,'updater',name));
  const exe=path.join(root,'app-3.2.20/minimax-code'); fs.unlinkSync(exe); fs.symlinkSync(process.env.MINIMAX_TEST_ELECTRON,exe);
  const live=cp.spawn(exe,['-e','console.log("ready");setInterval(()=>{},1000)'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','ignore']});
  t.after(()=>live.kill());
  await new Promise((resolve,reject)=>{live.once('error',reject);live.stdout.once('data',resolve);live.once('exit',()=>reject(Error('fixture exited before ready')));});
  const run=()=>cp.spawnSync('sh',[path.resolve(__dirname,'../updater/run-update.sh'),'--rollback','--json'],{encoding:'utf8',env:{...process.env,MINIMAX_CODE_ROOT:root,MINIMAX_UPDATE_CACHE:path.join(root,'cache')}});
  assert.equal(run().status,1); assert.ok(fs.existsSync(exe));
  await new Promise(resolve=>{live.once('exit',resolve);live.kill();});
  const backup=path.join(root,'rollback-3.2.19/minimax-code');fs.unlinkSync(backup);fs.symlinkSync(process.env.MINIMAX_TEST_ELECTRON,backup);
  const fallback=cp.spawn(backup,['-e','console.log("ready");setInterval(()=>{},1000)'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','ignore']});
  t.after(()=>fallback.kill());
  await new Promise((resolve,reject)=>{fallback.once('error',reject);fallback.stdout.once('data',resolve);fallback.once('exit',()=>reject(Error('fallback exited before ready')));});
  assert.equal(run().status,1,'rollback must also protect an active fallback runtime');
  await new Promise(resolve=>{fallback.once('exit',resolve);fallback.kill();});
  const r=run(); assert.equal(r.status,0,r.stdout+r.stderr); assert.match(r.stdout,/rolled_back/);
});
