const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const origin=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765';
const artifacts=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 const tests=[],errors=[],external=[];
 async function test(name,action,app=true){
  const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(external.push(r.request().url()),r.abort()));
  await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());
  try{
   await page.goto(origin+(app?'/tienda-smart/':'/'));
   if(app) await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
   await action(page);tests.push(name);console.log('PASS',name);
  }finally{await context.close();}
 }
 try{
  await test('conexión IndexedDB cerrada se reabre y conserva estado y cola sin usar el respaldo pequeño',async page=>{
   assert.deepEqual(await page.evaluate(async()=>{
    await POSStorage.settleWrites();POSStorage.cancelScheduled();clearTimeout(mergedStateBackupTimer);
    STATE.products=[{id:'KEEP',name:'Café',stock:3,price:2,movements:[]}];pendingOps=[{id:'ORIGINAL-ID',type:'product',payload:{id:'KEEP',stock:3}}];ensureStateShape();await POSStorage.commit(STATE,pendingOps);
    (await POSStorage.open()).close();STATE.products[0].stock=2;pendingOps[0].payload.stock=2;
    const original=Storage.prototype.setItem;let fallback=0;Storage.prototype.setItem=function(key,value){if(key==='tienda_critical_fallback_v1'){fallback++;throw new DOMException('Cuota simulada','QuotaExceededError');}return original.call(this,key,value);};
    try{await persistLocalState(true);}finally{Storage.prototype.setItem=original;}
    const saved=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps();return {stock:saved.products[0].stock,id:ops[0].id,queuedStock:ops[0].payload.stock,fallback,issue:!!localSaveIssue};
   }),{stock:2,id:'ORIGINAL-ID',queuedStock:2,fallback:0,issue:false});
  });
  await test('reabrir la base conserva las firmas y no resucita productos ni operaciones eliminados',async page=>{
   assert.deepEqual(await page.evaluate(async()=>{
    await POSStorage.settleWrites();POSStorage.cancelScheduled();clearTimeout(mergedStateBackupTimer);
    const state={...STATE,products:[{id:'DELETE',name:'Eliminar',stock:2}]};await POSStorage.commit(state,[{id:'DELETE-OP',type:'product',payload:{id:'DELETE'}}]);
    (await POSStorage.open()).close();state.products=[];await POSStorage.commit(state,[]);
    return {products:(await POSStorage.loadState()).products.length,queue:(await POSStorage.loadPendingOps()).length};
   }),{products:0,queue:0});
  });
  await test('evento de cierre inesperado permite abrir otra conexión válida',async page=>{
   assert.equal(await page.evaluate(async()=>{
    const previous=await POSStorage.open();previous.close();previous.dispatchEvent(new Event('close'));const next=await POSStorage.open();
    await POSStorage.setMeta('after-close','ok');return previous!==next&&(await POSStorage.getMeta('after-close'))==='ok';
   }),true);
  });
  await test('apertura bloqueada no queda rechazada para siempre ni deja una conexión tardía abierta',async page=>{
   await page.addScriptTag({url:origin+'/tienda-smart/pos-offline.js'});
   assert.deepEqual(await page.evaluate(async()=>{
    const hold=await new Promise((resolve,reject)=>{const r=indexedDB.open('TiendaSmartOffline',2);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    let name;try{await POSStorage.open();}catch(error){name=error.name;}hold.close();
    const db=await POSStorage.open();await POSStorage.setMeta('unblocked',true);return {name,version:db.version,stored:await POSStorage.getMeta('unblocked')};
   }),{name:'StorageBlockedError',version:3,stored:true});
  },false);
  await test('fallo de los dos almacenes conserva la cola, muestra la causa y no apila avisos',async page=>{
   await page.clock.install();
   assert.deepEqual(await page.evaluate(async()=>{
    await POSStorage.settleWrites();POSStorage.cancelScheduled();clearTimeout(mergedStateBackupTimer);
    pendingOps=[{id:'RETAIN',type:'product',payload:{id:'P',stock:2},status:'pending'}];STATE.products=[{id:'P',name:'Prueba',stock:2,movements:[]}];ensureStateShape();await persistLocalState(true);
    window.savedBeforeFailure=savedRevision;STATE.products[0].stock=1;stateRevision++;
    window.originalPut=IDBObjectStore.prototype.put;window.originalSetItem=Storage.prototype.setItem;
    IDBObjectStore.prototype.put=function(...args){throw new DOMException('Espacio simulado agotado','QuotaExceededError');};
    Storage.prototype.setItem=function(key,value){if(key==='tienda_critical_fallback_v1') throw new DOMException('Respaldo simulado lleno','QuotaExceededError');return originalSetItem.call(this,key,value);};
    let failure;try{await persistLocalState(true);}catch(error){failure=error;reportLocalSaveError(error);reportLocalSaveError(error);reportLocalSaveError(error);}
    openSyncCenter();const backup=await POSStorage.createBackup(STATE,pendingOps);return {failed:!!failure,queue:pendingOps.length,stock:backup.state.products[0].stock,backupQueue:backup.pendingOps[0].id,revisionUnchanged:savedRevision===savedBeforeFailure,notices:$$('[data-local-save-toast]').length,label:getSyncSummary().label,space:$('#sync-center-error').textContent.toLowerCase().includes('espacio'),detail:$('#sync-center-error').textContent.includes('QuotaExceededError'),retry:!$('#btn-local-save-retry').classList.contains('hidden')};
   }),{failed:true,queue:1,stock:1,backupQueue:'RETAIN',revisionUnchanged:true,notices:1,label:'Guardado local pendiente',space:true,detail:true,retry:true});
   assert.deepEqual(await page.evaluate(async()=>{
    IDBObjectStore.prototype.put=originalPut;Storage.prototype.setItem=originalSetItem;const recovered=await retryLocalSave();
    const state=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps();return {recovered,issue:!!localSaveIssue,stock:state.products[0].stock,id:ops[0].id,notices:$$('[data-local-save-toast]').length};
   }),{recovered:true,issue:false,stock:1,id:'RETAIN',notices:0});
  });
  await test('error del guardado de cola en segundo plano llega al indicador y se recupera',async page=>{
   await page.clock.install();await page.evaluate(async()=>{
    await POSStorage.settleWrites();POSStorage.cancelScheduled();clearTimeout(mergedStateBackupTimer);window.originalPut=IDBObjectStore.prototype.put;
    pendingOps=[{id:'BACKGROUND',type:'sale',payload:{id:'S'},status:'pending'}];
    IDBObjectStore.prototype.put=function(row,...args){if(this.name==='pendingOps') throw new DOMException('Escritura bloqueada','QuotaExceededError');return originalPut.call(this,row,...args);};
    POSStorage.schedulePendingSave(pendingOps,10);
   });await page.clock.runFor(100);
   assert.deepEqual(await page.evaluate(()=>({issue:localSaveIssue.name,queue:pendingOps[0].id,label:getSyncSummary().label})),{issue:'QuotaExceededError',queue:'BACKGROUND',label:'Guardado local pendiente'});
   await page.evaluate(()=>{IDBObjectStore.prototype.put=originalPut;});await page.clock.runFor(5100);
   await page.evaluate(()=>localSaveRecoveryPromise);
   assert.deepEqual(await page.evaluate(async()=>({issue:!!localSaveIssue,id:(await POSStorage.loadPendingOps())[0].id})),{issue:false,id:'BACKGROUND'});
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(artifacts,'storage-recovery-results.json'),JSON.stringify({passed:tests.length,tests,errors,externalRequests:external.length},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
