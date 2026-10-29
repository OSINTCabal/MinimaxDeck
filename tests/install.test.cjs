const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const cp = require('node:child_process');
const C = require('../updater/upd-core.js');
const source = path.resolve(__dirname, '..');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minimaxdeck-install-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
for (const args of [['--help'], ['--unknown'], ['--from-file', 'missing.exe', '--version', '../escape']]) {
  test('installer validates before making changes: ' + args.join(' '), t => {
    const root = fixture(t), dest = path.join(root, 'install');
    const r = cp.spawnSync('sh', [path.join(source, 'install.sh'), ...args], { env: { ...process.env, MINIMAX_CODE_ROOT: dest, XDG_BIN_HOME: path.join(root, 'bin') } });
    assert.equal(r.status, args[0] === '--help' ? 0 : 2, String(r.stderr));
    assert.equal(fs.existsSync(dest), false);
  });
}
test('installer preserves unrelated launcher', t => {
  const root = fixture(t), bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'minimax-code'), 'unrelated');
  const r = cp.spawnSync('sh', [path.join(source, 'install.sh')], { env: { ...process.env, MINIMAX_CODE_ROOT: path.join(root, 'install'), XDG_BIN_HOME: bin } });
  assert.equal(r.status, 1); assert.equal(fs.existsSync(path.join(root, 'install')), false);
  assert.equal(fs.readFileSync(path.join(bin, 'minimax-code'), 'utf8'), 'unrelated');
});
test('installer and uninstaller reject a root disguised with dot components', t => {
  const root=fixture(t);
  for(const script of ['install.sh','uninstall.sh']) {
    const r=cp.spawnSync('sh',[path.join(source,script)],{encoding:'utf8',env:{...process.env,MINIMAX_CODE_ROOT:'/tmp/../',XDG_BIN_HOME:path.join(root,'bin')}});
    assert.equal(r.status,1);assert.match(r.stderr,/unsafe installation root/i);
  }
});
test('installer refuses to overwrite a running application', {skip:!process.env.MINIMAX_TEST_ELECTRON}, async t => {
  const root=fixture(t), dest=path.join(root,'install'), app=path.join(dest,'app-3.1.7');fs.mkdirSync(app,{recursive:true});
  fs.symlinkSync(process.env.MINIMAX_TEST_ELECTRON,path.join(app,'minimax-code'));
  const child=cp.spawn(path.join(app,'minimax-code'),['-e','console.log("ready");setInterval(()=>{},1000)'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},stdio:['ignore','pipe','ignore']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.once('exit',()=>reject(Error('fixture exited early')));});
  const r=cp.spawnSync('sh',[path.join(source,'install.sh')],{encoding:'utf8',env:{...process.env,MINIMAX_CODE_ROOT:dest,XDG_BIN_HOME:path.join(root,'bin')}});
  assert.equal(r.status,1);assert.match(r.stderr,/Close MiniMax Code/);assert.equal(fs.existsSync(path.join(dest,'updater')),false);
});
test('icon extraction preserves upstream PNG bytes', t => {
  const root = fixture(t), src = path.join(root, 'src'), assets = path.join(src, 'out/_next/static/media');
  fs.mkdirSync(assets, { recursive: true });
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  fs.writeFileSync(path.join(assets, 'desktopAppIcon.test.png'), png);
  C.packAsar(src, path.join(root, 'app.asar'), () => false);
  cp.execFileSync(process.execPath, [path.join(source, 'updater/install-icon.js'), path.join(root, 'app.asar'), path.join(root, 'icon.png')]);
  assert.deepEqual(fs.readFileSync(path.join(root, 'icon.png')), png);
});
