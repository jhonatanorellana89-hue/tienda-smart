const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
const origin=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765',out=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});const tests=[],errors=[],external=[];
 async function test(name,action){
  const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(external.push(r.request().url()),r.abort()));
  await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());
  try{await page.goto(origin+'/tienda-smart/');await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');await action(page,context);tests.push(name);console.log('PASS',name);}finally{await context.close();}
 }
 const setup=page=>page.evaluate(async()=>{
  await POSStorage.settleWrites();POSStorage.cancelScheduled();clearTimeout(mergedStateBackupTimer);
  localStorage.setItem(WORK_MODE_KEY,'auto');cloudRouteReady=true;cloudWritesReady=true;window.calls=[];window.documents={};window.singleCalls=0;
  db={batch:()=>{const rows=[];return {set:(ref,payload,options)=>rows.push({ref,payload,options}),commit:async()=>{calls.push(rows);rows.forEach(row=>documents[row.ref.collection+'/'+row.ref.id]=row.payload);}};}};
  subcolRef=collection=>({doc:id=>({collection,id,set:async(payload,options)=>{singleCalls++;documents[collection+'/'+id]=payload;}})});
  window.saleOp=(id,ts=0)=>({id:'OP-'+id,type:'sale',payload:{id,date:new Date().toISOString(),total:2,items:[]},ts:new Date(ts).toISOString(),status:'pending',silent:true});
 });
 try{
  await test('1200 operaciones se confirman por lotes y el recibo borra sólo IDs confirmados',async page=>{
   await setup(page);const result=await page.evaluate(async()=>{
    pendingOps=Array.from({length:1000},(_,i)=>saleOp('SALE-'+i,i));pendingOps.push(...Array.from({length:200},(_,i)=>({id:'A-'+i,type:'audit',payload:{id:'AUDIT-'+i,ts:'2020-01-01'},silent:true})));
    const original=POSStorage.acknowledgePendingOps;let checkpoints=0;POSStorage.acknowledgePendingOps=(...args)=>{checkpoints++;return original(...args);};
    await processPendingOps();return {calls:calls.length,max:Math.max(...calls.map(rows=>rows.length)),docs:Object.keys(documents).length,queue:pendingOps.length,durable:(await POSStorage.loadPendingOps()).length,receipts:syncReceipts.length,checkpoints,singleCalls};
   });assert.deepEqual(result,{calls:12,max:100,docs:1200,queue:0,durable:0,receipts:20,checkpoints:12,singleCalls:0});
  });
  await test('payloads de lotes conservan exactamente las reglas de los exportadores originales de nube',async page=>{
   await setup(page);await page.clock.setFixedTime(new Date());
   const rows=await page.evaluate(async()=>{
    const types=['sale','product','customer','staff','shift','purchase','supplier','audit','stockMovement','stockClosure','syncConflict'];const result=[];
    const originalRef=subcolRef;
    for(const type of types){let actual;subcolRef=collection=>({doc:id=>({set:async(payload,options)=>actual={collection,id,payload,merge:options.merge}})});
     const op={type,payload:{id:'ID',deleted:true,updatedAt:'2020-01-01T00:00:00.000Z'}};await defaultExecutePendingOperation(op);result.push({actual,batched:syncWriteDescriptors(op)[0]});}
    subcolRef=originalRef;return result;
   });rows.forEach(row=>assert.deepEqual(row.batched,row.actual));
  });
  await test('venta nueva adelanta auditorías y ventas antiguas independientes',async page=>{
   await setup(page);assert.equal(await page.evaluate(async()=>{
    pendingOps=Array.from({length:500},(_,i)=>({id:'A'+i,type:'audit',payload:{id:'A'+i},silent:true}));pendingOps.push(...Array.from({length:200},(_,i)=>saleOp('OLD'+i,i)),saleOp('NEW',Date.now()));
    await processPendingOps();return calls[0][0].payload.id==='NEW'&&Object.keys(documents).length===701&&pendingOps.length===0;
   }),true);
  });
  await test('misma entidad y ventas a crédito conservan el orden antes de confirmar',async page=>{
   await setup(page);const result=await page.evaluate(async()=>{
    pendingOps=[{id:'C-OLD',type:'customer',payload:{id:'C',balance:2}},{id:'P-OLD',type:'product',payload:{id:'P',stock:3}},saleOp('SALE'),{id:'P-NEW',type:'product',payload:{id:'P',stock:2}},{id:'C-NEW',type:'customer',payload:{id:'C',balance:4}}];pendingOps[2].payload.customerId='C';
    await processPendingOps();const order=calls.flat().map(row=>row.ref.collection+':'+row.payload.id+':'+(row.payload.balance??row.payload.stock??''));
    return {stock:documents['products/P'].stock,balance:documents['customers/C'].balance,customerFirst:order.indexOf('customers:C:2')<order.indexOf('sales:SALE:'),orderPreserved:order.indexOf('products:P:3')<order.indexOf('products:P:2'),queue:pendingOps.length};
   });assert.deepEqual(result,{stock:2,balance:4,customerFirst:true,orderPreserved:true,queue:0});
  });
  await test('un registro rechazado no retiene las ventas que sí se pueden confirmar',async page=>{
   await setup(page);assert.deepEqual(await page.evaluate(async()=>{
    db.batch=()=>{const rows=[];return {set:(ref,payload)=>rows.push({ref,payload}),commit:async()=>{throw Object.assign(new Error('Uno no tiene permiso'),{code:'permission-denied'});}};};
    subcolRef=collection=>({doc:id=>({collection,id,set:async payload=>{if(id==='BAD') throw Object.assign(new Error('Rechazado'),{code:'permission-denied'});documents[collection+'/'+id]=payload;}})});
    pendingOps=[saleOp('GOOD-1'),saleOp('BAD'),saleOp('GOOD-2')];await processPendingOps();return {docs:Object.keys(documents).length,retained:pendingOps.map(op=>op.payload.id),error:pendingOps[0].status,receipts:syncReceipts.length};
   }),{docs:2,retained:['BAD'],error:'error',receipts:2});
  });
  await test('confirmación local fallida conserva IDs y prueba de nube, sin repetir el lote al reintentar',async page=>{
   await setup(page);assert.deepEqual(await page.evaluate(async()=>{
    pendingOps=[saleOp('ONE'),saleOp('TWO')];const put=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(row,...args){if(this.name==='meta'&&row?.key==='syncReceiptLogV1') throw new Error('Recibo bloqueado');return put.call(this,row,...args);};
    await processPendingOps();const before={queue:pendingOps.length,proof:pendingOps.every(op=>op.cloudConfirmedAt),durable:(await POSStorage.loadPendingOps()).length,receipts:syncReceipts.length};IDBObjectStore.prototype.put=put;
    pendingOps.forEach(op=>op.nextAttemptAt=null);await processPendingOps();return {before,calls:calls.length,queue:pendingOps.length,durable:(await POSStorage.loadPendingOps()).length,receipts:syncReceipts.length};
   }),{before:{queue:2,proof:true,durable:2,receipts:0},calls:1,queue:0,durable:0,receipts:2});
  });
  await test('escritura sin respuesta no se reenvía y permite avanzar otra venta independiente',async page=>{
   await setup(page);await page.clock.install();
   await page.evaluate(()=>{
    window.batchCount=0;window.recoveries=0;resumeCloudConnection=()=>recoveries++;
    db.batch=()=>{const rows=[];return {set:(ref,payload)=>rows.push({ref,payload}),commit:()=>{batchCount++;if(batchCount===1) return new Promise(r=>window.releaseBatch=()=>{rows.forEach(row=>documents[row.ref.collection+'/'+row.ref.id]=row.payload);r();});rows.forEach(row=>documents[row.ref.collection+'/'+row.ref.id]=row.payload);return Promise.resolve();}};};
    pendingOps=[saleOp('WAIT1'),saleOp('WAIT2')];window.flush=processPendingOps();
   });await page.evaluate(()=>POSStorage.settleWrites());await page.clock.runFor(20100);await page.evaluate(()=>flush);
   assert.deepEqual(await page.evaluate(()=>({calls:batchCount,queue:pendingOps.length,receipts:syncReceipts.length,sending:getSyncSummary().sending,recoveries})),{calls:1,queue:2,receipts:0,sending:2,recoveries:1});
   await page.evaluate(async()=>{addPendingOp(saleOp('FAST'));await processPendingOps();});
   assert.deepEqual(await page.evaluate(()=>({calls:batchCount,queue:pendingOps.length,fast:!!documents['sales/FAST'],receipts:syncReceipts.length})),{calls:1,queue:2,fast:true,receipts:1});
   await page.evaluate(()=>releaseBatch());await page.clock.runFor(100);await page.evaluate(()=>processPendingOps());
   assert.deepEqual(await page.evaluate(async()=>({calls:batchCount,queue:pendingOps.length,durable:(await POSStorage.loadPendingOps()).length,receipts:syncReceipts.length})),{calls:1,queue:0,durable:0,receipts:3});
  });
  await test('cambiar el contenido de un ID mientras se envía conserva la nueva operación',async page=>{
   await setup(page);const result=await page.evaluate(async()=>{
    window.sendCalls=0;const started=new Promise(r=>window.oldStarted=r);executePendingOperation=op=>{sendCalls++;if(sendCalls===1)return new Promise(r=>{window.releaseOld=r;oldStarted();});return Promise.resolve(true);};
    const old=saleOp('SAME');old.payload.total=2;pendingOps=[old];const flush=processPendingOps();await started;
    const updated=saleOp('SAME');updated.payload.total=4;addPendingOp(updated);releaseOld(true);await flush;
    return {sendCalls,queue:pendingOps.length,receipts:syncReceipts.length,receiptId:syncReceipts[0].id};
   });assert.deepEqual(result,{sendCalls:2,queue:0,receipts:1,receiptId:'OP-SAME'});
  });
  await test('ventas recientes se muestran antes de terminar el archivo y no se borran al salir del límite',async page=>{
   const result=await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');db={};cloudRouteReady=true;cloudWritesReady=true;window.recentCallback=null;window.archiveCallback=null;window.recentLimit=0;
    subcolRef=name=>({orderBy:(field,order)=>({limit:count=>({onSnapshot:(options,next)=>{recentLimit=count;recentCallback=next;return ()=>{};}})}),onSnapshot:(options,next)=>{if(name==='sales') archiveCallback=next;return ()=>{};}});
    await startFirestoreSync();const archiveBefore=!!archiveCallback;const sale={id:'REMOTE-NEW',date:new Date().toISOString(),total:12,items:[]};
    recentCallback({metadata:{fromCache:false},docChanges:()=>[{type:'added',doc:{id:sale.id,data:()=>sale}}]});
    openModal('modal-gestion');renderGestionList();const shown=$('#gestion-list').textContent.includes('REMOTE-NEW');
    recentCallback({metadata:{fromCache:false},docChanges:()=>[{type:'removed',doc:{id:sale.id,data:()=>sale}}]});
    return {recentLimit,archiveBefore,archiveAfter:!!archiveCallback,shown,retained:STATE.sales.some(s=>s.id===sale.id),queue:pendingOps.length};
   });assert.deepEqual(result,{recentLimit:80,archiveBefore:false,archiveAfter:true,shown:true,retained:true,queue:0});
  });
  await test('una venta confirmada se visualiza en otro equipo antes de recibir todo el historial',async sender=>{
   const receiverContext=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
   await receiverContext.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(external.push(r.request().url()),r.abort()));
   await receiverContext.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
   try{
    const receiver=await receiverContext.newPage();receiver.on('pageerror',e=>errors.push(String(e)));await receiver.goto(origin+'/tienda-smart/');await receiver.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
    await receiver.evaluate(async()=>{
     localStorage.setItem(WORK_MODE_KEY,'auto');db={};cloudRouteReady=true;cloudWritesReady=true;
     subcolRef=name=>({orderBy:()=>({limit:()=>({onSnapshot:(options,next)=>{window.receiveRecent=next;return ()=>{};}})}),onSnapshot:(options,next)=>{if(name==='sales') window.receiveArchive=next;return ()=>{};}});await startFirestoreSync();openModal('modal-gestion');
    });
    await sender.exposeFunction('deliverSales',rows=>receiver.evaluate(rows=>{
     const sales=rows.filter(row=>row.ref.collection==='sales');receiveRecent({metadata:{fromCache:false},docChanges:()=>sales.map(row=>({type:'added',doc:{id:row.payload.id,data:()=>row.payload}}))});renderGestionList();
    },rows));
    await setup(sender);await sender.evaluate(async()=>{
     db.batch=()=>{const rows=[];return {set:(ref,payload)=>rows.push({ref,payload}),commit:async()=>{await deliverSales(rows);}};};
     pendingOps=[saleOp('OTHER-DEVICE-1'),saleOp('OTHER-DEVICE-2')];pendingOps[0].payload.total=10;pendingOps[1].payload.total=12;await processPendingOps();
    });
    assert.deepEqual(await receiver.evaluate(()=>({visible:$('#gestion-list').textContent.includes('OTHER-DEVICE-1')&&$('#gestion-list').textContent.includes('OTHER-DEVICE-2'),total:generateReportData(todayYMD(),todayYMD()).grand,count:STATE.sales.length,archiveStillLoading:syncCollectionStates.sales.state==='connecting'})),{visible:true,total:22,count:2,archiveStillLoading:true});
    await receiver.evaluate(()=>receiveArchive({metadata:{fromCache:false},docChanges:()=>[{type:'added',doc:{id:'HISTORY',data:()=>({id:'HISTORY',date:'2020-01-01T12:00:00Z',total:1,items:[]})}}]}));
    await receiver.waitForFunction(()=>STATE.sales.length===3);assert.equal(await sender.evaluate(async()=>pendingOps.length===0&&(await POSStorage.loadPendingOps()).length===0),true);
   }finally{await receiverContext.close();}
  });
  await test('fechas Timestamp de Firestore se ven y cuentan en los reportes del día',async page=>{
   assert.equal(await page.evaluate(()=>{
    const seconds=Math.floor(Date.now()/1000);mergeFromSubcollection('sales',[{id:'TIMESTAMP',date:{seconds,nanoseconds:123000000},total:12,items:[]}]);
    renderGestionList();return typeof STATE.sales[0].date==='string'&&salesInRange(todayYMD(),todayYMD()).some(s=>s.id==='TIMESTAMP')&&!$('#gestion-list').textContent.includes('Invalid Date');
   }),true);
  });
  await test('una compra de 450 escrituras conserva atomicidad y límites al convivir con ventas',async page=>{
   await setup(page);assert.deepEqual(await page.evaluate(async()=>{
    pendingOps=[{id:'PURCHASE',type:'purchaseBundle',payload:{purchase:{id:'PUR'},products:Array.from({length:449},(_,i)=>({id:'P'+i,stock:1}))},silent:true},...Array.from({length:5},(_,i)=>saleOp('S'+i))];
    await processPendingOps();return {sizes:calls.map(rows=>rows.length),docs:Object.keys(documents).length,queue:pendingOps.length};
   }),{sizes:[5,450],docs:455,queue:0});
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);fs.writeFileSync(path.join(out,'sales-sync-results.json'),JSON.stringify({passed:tests.length,tests,errors,externalRequests:external.length},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
