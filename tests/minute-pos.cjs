const fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
const origin=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765',out=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});const tests=[],errors=[],external=[];
 const test=async(name,action)=>{
  const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(external.push(r.request().url()),r.abort()));
  await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
  try{await page.goto(origin+'/tienda-smart/');await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');await action(page);tests.push(name);console.log('PASS',name);}finally{await context.close();}
 };
 const seed=(page,history=100)=>page.evaluate(async history=>{
  await POSStorage.settleWrites();POSStorage.cancelScheduled();clearTimeout(mergedStateBackupTimer);const now=Date.now();
  STATE={products:[{id:'P',name:'Café',stock:1000,price:2.5,costPrice:1,movements:[]}],sales:Array.from({length:history},(_,i)=>({id:'H'+i,date:new Date(now-(i+3000)*60000).toISOString(),total:2,paymentType:'EFECTIVO',shiftId:'OLD',items:[{productId:'P',qty:1,unitPrice:2}]})),customers:[{id:'C',name:'Cliente',balance:0}],stockMovements:[],staff:[],shifts:[{id:'MINUTE',staffId:'ADMIN-LIZ',staffName:'Liz',status:'OPEN',openedAt:new Date(now).toISOString(),openingCash:10}],purchases:[],suppliers:[],auditLogs:[],stockClosures:[],syncConflicts:[]};
  pendingOps=[];ensureStateShape();activateShiftLocally('MINUTE');saveLocalBackup();await persistLocalState(true);renderDashboard(true);calculateShiftSummary(getActiveShiftForCurrentUser());
  window.makeTestSale=async(method='EFECTIVO')=>{cart=[];addToCart(getProductById('P'));payMethod=method;renderCreditCustomerOptions();$('#pos-customer').value=method==='A_CREDITO'?'C':'';await completeSale();return STATE.sales[0]?.id;};
 },history);
 try{
  await test('el comprobante aparece guardado en esta caja sin esperar confirmación de nube',async page=>{
   await seed(page);assert.deepEqual(await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');db={};cloudRouteReady=true;cloudWritesReady=true;executePendingOperation=()=>new Promise(()=>{});
    const id=await makeTestSale();const state=await POSStorage.loadState();return {shown:$('#last-sale-receipt').dataset.saleId===id,amount:$('#last-sale-amount').textContent,product:$('#last-sale-items').textContent,pending:$('#last-sale-sync').textContent.includes('Pendiente'),durable:state.sales.some(s=>s.id===id),stock:state.products[0].stock};
   }),{shown:true,amount:'S/ 2.50',product:'1 × Café',pending:true,durable:true,stock:999});
  });
  await test('un guardado lento muestra Guardando, evita doble cobro y no adelanta el comprobante',async page=>{
   await seed(page);await page.evaluate(()=>{
    window.originalCommit=POSStorage.commit;window.storageStarted=new Promise(r=>window.notifyStorageStarted=r);
    POSStorage.commit=async(...args)=>{if(args[3]?.lastSale){notifyStorageStarted();await new Promise(r=>window.finishStorage=r);}return originalCommit(...args);};
    window.checkout=makeTestSale();
   });await page.evaluate(()=>storageStarted);
   assert.deepEqual(await page.evaluate(async()=>({shown:!!$('#last-sale-receipt').dataset.saleId,busy:$('#modal-sale button[onclick="completeSale()"]').textContent,durable:(await POSStorage.loadState()).sales.length})),{shown:false,busy:'Guardando venta...',durable:100});
   await page.evaluate(async()=>{await completeSale();finishStorage();await checkout;POSStorage.commit=originalCommit;});
   assert.deepEqual(await page.evaluate(async()=>({sales:(await POSStorage.loadState()).sales.length,stock:getProductById('P').stock,shown:!!$('#last-sale-receipt').dataset.saleId})),{sales:101,stock:999,shown:true});
  });
  await test('60 ventas, una por minuto, con 100000 históricas conservan stock, crédito, turno y respuesta local',async page=>{
   await seed(page,100000);await page.clock.install();
   await page.evaluate(()=>{window.archiveSerializations=0;const old=STATE.sales.at(-1);old.toJSON=()=>{archiveSerializations++;return {...old,toJSON:undefined};};});
   for(let i=0;i<60;i++){await page.clock.fastForward(60000);await page.evaluate(method=>makeTestSale(method),['EFECTIVO','YAPE','A_CREDITO'][i%3]);}
   const result=await page.evaluate(async()=>{
    const state=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps(),summary=calculateShiftSummary(getActiveShiftForCurrentUser());
    return {count:state.sales.length,stock:state.products[0].stock,balance:state.customers[0].balance,shiftSales:summary.sales.length,total:summary.total,cash:summary.expectedCash,yape:summary.payments.YAPE,queue:ops.length,unique:new Set(ops.map(op=>op.id)).size,archiveSerializations,receipt:$('#last-sale-receipt').dataset.saleId===STATE.sales[0].id};
   });assert.deepEqual(result,{count:100060,stock:940,balance:50,shiftSales:60,total:150,cash:60,yape:50,queue:200,unique:200,archiveSerializations:0,receipt:true});
  });
  await test('fallar ambos almacenes conserva el comprobante anterior y no reaparece una venta revertida',async page=>{
   await seed(page);const result=await page.evaluate(async()=>{
    const first=await makeTestSale(),commit=POSStorage.commit,set=Storage.prototype.setItem,put=IDBObjectStore.prototype.put;let failed;
    POSStorage.commit=(...args)=>{failed=args[3]?.lastSale?.id;return commit(...args);};IDBObjectStore.prototype.put=function(row,...args){if(this.name==='meta'&&row?.key==='incrementalOrderHeadsV1') throw new DOMException('Metadatos sin espacio','QuotaExceededError');return put.call(this,row,...args);};Storage.prototype.setItem=function(key,value){if(key==='tienda_critical_fallback_v1') throw new DOMException('Lleno','QuotaExceededError');return set.call(this,key,value);};
    await makeTestSale();const unchanged=$('#last-sale-receipt').dataset.saleId===first&&STATE.sales.length===101&&getProductById('P').stock===999;
    POSStorage.commit=commit;Storage.prototype.setItem=set;IDBObjectStore.prototype.put=put;await makeTestSale();await persistLocalState(true);const state=await POSStorage.loadState();
    return {unchanged,count:state.sales.length,stock:state.products[0].stock,ghost:state.sales.some(s=>s.id===failed),queuedGhost:pendingOps.some(op=>op.payload?.id===failed)};
   });assert.deepEqual(result,{unchanged:true,count:102,stock:998,ghost:false,queuedGhost:false});
  });
  await test('orden de más de 200 ventas nuevas se conserva tras reiniciar y un guardado completo',async page=>{
   await seed(page,5);assert.equal(await page.evaluate(async()=>{
    const now=Date.now(),rows=Array.from({length:250},(_,i)=>({id:'N'+i,date:new Date(now-i*1000).toISOString(),total:1,items:[]}));
    await POSStorage.commit(STATE,[],undefined,{changes:{sales:rows},operationIds:[],lastSale:{id:'N0'}});
    const first=await POSStorage.loadState();if(first.sales.length!==255||first.sales[0].id!=='N0'||first.sales[249].id!=='N249') return false;
    await POSStorage.commit(first,[]);const newer={id:'LATEST',date:new Date(now+60000).toISOString(),total:2,items:[]};
    await POSStorage.commit(first,[],undefined,{changes:{sales:[newer]},operationIds:[],lastSale:{id:newer.id}});
    const second=await POSStorage.loadState();return second.sales[0].id==='LATEST'&&second.sales[1].id==='N0'&&second.sales.length===256&&POSStorage.DB_VERSION===3;
   }),true);
   await page.reload();await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
   assert.equal(await page.evaluate(()=>lastLocalSale.id==='LATEST'&&$('#last-sale-receipt').dataset.saleId==='LATEST'),true);
  });
  await test('cambios remotos guardan sólo los productos afectados, sus vinculados y movimientos',async page=>{
   await seed(page);assert.deepEqual(await page.evaluate(async()=>{
    STATE.products.push({id:'ROOT',name:'Caja',stock:10,price:20,movements:[]},{id:'CHILD',name:'Unidad',parentProductId:'ROOT',subFactor:10,stock:100,price:2,movements:[]});ensureStateShape();saveLocalBackup();await persistLocalState(true);
    let archived=0;const row=STATE.sales.at(-1);row.toJSON=()=>{archived++;return {...row,toJSON:undefined};};
    mergeFromSubcollection('products',[{id:'ROOT',name:'Caja',stock:9,price:20,movements:[],updatedAt:'2030-01-01T00:00:00Z'}]);await persistLocalState(true);
    mergeFromSubcollection('stockMovements',[{id:'REMOTE-MOVE',productId:'ROOT',type:'IN',qty:1,date:new Date().toISOString()}]);await persistLocalState(true);
    const state=await POSStorage.loadState();return {archived,parent:state.products.find(p=>p.id==='ROOT').stock,child:state.products.find(p=>p.id==='CHILD').stock,movement:state.products.find(p=>p.id==='ROOT').movements.some(m=>m.id==='REMOTE-MOVE'),sales:state.sales.length};
   }),{archived:0,parent:9,child:90,movement:true,sales:100});
  });
  await test('otra modificación de la misma fila durante el guardado no se da por persistida antes de tiempo',async page=>{
   await seed(page);assert.equal(await page.evaluate(async()=>{
    mergeFromSubcollection('stockMovements',[{id:'M1',productId:'P',type:'OUT',qty:1,date:new Date().toISOString()}]);const original=POSStorage.commit;
    const started=new Promise(r=>window.rowStored=r);POSStorage.commit=async(...args)=>{await original(...args);rowStored();await new Promise(r=>window.releaseRow=r);};
    const first=persistLocalState(true);await started;mergeFromSubcollection('stockMovements',[{id:'M2',productId:'P',type:'OUT',qty:1,date:new Date().toISOString()}]);releaseRow();await first;POSStorage.commit=original;await persistLocalState(true);
    const product=(await POSStorage.loadState()).products[0];return product.movements.some(m=>m.id==='M1')&&product.movements.some(m=>m.id==='M2')&&dirtyEntityRows.size===0;
   }),true);
  });
  await test('los reportes abiertos se actualizan al vender y el comprobante se ve con un filtro histórico',async page=>{
   await seed(page);await page.evaluate(async()=>{switchTab('reports');$('#rep-from').value=todayYMD();$('#rep-to').value=todayYMD();previewReportRange();await makeTestSale();});
   await page.waitForFunction(()=>$('#report-summary').textContent.includes(STATE.sales[0].id));
   const id=await page.evaluate(async()=>{$('#rep-from').value='2020-01-01';$('#rep-to').value='2020-01-01';previewReportRange();return makeTestSale();});
   assert.equal(await page.evaluate(id=>$('#last-sale-receipt').dataset.saleId===id&&!$('#last-sale-receipt').classList.contains('hidden')&&$('#rep-from').value==='2020-01-01',id),true);
  });
  await test('respaldo alternativo confirmado no resucita operaciones viejas después de recargar',async page=>{
   await seed(page);const id=await page.evaluate(async()=>{
    addPendingOp({id:'OLD',type:'product',payload:getProductById('P'),silent:true});await persistLocalState(true);window.originalCommit=POSStorage.commit;POSStorage.commit=async()=>{throw new Error('IDB simulado no disponible');};
    const id=await makeTestSale();localStorage.setItem(WORK_MODE_KEY,'auto');db={};cloudRouteReady=true;cloudWritesReady=true;executePendingOperation=async()=>true;await processPendingOps();
    if(JSON.parse(localStorage.getItem('tienda_critical_fallback_v1')).ops.length!==0) throw new Error('Respaldo conservó operaciones retiradas');POSStorage.commit=originalCommit;return id;
   });await page.reload();await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
   assert.equal(await page.evaluate(async id=>{const state=await POSStorage.loadState();return state.sales.some(s=>s.id===id)&&pendingOps.length===0&&(await POSStorage.loadPendingOps()).length===0&&lastLocalSale.id===id;},id),true);
  });
  await test('Ver ventas conserva el control de acceso y el comprobante de otro usuario no se muestra',async page=>{
   await seed(page);await page.evaluate(()=>makeTestSale());
   await page.locator('#last-sale-receipt button').filter({hasText:'Ver ventas'}).click();
   assert.equal(await page.evaluate(()=>isModalVisible('modal-stock-auth')&&!isModalVisible('modal-gestion')),true);
   assert.equal(await page.evaluate(()=>{localStorage.setItem('auth_role','staff');localStorage.setItem('auth_user','other');localStorage.setItem('auth_staff_id','OTHER');renderLocalSaleReceipt();return $('#last-sale-receipt').classList.contains('hidden');}),true);
  });
  await test('stock cero del principal no se reconstruye desde un subproducto desactualizado al cobrar',async page=>{
   await seed(page);assert.equal(await page.evaluate(async()=>{
    STATE.products=[{id:'ROOT',name:'Caja',stock:0,price:10,movements:[]},{id:'CHILD',name:'Unidad',parentProductId:'ROOT',subFactor:10,stock:10,price:1,movements:[]}];invalidateProductIndexes();saveLocalBackup();await persistLocalState(true);
    cart=[{id:'CHILD',name:'Unidad',qty:1,price:1}];await completeSale();return STATE.sales.length===100&&getProductById('ROOT').stock===0&&!$('#last-sale-receipt').dataset.saleId;
   }),true);
  });
  await test('editar el precio obliga a guardar ese cambio y las ventas siguientes vuelven al recorrido incremental',async page=>{
   await seed(page);assert.equal(await page.evaluate(async()=>{
    await makeTestSale();getProductById('P').price=3.75;saveLocalBackup();await makeTestSale();await makeTestSale();const state=await POSStorage.loadState();return state.sales[0].total===3.75&&state.products[0].price===3.75&&state.products[0].stock===997&&state.sales.length===103&&$('#last-sale-amount').textContent==='S/ 3.75';
   }),true);
  });
  await test('la lista conserva orden por fecha y muestra la venta recién guardada aunque existan fechas futuras',async page=>{
   await seed(page);assert.equal(await page.evaluate(async()=>{
    STATE.sales.push({id:'FUTURE',date:'2099-01-01T00:00:00Z',total:1,items:[]});saveLocalBackup();getVisibleSales();
    const id=await makeTestSale();const visible=getVisibleSales();return visible[0].id==='FUTURE'&&visible[1].id===id&&$('#last-sale-receipt').dataset.saleId===id;
   }),true);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);fs.writeFileSync(path.join(out,'minute-pos-results.json'),JSON.stringify({passed:tests.length,tests,errors,externalRequests:external.length},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
