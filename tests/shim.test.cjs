const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');
const source = fs.readFileSync(path.resolve(__dirname,'../updater/shim/linux-shim.js'),'utf8');
function integration(spawn) {
  const app = new EventEmitter(), paths = new Map();
  Object.assign(app,{getPath:()=>'/profile',setPath:(k,v)=>paths.set(k,v),setDesktopName:()=>{},getVersion:()=> '3.1.7',whenReady:()=>Promise.resolve()});
  const moduleLoader={_load:()=>({})};
  const context = {
    require:name=>{
      if(name==='electron')return {app};
      if(name==='child_process')return {spawn};
      if(name==='fs')return {existsSync:()=>true};
      if(name==='module')return moduleLoader;
      if(name==='./index.js')return {};
      return require(name);
    },
    process:{platform:'linux',execPath:'/install/app-3.1.7/minimax-code',env:{MINIMAX_CODE_ROOT:'/install'},argv:['minimax-code'],versions:{chrome:'130.0.0.0'}},
    console,setTimeout,setImmediate
  };
  vm.runInNewContext(source,context,{filename:'linux-shim.js'});
  const updater=context.__minimaxLinuxUpdater;updater.on('error',()=>{});
  return {app,paths,updater,moduleLoader};
}
function response(events) {
  const p=new EventEmitter();p.stdout=new EventEmitter();p.stderr=new EventEmitter();
  queueMicrotask(()=>{for(const e of events)p.stdout.emit('data',JSON.stringify(e)+'\n');p.emit('close',0);});
  return p;
}
test('in-app updater discovers, stages and reports a new version', async () => {
  const modes=[];
  const {updater,moduleLoader}=integration((_exe,args)=>{
    const mode=args[1];modes.push(mode);
    return response(mode==='--check'?[{status:'available',version:'3.1.8'}]:[{status:'downloading',percent:50},{status:'ready_to_install',version:'3.1.8'}]);
  });
  const downloaded=[];updater.on('update-downloaded',e=>downloaded.push(e));
  assert.equal(moduleLoader._load('electron-updater').autoUpdater,updater);
  const result=await updater.checkForUpdates();assert.equal(result.isUpdateAvailable,true);
  await result.downloadPromise;
  assert.deepEqual(modes,['--check','--stage']);assert.equal(downloaded.length,1);assert.equal(downloaded[0].version,'3.1.8');
  assert.equal(updater.pending,'3.1.8');assert.equal(updater.running,null);
});
test('updater can retry after a synchronous spawn failure', async () => {
  let attempts=0;
  const {updater}=integration(()=>{if(++attempts===1)throw Error('temporary launch failure');return response([{status:'up_to_date',version:'3.1.7'}]);});
  await assert.rejects(updater.checkForUpdates(),/temporary launch failure/);
  const result=await updater.checkForUpdates();assert.equal(result.isUpdateAvailable,false);assert.equal(attempts,2);
});
test('profile isolation and opt-out of automatic downloads are preserved', async () => {
  const modes=[];
  const {app,paths,updater}=integration((_exe,args)=>{modes.push(args[1]);return response([{status:'available',version:'3.1.8'}]);});
  app.setPath('userData','/another-profile');assert.equal(paths.get('userData'),'/profile/minimax-code');
  updater.autoDownload=false;const result=await updater.checkForUpdates();
  assert.equal(result.downloadPromise,null);assert.deepEqual(modes,['--check']);assert.equal(app.setAsDefaultProtocolClient('minimax'),false);
});
