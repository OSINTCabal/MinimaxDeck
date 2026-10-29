const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), cp = require('node:child_process');
const C = require('../updater/upd-core.js');
const core = path.resolve(__dirname, '../updater/upd-core.js');
const script = path.resolve(__dirname, '../updater/minimax-update.js');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minimaxdeck-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('kernel lock excludes contenders and recovers a stale PID file', async t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, '.update.lock'), '99999999');
  const release = await C.lock(root); t.after(release);
  const code = `require(${JSON.stringify(core)}).lock(${JSON.stringify(root)}).then(async release=>{await release();process.exitCode=0}).catch(e=>{process.exitCode=e.code==='UPDATE_BUSY'?75:1})`;
  for (let i=0;i<3;i++) assert.equal(cp.spawnSync(process.execPath,['-e',code]).status,75);
  await release();
  assert.equal(cp.spawnSync(process.execPath,['-e',code]).status,0);
});
test('kernel lock releases after its owner is killed', async t => {
  const root = fixture(t);
  const code = `require(${JSON.stringify(core)}).lock(${JSON.stringify(root)}).then(()=>{console.log('locked');setInterval(()=>{},1000)})`;
  const child = cp.spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','inherit']});
  t.after(()=>child.kill('SIGKILL'));
  await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.once('exit',()=>reject(Error('lock fixture exited early')));});
  await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGKILL');});
  let release;
  for(let i=0;i<20;i++) {
    try { release=await C.lock(root); break; }
    catch(e) { if(e.code!=='UPDATE_BUSY')throw e; await new Promise(r=>setTimeout(r,20)); }
  }
  assert.ok(release,'lock remained held after owner exit'); await release();
});
test('an active legacy updater is respected', async t => {
  const root=fixture(t);fs.writeFileSync(path.join(root,'.update.lock'),String(process.pid));
  await assert.rejects(C.lock(root),e=>e.code==='UPDATE_BUSY');
});
test('failed commit restores the previous version', t => {
  const root=fixture(t), dst=path.join(root,'app-3.1.7'), tmp=path.join(root,'app-3.1.7.tmp');
  fs.mkdirSync(dst);fs.writeFileSync(path.join(dst,'original'),'working');fs.mkdirSync(tmp);
  const rename=fs.renameSync;
  fs.renameSync=(a,b)=>{if(a===tmp)throw Error('simulated activation failure');return rename(a,b);};
  try { assert.throws(()=>C.commit(root,tmp,'3.1.7'),/activation failure/); }
  finally { fs.renameSync=rename; }
  assert.equal(fs.readFileSync(path.join(dst,'original'),'utf8'),'working');
});
test('rebuild does not reuse an existing same-version integration', t => {
  const root=fixture(t), app=path.join(root,'app-3.1.7');fs.mkdirSync(path.join(app,'resources'),{recursive:true});
  fs.writeFileSync(path.join(app,'.complete'),'fixture');fs.writeFileSync(path.join(app,'minimax-code'),'#!/bin/sh\nexit 0\n',{mode:0o755});fs.writeFileSync(path.join(app,'resources/app.asar'),'fixture');
  const r=cp.spawnSync(process.execPath,[script,'--stage','--rebuild','--from-file','missing.exe','--version','3.1.7','--json'],{encoding:'utf8',env:{...process.env,MINIMAX_CODE_ROOT:root,MINIMAX_UPDATE_CACHE:path.join(root,'cache')}});
  assert.equal(r.status,1);assert.doesNotMatch(r.stdout,/ready_to_install/);
  assert.equal(fs.readFileSync(path.join(app,'resources/app.asar'),'utf8'),'fixture');
});
test('ASAR rejects truncated headers and out-of-bounds data', t => {
  const root=fixture(t), bad=path.join(root,'bad.asar');fs.writeFileSync(bad,Buffer.alloc(8));
  assert.throws(()=>C.extractAsar(bad,path.join(root,'out')),/ASAR prefix/);
  const src=path.join(root,'src');fs.mkdirSync(src);fs.writeFileSync(path.join(src,'file'),'x');C.packAsar(src,bad,()=>false);
  const bytes=fs.readFileSync(bad), length=bytes.readUInt32LE(12);
  const text=bytes.subarray(16,16+length).toString().replace('"offset":"0"','"offset":"9"');
  bytes.write(text,16,'utf8');fs.writeFileSync(bad,bytes);
  assert.throws(()=>C.extractAsar(bad,path.join(root,'out')),/ASAR file bounds/);
});
test('ASAR tolerates upstream references to omitted optional platform files', t => {
  const root=fixture(t), src=path.join(root,'src'), archive=path.join(root,'app.asar');fs.mkdirSync(src);fs.writeFileSync(path.join(src,'native'),'native bytes');
  C.packAsar(src,archive,()=>true);fs.unlinkSync(archive+'.unpacked/native');
  C.extractAsar(archive,path.join(root,'out'));
  assert.equal(fs.existsSync(path.join(root,'out/native')),false);
});
test('process check ignores a command that only mentions the app path', async t => {
  const root=fixture(t), app=path.join(root,'app-3.1.7');
  const child=cp.spawn(process.execPath,['-e','console.log("ready");setInterval(()=>{},1000)',path.join(app,'minimax-code')],{stdio:['ignore','pipe','ignore']});
  t.after(()=>child.kill());
  await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.once('exit',()=>reject(Error('fixture exited early')));});
  assert.equal(C.isRunning(app),false);
});
