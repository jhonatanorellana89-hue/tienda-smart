const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright');const {fixture}=require('./benchmark.cjs');
const origin=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765';
const artifacts=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
 const external=[],errors=[],tests=[];
 await context.route('**/*',r=>{if(new URL(r.request().url()).hostname==='127.0.0.1') return r.continue();external.push(r.request().url());return r.abort();});
 await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());
 const ready=()=>page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
 const test=async(name,action)=>{await action();tests.push(name);console.log('PASS',name);};
 const mockCloud=async()=>{
  await page.evaluate(async()=>{
   localStorage.setItem(WORK_MODE_KEY,'auto');db={};ensureFirebaseLoaded=async()=>true;initFirebase=()=>{};resolveDbCollectionName=async()=>{};migrateOldDataToSubcollections=async()=>{};
   window.mockSnapshots={};subcolRef=name=>({onSnapshot:(options,next,error)=>{if(options.includeMetadataChanges!==true) throw new Error('Faltan cambios de metadatos');mockSnapshots[name]={next,error};return ()=>{};}});
   await startFirestoreSync();
   Object.values(mockSnapshots).forEach(s=>s.next({metadata:{fromCache:false},docChanges:()=>[]}));
   await processPendingOps();
  });
 };
 try{
  await page.goto(origin+'/tienda-smart/');await ready();
  await test('reportes sólo Excel; sin exportador ni dependencias PDF activas',async()=>{
   assert.equal(await page.evaluate(()=>typeof downloadReportPDF==='undefined'&&typeof ensurePDFLoaded==='undefined'&&!document.querySelector('[onclick*="downloadReportPDF"]')),true);
   for(const file of ['html2canvas-1.4.1.min.js','jspdf-2.5.1.umd.min.js']) assert.equal(fs.existsSync(path.join(__dirname,'../libs',file)),false);
  });
  await test('panel diferencia espera, envío y error sin interpretar conexión como confirmación',async()=>{
   const result=await page.evaluate(()=>{
    pendingOps=[{id:'WAIT',type:'sale',payload:{id:'V-1'},status:'pending',ts:new Date().toISOString()},{id:'ERROR',type:'product',payload:{name:'<img src=x onerror=alert(1)>'},status:'error',lastError:'Acceso rechazado',nextAttemptAt:new Date(Date.now()+60000).toISOString()},{id:'SEND',type:'customer',payload:{name:'Cliente'},status:'processing'}];
    syncInProgress=true;activeSyncOperationId='SEND';openSyncCenter();const result={total:$('#sync-center-pending').textContent,waiting:$('#sync-center-waiting').textContent,sending:$('#sync-center-sending').textContent,error:$('#sync-center-errors').textContent,label:$('#sync-center-status').textContent,unsafe:!!$('#sync-queue-list img')};syncInProgress=false;activeSyncOperationId=null;return result;
   });assert.deepEqual(result,{total:'3',waiting:'1',sending:'1',error:'1',label:'Solo en este equipo',unsafe:false});
  });
  await test('un estado de envío heredado tras recargar vuelve a mostrarse en espera',async()=>{
   assert.equal(await page.evaluate(()=>{renderSyncCenter();return $('#sync-center-sending').textContent==='0'&&$('#sync-center-waiting').textContent==='2'&&!$('#sync-queue-list').textContent.includes('Enviando; esperando confirmación');}),true);
  });
  await test('cola extensa paginada conserva las 2001 operaciones y permite filtrar errores',async()=>{
   const result=await page.evaluate(async()=>{
    pendingOps=Array.from({length:2001},(_,i)=>({id:'QUEUE-'+i,type:'product',payload:{id:'P'+i},status:i===2000?'error':'pending'}));
    syncQueuePage=0;renderSyncCenter();const first=$$('#sync-queue-list [data-sync-op-id]').length;
    syncQueuePage=100;renderSyncOperations();const last=$$('#sync-queue-list [data-sync-op-id]').length;
    $('#sync-queue-filter').value='errors';syncQueuePage=0;renderSyncOperations();const filtered=$$('#sync-queue-list [data-sync-op-id]').length;
    const count=pendingOps.length;pendingOps=[];$('#sync-queue-filter').value='all';await persistLocalState(true);return {first,last,filtered,count};
   });assert.deepEqual(result,{first:20,last:1,filtered:1,count:2001});
  });
  await mockCloud();
  await test('datos de caché, Internet y actualización completa muestran estados distintos',async()=>{
   assert.equal(await page.evaluate(()=>{updateOnline(true);return getSyncSummary().label;}),'Al día');
   assert.equal(await page.evaluate(()=>{mockSnapshots.products.next({metadata:{fromCache:true},docChanges:()=>[]});return getSyncSummary().label;}),'Esperando respuesta de la nube');
   await context.setOffline(true);assert.equal(await page.evaluate(()=>getSyncSummary().label),'Sin Internet');
   await context.setOffline(false);assert.notEqual(await page.evaluate(()=>getSyncSummary().label),'Al día');
   await page.evaluate(()=>Object.values(mockSnapshots).forEach(s=>s.next({metadata:{fromCache:false},docChanges:()=>[]})));
   assert.equal(await page.evaluate(()=>getSyncSummary().label),'Al día');
  });
  await test('snapshot no retira un envío en curso ni crea un recibo de confirmación',async()=>{
   await page.evaluate(()=>{
    pendingOps=[{id:'SALE-RECEIPT',type:'sale',payload:{id:'VENTA-1'},status:'pending',ts:new Date().toISOString()}];
    window.writeCalls=0;executePendingOperation=()=>{writeCalls++;return new Promise(resolve=>window.confirmWrite=resolve);};window.flushPromise=processPendingOps();
   });await page.waitForFunction(()=>!!window.confirmWrite);await page.waitForTimeout(80);
   const result=await page.evaluate(async()=>{
    mockSnapshots.products.next({metadata:{fromCache:false,hasPendingWrites:false},docChanges:()=>[]});
    const durable=await POSStorage.loadPendingOps();return {queue:pendingOps.length,durable:durable.length,receipts:syncReceipts.length,label:getSyncSummary().label,calls:writeCalls};
   });assert.deepEqual(result,{queue:1,durable:1,receipts:0,label:'Enviando operaciones',calls:1});
  });
  await test('confirmación de escritura guarda recibo y retirada de cola juntos',async()=>{
   await page.evaluate(async()=>{confirmWrite(true);await flushPromise;renderSyncCenter();});
   const result=await page.evaluate(async()=>({queue:(await POSStorage.loadPendingOps()).length,receipts:(await POSStorage.getMeta('syncReceiptLogV1')).length,id:syncReceipts[0].id,label:getSyncSummary().label}));
   assert.deepEqual(result,{queue:0,receipts:1,id:'SALE-RECEIPT',label:'Al día'});
   await page.reload();await ready();assert.equal(await page.evaluate(()=>{openSyncCenter();return $('#sync-receipts-list').textContent.includes('VENTA-1')&&syncReceipts.length===1;}),true);
  });
  await mockCloud();
  await test('error visible y doble reintento conservan ID y realizan un solo envío adicional',async()=>{
   await page.evaluate(async()=>{
    pendingOps=[{id:'RETRY-ID',type:'product',payload:{id:'RETRY-P'},status:'pending'}];window.retryCalls=0;
    executePendingOperation=async()=>{retryCalls++;if(retryCalls===1) throw Object.assign(new Error('Sin respuesta simulada'),{code:'unavailable'});return true;};await processPendingOps();openSyncCenter();
   });assert.equal(await page.evaluate(()=>$('#sync-center-errors').textContent),'1');
   await page.evaluate(()=>{const button=$('#sync-queue-list button');button.click();button.click();});
   await page.waitForFunction(()=>!syncActionInProgress&&!syncInProgress&&pendingOps.length===0);
   assert.deepEqual(await page.evaluate(()=>({calls:retryCalls,receipts:syncReceipts.filter(r=>r.id==='RETRY-ID').length})),{calls:2,receipts:1});
  });
  await test('fallo al guardar recibo aborta la retirada y reintenta sin repetir escritura confirmada',async()=>{
   const result=await page.evaluate(async()=>{
    pendingOps=[{id:'LOCAL-RECEIPT-FAIL',type:'sale',payload:{id:'VENTA-LOCAL-FAIL'},status:'pending'}];
    let calls=0;executePendingOperation=async()=>{calls++;return true;};const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(row,...args){if(this.name==='meta'&&row?.key==='syncReceiptLogV1') throw new Error('Fallo simulado de recibo');return original.call(this,row,...args);};
    await processPendingOps();const retained=pendingOps.length,proof=!!pendingOps[0].cloudConfirmedAt;
    const before=(await POSStorage.getMeta('syncReceiptLogV1')).some(r=>r.id==='LOCAL-RECEIPT-FAIL');
    IDBObjectStore.prototype.put=original;await retrySyncOperation('LOCAL-RECEIPT-FAIL');
    return {retained,proof,before,calls,remaining:pendingOps.length,stored:(await POSStorage.loadPendingOps()).length,receipt:syncReceipts[0].id};
   });assert.deepEqual(result,{retained:1,proof:true,before:false,calls:1,remaining:0,stored:0,receipt:'LOCAL-RECEIPT-FAIL'});
  });
  await test('actualizar una operación con el mismo ID invalida la confirmación del contenido anterior',async()=>{
   const result=await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'local');
    pendingOps=[{id:'REUSED-ID',type:'product',payload:{id:'PRODUCT',stock:1},cloudConfirmedAt:'2026-01-01',status:'error'}];
    addPendingOp({id:'REUSED-ID',type:'product',payload:{id:'PRODUCT',stock:2},silent:true});const cleared=!pendingOps[0].cloudConfirmedAt;
    localStorage.setItem(WORK_MODE_KEY,'auto');let sent;executePendingOperation=async op=>{sent=op.payload.stock;return true;};await processPendingOps();return {cleared,sent,queue:pendingOps.length};
   });assert.deepEqual(result,{cleared:true,sent:2,queue:0});
  });
  await test('un recibo local tardío conserva la fecha de la confirmación más reciente',async()=>{
   const result=await page.evaluate(async()=>{
    const latest=syncReceipts[0].confirmedAt;pendingOps=[{id:'OLD-PROOF',type:'sale',payload:{id:'VENTA-ANTERIOR'},status:'error',cloudConfirmedAt:'2000-01-01T00:00:00.000Z'}];
    let calls=0;executePendingOperation=async()=>{calls++;return true;};await processPendingOps();
    return {calls,latestUnchanged:syncReceipts[0].confirmedAt===latest,storedLatest:localStorage.getItem(LAST_SYNC_KEY)===latest,contains:syncReceipts.some(r=>r.id==='OLD-PROOF')};
   });assert.deepEqual(result,{calls:0,latestUnchanged:true,storedLatest:true,contains:true});
  });
  await test('conflictos muestran stock y turnos sin modificar ni resolver registros automáticamente',async()=>{
   assert.equal(await page.evaluate(()=>{
    STATE.syncConflicts=[{id:'STOCK',type:'STOCK_CONCURRENT',productName:'Producto',localStock:4,remoteStock:2,status:'OPEN'},{id:'SHIFT',type:'SHIFT_OTHER_DEVICE',status:'OPEN'}];
    const before=JSON.stringify(STATE.syncConflicts);renderSyncCenter();return $('#sync-conflicts-list').textContent.includes('Stock en este equipo: 4')&&$('#sync-conflicts-list').textContent.includes('Turno abierto en otro equipo')&&before===JSON.stringify(STATE.syncConflicts)&&getSyncSummary().label==='Revisión pendiente';
   }),true);
  });
  await test('actualización manual de datos comparte una sola lectura y no crea confirmaciones de escritura',async()=>{
   const result=await page.evaluate(async()=>{
    window.confirm=()=>true;let reads=0;const resolvers=[];fetchSubcollectionDocs=()=>{reads++;return new Promise(resolve=>resolvers.push(resolve));};
    const receiptsBefore=syncReceipts.length;const first=forceSync(),second=forceSync();
    const busy=getSyncSummary().label;await new Promise(resolve=>setTimeout(resolve,0));resolvers.forEach(resolve=>resolve([]));await Promise.all([first,second]);
    return {reads,busy,receiptsUnchanged:receiptsBefore===syncReceipts.length,finished:!syncRefreshInProgress};
   });assert.deepEqual(result,{reads:11,busy:'Actualizando desde la nube',receiptsUnchanged:true,finished:true});
  });
  await test('Excel exporta los 5000 productos aunque la pantalla muestre sólo una página',async()=>{
   await page.evaluate(data=>{STATE.products=data.products;ensureStateShape();renderInventoryList();},fixture(5000));
   const download=page.waitForEvent('download');await page.evaluate(()=>exportInventoryXLSX());const file=await download;const output=path.join(artifacts,'inventario-5000.xlsx');await file.saveAs(output);
   const result=await page.evaluate(bytes=>{const wb=XLSX.read(new Uint8Array(bytes),{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets.Inventario_Actual);return {count:rows.length,first:rows[0].codigo,last:rows.at(-1).productoId};},[...fs.readFileSync(output)]);
   assert.deepEqual(result,{count:5000,first:'0000000000000',last:'P4999'});
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(artifacts,'sync-results.json'),JSON.stringify({passed:tests.length,tests,errors,externalRequests:external.length},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
