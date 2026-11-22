const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');
const origin=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765';
const artifacts=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 const tests=[],errors=[],external=[];
 const test=async(name,action)=>{
  const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(external.push(r.request().url()),r.abort()));
  await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());
  try{
   await page.goto(origin+'/tienda-smart/');await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
   await action(page,context);tests.push(name);console.log('PASS',name);
  }finally{await context.close();}
 };
 const mockListeners=page=>page.evaluate(()=>{
  localStorage.setItem(WORK_MODE_KEY,'auto');db={enableNetwork:async()=>{window.enableCalls++;},disableNetwork:async()=>{window.disableCalls++;}};
  window.enableCalls=0;window.disableCalls=0;ensureFirebaseLoaded=async()=>true;initFirebase=()=>{};resolveDbCollectionName=async()=>{};
  migrateOldDataToSubcollections=async()=>{};window.listenerCounts={};window.listeners={};
  subcolRef=name=>({onSnapshot:(options,next,error)=>{if(!options.includeMetadataChanges) throw new Error('Faltan metadatos');listenerCounts[name]=(listenerCounts[name]||0)+1;listeners[name]={next,error};return ()=>{};}});
  window.serverSnapshots=()=>Object.values(listeners).forEach(listener=>listener.next({metadata:{fromCache:false},docChanges:()=>[]}));
 });
 try{
  await test('SDK real carga Auth y Firestore en paralelo y acepta el transporte de compatibilidad',async page=>{
   const result=await page.evaluate(async()=>{
    const loaded=await ensureFirebaseLoaded();initFirebase();const settings=db._delegate._getSettings();
    const result={loaded,version:firebase.SDK_VERSION,autoPolling:settings.experimentalAutoDetectLongPolling,fetchStreams:settings.useFetchStreams,auth:!!firebase.auth};await db.terminate();return result;
   });assert.deepEqual(result,{loaded:true,version:'9.22.2',autoPolling:true,fetchStreams:false,auth:true});
  });
  await test('primera conexión usa la primera prueba positiva sin esperar consultas colgadas',async page=>{
   assert.deepEqual(await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');window.probes=[];
    db={collection:col=>({doc:doc=>({get:options=>{probes.push(options.source);return new Promise(()=>{});},collection:key=>({limit:()=>({get:options=>{probes.push(options.source);return col===DB.col&&key==='products'?Promise.resolve({empty:false}):new Promise(()=>{});}})})})})};
    const col=await resolveDbCollectionName();return {canonical:col===DB.col,reads:probes.length,serverOnly:probes.every(source=>source==='server'),cached:JSON.parse(localStorage.getItem(CLOUD_ROUTE_KEY)).col===col,skip:localStorage.getItem(MIGRATION_KEY)};
   }),{canonical:true,reads:8,serverOnly:true,cached:true,skip:'skipped_verified'});
  });
  await test('ruta alternativa espera que la principal esté verificada vacía',async page=>{
   const result=await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');const release=[];let selected=false;
    db={collection:col=>({doc:doc=>({get:()=>col===DB.col?new Promise(r=>release.push(()=>r({exists:false}))):Promise.resolve({exists:false}),collection:key=>({limit:()=>({get:()=>col===DB.col?new Promise(r=>release.push(()=>r({empty:true}))):Promise.resolve({empty:false})})})})})};
    const task=resolveDbCollectionName().then(col=>{selected=col;return col;});await new Promise(r=>setTimeout(r,0));const early=selected;release.forEach(r=>r());const col=await task;return {early,fallback:col===DB.colFallback,cached:JSON.parse(localStorage.getItem(CLOUD_ROUTE_KEY)).col===DB.colFallback};
   });assert.deepEqual(result,{early:false,fallback:true,cached:true});
  });
  await test('error de permisos en la ruta principal no cambia de base ni habilita envíos',async page=>{
   assert.deepEqual(await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');db={collection:col=>({doc:doc=>({get:()=>Promise.resolve({exists:false}),collection:key=>({limit:()=>({get:()=>col===DB.col&&key==='products'?Promise.reject(Object.assign(new Error('Acceso rechazado'),{code:'permission-denied'})):Promise.resolve({empty:col===DB.col})})})})})};
    let code;try{await resolveDbCollectionName();}catch(error){code=error.code;}
    return {code,routeReady:cloudRouteReady,writesReady:cloudWritesReady,cached:localStorage.getItem(CLOUD_ROUTE_KEY)};
   }),{code:'permission-denied',routeReady:false,writesReady:false,cached:null});
  });
  await test('ruta recordada evita las ocho comprobaciones al volver a abrir',async page=>{
   assert.deepEqual(await page.evaluate(async()=>{
    rememberCloudRoute(DB.colFallback,true);cloudRouteReady=false;collectionResolutionPromise=null;let reads=0;db={collection:()=>{reads++;throw new Error('No debe consultar para resolver');}};
    const col=await resolveDbCollectionName();return {reads,fallback:col===DB.colFallback,routeReady:cloudRouteReady};
   }),{reads:0,fallback:true,routeReady:true});
  });
  await test('ruta de otra tienda o proyecto se descarta y se verifica con el servidor',async page=>{
   assert.deepEqual(await page.evaluate(async()=>{
    localStorage.setItem(CLOUD_ROUTE_KEY,JSON.stringify({projectId:'OTRO',col:DB.colFallback,doc:DB.doc,legacyDoc:DB.legacyDoc,primary:DB.col,fallback:DB.colFallback}));let reads=0;
    db={collection:col=>({doc:doc=>({get:()=>{reads++;return Promise.resolve({exists:false});},collection:key=>({limit:()=>({get:()=>{reads++;return Promise.resolve({empty:true});}})})})})};
    const col=await resolveDbCollectionName();return {reads,canonical:col===DB.col,project:JSON.parse(localStorage.getItem(CLOUD_ROUTE_KEY)).projectId===firebaseConfig.projectId};
   }),{reads:8,canonical:true,project:true});
  });
  await test('espacio agotado para indicadores no bloquea la ruta verificada ni los envíos durables',async page=>{
   assert.deepEqual(await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');ensureFirebaseLoaded=async()=>true;initFirebase=()=>{};let writes=0;window.metadataListeners={};
    db={collection:col=>({doc:doc=>({get:()=>Promise.resolve({exists:false}),collection:key=>({limit:()=>({get:()=>Promise.resolve({empty:col!==DB.col})}),onSnapshot:(options,next,error)=>{metadataListeners[key]={next,error};return ()=>{};}})})})};
    const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if([CLOUD_ROUTE_KEY,MIGRATION_KEY,LAST_SYNC_ERROR_KEY].includes(key)) throw new DOMException('Indicadores sin espacio','QuotaExceededError');return original.call(this,key,value);};
    pendingOps=[{id:'DURABLE-ID',type:'sale',payload:{id:'SALE'},status:'pending'}];executePendingOperation=async()=>{writes++;return true;};
    try{
     await bootstrapCloudSync();await prepareCloudData();await processPendingOps();metadataListeners.products.error(Object.assign(new Error('Permiso rechazado'),{code:'permission-denied'}));
     return {route:cloudRouteReady,migration:cloudMigrationVerified,writes,queue:pendingOps.length,receipt:syncReceipts[0].id,error:syncCollectionStates.products.state};
    }finally{Storage.prototype.setItem=original;}
   }),{route:true,migration:true,writes:1,queue:0,receipt:'DURABLE-ID',error:'error'});
  });
  await test('migración lenta permite conectar las once colecciones y retiene envíos hasta prepararse',async page=>{
   await mockListeners(page);
   const result=await page.evaluate(async()=>{
    migrateOldDataToSubcollections=()=>new Promise(r=>window.finishMigration=r);window.writes=0;executePendingOperation=async()=>{writes++;return true;};
    pendingOps=[{id:'KEEP-ID',type:'sale',payload:{id:'SALE'},status:'pending'}];const boot=await bootstrapCloudSync();serverSnapshots();await processPendingOps();
    const before={boot,listeners:Object.keys(listeners).length,writes,queue:pendingOps.length,ready:getSyncSummary().ready,label:getSyncSummary().label};
    finishMigration();await cloudPreparationPromise;await processPendingOps();return {before,after:{writes,queue:pendingOps.length,receipt:syncReceipts[0].id}};
   });assert.deepEqual(result,{before:{boot:true,listeners:11,writes:0,queue:1,ready:false,label:'Cambios pendientes de envío'},after:{writes:1,queue:0,receipt:'KEEP-ID'}});
  });
  await test('respuestas parciales distinguen conectado, actualización completa y confirmaciones',async page=>{
   await mockListeners(page);
   assert.deepEqual(await page.evaluate(async()=>{
    await bootstrapCloudSync();await prepareCloudData();listeners.products.next({metadata:{fromCache:false},docChanges:()=>[]});
    const partial=getSyncSummary();serverSnapshots();const complete=getSyncSummary();return {partial:partial.label,partialReady:partial.ready,complete:complete.label,ready:complete.ready,receipts:syncReceipts.length};
   }),{partial:'Conectado · Actualizando datos',partialReady:false,complete:'Al día',ready:true,receipts:0});
  });
  await test('fallo de preparación mantiene la cola aunque lleguen datos confirmados',async page=>{
   await mockListeners(page);
   assert.deepEqual(await page.evaluate(async()=>{
    migrateOldDataToSubcollections=async()=>{throw Object.assign(new Error('Preparación no disponible'),{code:'unavailable'});};pendingOps=[{id:'PENDING',type:'sale',payload:{id:'SALE'},status:'pending'}];let writes=0;executePendingOperation=async()=>{writes++;return true;};
    await bootstrapCloudSync();await cloudPreparationPromise;serverSnapshots();await processPendingOps();return {label:getSyncSummary().label,queue:pendingOps.length,writes,receipt:syncReceipts.length,retry:!!cloudRetryTimer};
   }),{label:'Preparación de nube pendiente',queue:1,writes:0,receipt:0,retry:true});
  });
  await test('resolución sin respuesta termina su espera a los seis segundos y comparte lecturas al reintentar',async page=>{
   await page.clock.install();
   await page.evaluate(()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');ensureFirebaseLoaded=async()=>true;initFirebase=()=>{};window.readCount=0;window.writeCount=0;executePendingOperation=async()=>{writeCount++;return true;};
    db={collection:()=>({doc:()=>({get:()=>{readCount++;return new Promise(()=>{});},collection:()=>({limit:()=>({get:()=>{readCount++;return new Promise(()=>{});}})})})})};
    pendingOps=[{id:'WAIT',type:'sale',payload:{id:'SALE'},status:'pending'}];window.boot=bootstrapCloudSync();
   });await page.clock.runFor(6100);
   assert.equal(await page.evaluate(()=>boot),false);await page.clock.runFor(2200);
   assert.deepEqual(await page.evaluate(()=>({reads:readCount,writes:writeCount,queue:pendingOps.length,ready:cloudRouteReady,label:getSyncSummary().label})),{reads:8,writes:0,queue:1,ready:false,label:'Reconectando a la nube'});
  });
  await test('error temporal reintenta sólo la suscripción fallida',async page=>{
   await page.clock.install();await mockListeners(page);
   await page.evaluate(async()=>{await bootstrapCloudSync();await prepareCloudData();serverSnapshots();listeners.products.error(Object.assign(new Error('Red interrumpida'),{code:'unavailable'}));});
   await page.clock.runFor(2200);
   assert.deepEqual(await page.evaluate(()=>({products:listenerCounts.products,others:Object.entries(listenerCounts).filter(([k])=>k!=='products').every(([,v])=>v===1),total:Object.keys(listenerCounts).length,enables:enableCalls,receipts:syncReceipts.length})),{products:2,others:true,total:11,enables:1,receipts:0});
  });
  await test('permiso rechazado muestra error y no genera reintentos continuos',async page=>{
   await page.clock.install();await mockListeners(page);
   await page.evaluate(async()=>{await bootstrapCloudSync();await prepareCloudData();serverSnapshots();listeners.products.error(Object.assign(new Error('Permiso rechazado'),{code:'permission-denied'}));});await page.clock.runFor(6500);
   assert.deepEqual(await page.evaluate(()=>({count:listenerCounts.products,retry:!!cloudRetryTimer,label:getSyncSummary().label,receipts:syncReceipts.length})),{count:1,retry:false,label:'Actualización incompleta',receipts:0});
  });
  await test('conexión atascada con sólo caché reinicia el transporte sin duplicar suscripciones',async page=>{
   await page.clock.install();await mockListeners(page);
   await page.evaluate(async()=>{await bootstrapCloudSync();await prepareCloudData();Object.values(listeners).forEach(listener=>listener.next({metadata:{fromCache:true},docChanges:()=>[]}));});
   await page.clock.runFor(12500);
   assert.deepEqual(await page.evaluate(()=>({label:getSyncSummary().label,disabled:disableCalls,enabled:enableCalls,subscriptions:Object.values(listenerCounts).every(v=>v===1),receipts:syncReceipts.length})),{label:'Reconectando a la nube',disabled:1,enabled:1,subscriptions:true,receipts:0});
  });
  await test('recuperar Internet y volver a la app reactivan la red sin duplicar listeners',async(page,context)=>{
   await page.clock.install();await mockListeners(page);await page.evaluate(async()=>{await bootstrapCloudSync();await prepareCloudData();serverSnapshots();});
   await context.setOffline(true);assert.equal(await page.evaluate(()=>getSyncSummary().label),'Sin Internet');
   await context.setOffline(false);await page.clock.runFor(100);assert.notEqual(await page.evaluate(()=>getSyncSummary().label),'Al día');
   await page.clock.runFor(1600);await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.clock.runFor(100);
   assert.deepEqual(await page.evaluate(()=>{serverSnapshots();return {enables:enableCalls,subscriptions:Object.values(listenerCounts).every(v=>v===1),label:getSyncSummary().label};}),{enables:2,subscriptions:true,label:'Al día'});
  });
  await test('cambiar a solo local durante el inicio cancela conexiones y reintentos tardíos',async page=>{
   assert.deepEqual(await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');window.initCount=0;initFirebase=()=>initCount++;ensureFirebaseLoaded=()=>new Promise(r=>window.finishSDK=r);const task=bootstrapCloudSync();
    await setWorkMode('local');finishSDK(true);const result=await task;return {result,initCount,subscriptions:Object.values(unsubscribers).filter(Boolean).length,retry:!!cloudRetryTimer};
   }),{result:false,initCount:0,subscriptions:0,retry:false});
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(artifacts,'cloud-connection-results.json'),JSON.stringify({passed:tests.length,tests,errors,externalRequests:external.length},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
