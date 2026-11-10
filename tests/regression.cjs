const path=require('path');
const TEST_ORIGIN=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765';
const ARTIFACTS=path.resolve(__dirname,'../work/test-results');
require('fs').mkdirSync(ARTIFACTS,{recursive:true});
const {chromium}=require('playwright');
const assert=require('assert/strict');
const fs=require('fs');
const {fixture}=require('./benchmark.cjs');
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block',permissions:['camera']});
 const external=[];
 await context.route('**/*',route=>{if(new URL(route.request().url()).hostname==='127.0.0.1') return route.continue();external.push(route.request().url());return route.abort();});
 const page=await context.newPage(),errors=[],tests=[];
 page.on('pageerror',e=>errors.push(String(e)));
 page.on('dialog',dialog=>dialog.type()==='confirm'?dialog.accept():dialog.dismiss());
 await page.addInitScript(()=>{
   localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');
   window.viewportListeners=new Set();const add=visualViewport.addEventListener.bind(visualViewport),remove=visualViewport.removeEventListener.bind(visualViewport);
   visualViewport.addEventListener=(type,fn,...args)=>{if(type==='resize'||type==='scroll') viewportListeners.add(fn);return add(type,fn,...args);};
   visualViewport.removeEventListener=(type,fn,...args)=>{viewportListeners.delete(fn);return remove(type,fn,...args);};
 });
 const base=`${TEST_ORIGIN}/tienda-smart/`;
 await page.goto(base);await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
 async function test(name,fn){await fn();tests.push(name);console.log('PASS',name);}
 await test('diagnóstico desactivado por defecto',async()=>assert.equal(await page.evaluate(()=>!!window.TiendaPerf),false));
 await page.evaluate(async data=>{STATE=data;pendingOps=[];ensureStateShape();await POSStorage.commit(STATE,pendingOps);},fixture(1000));
 await test('50 aperturas/cierres, reaperturas y tareas canceladas',async()=>{
   const result=await page.evaluate(()=>{
    for(let i=0;i<50;i++){openModal('modal-sync-center');openModal('modal-sync-center');closeModal('modal-sync-center');}
    openModal('modal-clients');closeModal('modal-clients');
    return {listeners:viewportListeners.size,tasks:document.querySelector('#modal-clients')._tasks.size};
   });assert.deepEqual(result,{listeners:0,tasks:0});
 });
 await test('búsqueda flexible idéntica al algoritmo original',async()=>{
   const original=fs.readFileSync(require('path').join(__dirname,'reference-search.js'),'utf8');
   const start=original.indexOf('function getPosMatches('),end=original.indexOf('\n}',start)+2;
   const result=await page.evaluate(code=>{
     const old=eval('('+code+')');
     return ['cafe','pcf42','CÁFÉ','categoria12','0000000000003','0003','Prdct','zzz',' ','P 2'].map(q=>({q,old:old(q).map(p=>p.id),now:getPosMatches(q).map(p=>p.id)}));
   },original.slice(start,end));result.forEach(r=>assert.deepEqual(r.now,r.old,r.q));
 });
 await test('inventario acotado, paginación, actualización e índice invalidado',async()=>{
   const result=await page.evaluate(()=>{
     switchTab('inventory');renderInventoryList();const first=document.querySelector('#inventory-list').firstElementChild;
     const initial=document.querySelectorAll('#inventory-list .card').length;renderInventoryList();const reused=first===document.querySelector('#inventory-list').firstElementChild;
     getProductById('P0').price=7;saveLocalBackup();renderInventoryList();
     const updated=document.querySelector('#inventory-list').firstElementChild.textContent.includes('7.00');
     inventoryPage=12;renderInventoryList();return {initial,reused,updated,last:document.querySelectorAll('#inventory-list .card').length};
   });assert.deepEqual(result,{initial:80,reused:true,updated:true,last:40});
 });
 await test('carrito mantiene el campo enfocado al cambiar cantidad',async()=>{
   assert.equal(await page.evaluate(()=>{cart=[];addToCart(getProductById('P1'));const input=document.querySelector('#pos-cart input');input.focus();setQty(0,4);return document.querySelector('#pos-cart input')===input&&input.value==='4';}),true);
 });
 await test('productos vinculados conservan cantidades y redondeos',async()=>{
   const result=await page.evaluate(()=>{
    STATE.products.push({id:'PADRE',name:'Caja',stock:2.5,price:20,movements:[]},{id:'HIJO',name:'Unidad',parentProductId:'PADRE',subFactor:12,stock:30,price:2,movements:[]});
    rebuildLinkedStocks();const before=getAvailableQtyForSale('HIJO');
    const op=adjustStockForSaleItem('HIJO',7,'OUT','PRUEBA');const after=getAvailableQtyForSale('HIJO'),parent=getProductById('PADRE').stock;
    adjustStockForSaleItem('HIJO',-7,'ROLLBACK','PRUEBA');return {before,after,parent,restored:getProductById('PADRE').stock,ok:op.ok};
   });assert.deepEqual(result,{before:30,after:23,parent:1.916667,restored:2.5,ok:true});
 });
 await test('turno inmediato y actualización conserva PIN y fondo escritos',async()=>{
   await page.evaluate(()=>openShiftModal());await page.waitForSelector('#shift-staff-pin',{state:'attached'});
   const result=await page.evaluate(()=>{document.querySelector('#shift-staff-pin').value='1234';document.querySelector('#shift-opening-cash').value='35.50';renderShiftModal();return [document.querySelector('#shift-staff-pin').value,document.querySelector('#shift-opening-cash').value];});assert.deepEqual(result,['1234','35.50']);
   await page.evaluate(()=>closeModal('modal-shift'));
 });
 await test('PIN inválido no abre turno; PIN válido funciona localmente',async()=>{
   await page.evaluate(async()=>{
    const person=STATE.staff[0];person.passwordHash=await hashStaffSecret(person.username,'1234');
    openShiftModal();
   });await page.waitForSelector('#shift-staff-pin',{state:'attached'});
   const result=await page.evaluate(async()=>{
    document.querySelector('#shift-staff-id').value='U0';document.querySelector('#shift-staff-pin').value='9999';await openCurrentShift();const bad=!!getActiveShiftForCurrentUser();
    document.querySelector('#shift-staff-pin').value='1234';document.querySelector('#shift-opening-cash').value='10';await openCurrentShift();return {bad,good:!!getActiveShiftForCurrentUser()};
   });assert.deepEqual(result,{bad:false,good:true});
   await page.evaluate(()=>closeModal('modal-shift'));
 });
 await test('escáner físico conserva ceros y agrega sólo una unidad por lectura',async()=>{
   await page.evaluate(()=>{cart=[];getProductById('P3').barcode='0000000000031';saveLocalBackup();openModal('modal-sale');});await page.waitForTimeout(60);
   await page.locator('#pos-search').focus();await page.keyboard.type('0000000000031',{delay:2});await page.keyboard.press('Enter');
   assert.deepEqual(await page.evaluate(()=>cart.map(x=>({id:x.id,qty:x.qty}))),[{id:'P3',qty:1}]);
 });
 await test('venta offline durable antes del éxito, doble envío y recarga de cola',async()=>{
   const result=await page.evaluate(async()=>{
    cart=[];addToCart(getProductById('P1'));const stock=getProductById('P1').stock,count=STATE.sales.length;
    await Promise.all([completeSale(),completeSale()]);const state=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps();
    return {sales:state.sales.length-count,stock:state.products.find(p=>p.id==='P1').stock,expected:stock-1,queued:ops.some(op=>op.type==='sale'&&op.payload.id===state.sales[0].id),id:state.sales[0].id};
   });assert.equal(result.sales,1);assert.equal(result.stock,result.expected);assert.equal(result.queued,true);
   await page.reload();await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
   assert.equal(await page.evaluate(id=>pendingOps.some(op=>op.type==='sale'&&op.payload.id===id),result.id),true);
 });
 await test('error de ambos almacenes revierte venta y mantiene carrito',async()=>{
   const result=await page.evaluate(async()=>{
    const originalCommit=POSStorage.commit,originalSet=Storage.prototype.setItem;
    POSStorage.commit=async()=>{throw new Error('Disco simulado lleno');};Storage.prototype.setItem=function(key,value){if(key==='tienda_critical_fallback_v1') throw new DOMException('QuotaExceededError','QuotaExceededError');return originalSet.call(this,key,value);};
    cart=[];addToCart(getProductById('P2'));const stock=getProductById('P2').stock,count=STATE.sales.length;await completeSale();
    POSStorage.commit=originalCommit;Storage.prototype.setItem=originalSet;
    return {sales:STATE.sales.length-count,stock:getProductById('P2').stock,expected:stock,cart:cart.length};
   });assert.equal(result.sales,0);assert.equal(result.stock,result.expected);assert.equal(result.cart,1);
 });
 await test('registro de producto rechaza doble envío y espera persistencia',async()=>{
   const before=await page.evaluate(()=>STATE.products.length);
   await page.evaluate(()=>{openNewProductModal('Producto de prueba','TEST1234');document.querySelector('#p-stock').value='2';document.querySelector('#p-price').value='3';const form=document.querySelector('#form-p');form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));});
   await page.waitForFunction(()=>!productSubmitInProgress);
   assert.equal(await page.evaluate(async()=>{const state=await POSStorage.loadState();return state.products.filter(p=>p.barcode==='TEST1234').length;}),1);
   assert.equal(await page.evaluate(()=>STATE.products.length),before+1);
 });
 await test('registro de cliente no duplica saldo por doble envío',async()=>{
   await page.evaluate(()=>{document.querySelector('#client-name').value='Cliente sintético nuevo';document.querySelector('#client-initial').value='5';const form=document.querySelector('#form-client');form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));});
   await page.waitForFunction(()=>!clientSubmitInProgress);
   assert.deepEqual(await page.evaluate(async()=>{const state=await POSStorage.loadState();return state.customers.filter(c=>c.name==='Cliente sintético nuevo').map(c=>c.balance);}),[5]);
 });
 await test('registro de personal con hash y doble envío produce un solo usuario',async()=>{
   await page.evaluate(()=>{document.querySelector('#staff-name').value='Persona sintética nueva';document.querySelector('#staff-username').value='sintetico';document.querySelector('#staff-pin').value='1234';const form=document.querySelector('#form-staff');form.dispatchEvent(new Event('submit',{cancelable:true}));form.dispatchEvent(new Event('submit',{cancelable:true}));});
   await page.waitForFunction(()=>!staffSubmitInProgress);
   const result=await page.evaluate(async()=>{const state=await POSStorage.loadState();const staff=state.staff.filter(p=>p.username==='sintetico');return {count:staff.length,valid:await verifyStaffSecret(staff[0],'1234')};});assert.deepEqual(result,{count:1,valid:true});
 });
 await test('cola inmutable y protección de cambios locales frente a snapshots',async()=>{
   const result=await page.evaluate(()=>{
    pendingOps=[];const product=getProductById('P5');product.updatedAt='2030-01-01T00:00:00Z';addPendingOp({id:'TEST-P5',type:'product',payload:product,silent:true});const queued=pendingOps[0].payload.stock;product.stock=66;saveLocalBackup();
    mergeFromSubcollection('products',[{...product,stock:1,updatedAt:'2031-01-01T00:00:00Z'}]);return {queued,current:getProductById('P5').stock,queueCount:pendingOps.length};
   });assert.deepEqual(result,{queued:100,current:66,queueCount:1});
 });
 await test('una suscripción por colección; eventos no confirman ni borran cola',async()=>{
   const result=await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');db={};resolveDbCollectionName=async()=>{};migrateOldDataToSubcollections=async()=>{};
    window.fakeSnapshots={};window.fakeSubscriptions={};subcolRef=name=>({onSnapshot:(options,next,error)=>{fakeSnapshots[name]={next,error};fakeSubscriptions[name]=(fakeSubscriptions[name]||0)+1;return ()=>{};}});
    executePendingOperation=async()=>{throw Object.assign(new Error('offline simulado'),{code:'unavailable'});};
    await Promise.all([bootstrapCloudSync(),bootstrapCloudSync(),bootstrapCloudSync()]);await new Promise(r=>setTimeout(r,40));
    const before=localStorage.getItem(LAST_SYNC_KEY);fakeSnapshots.products.next({docChanges:()=>[{type:'modified',doc:{id:'P8',data:()=>({id:'P8',name:'Actualizado',stock:12,price:2,updatedAt:'2032-01-01'})}}]});
    await new Promise(r=>setTimeout(r,80));
    return {counts:Object.values(fakeSubscriptions),queue:pendingOps.length,before,after:localStorage.getItem(LAST_SYNC_KEY),stock:getProductById('P8').stock};
   });assert.equal(result.counts.length,11);assert.equal(result.counts.every(n=>n===1),true);assert.equal(result.queue,1);assert.equal(result.before,result.after);assert.equal(result.stock,12);
 });
 await test('reintentos respetan espera y confirmación explícita elimina cola',async()=>{
   const result=await page.evaluate(async()=>{
    let calls=0;executePendingOperation=async()=>{calls++;return true;};await processPendingOps();const waiting=calls;
    pendingOps.forEach(op=>op.nextAttemptAt=null);await processPendingOps();const stored=await POSStorage.loadPendingOps();
    stopCloudListeners();localStorage.setItem(WORK_MODE_KEY,'local');db=null;
    return {waiting,calls,remaining:pendingOps.length,stored:stored.length};
   });assert.deepEqual(result,{waiting:0,calls:1,remaining:0,stored:0});
 });
 await test('un reintento antiguo no adelanta escrituras posteriores de la misma entidad',async()=>{
   const result=await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');db={};pendingOps=[];
    const future=new Date(Date.now()+60000).toISOString();
    pendingOps.push({id:'old',type:'product',payload:{id:'ORDER'},nextAttemptAt:future},{id:'new',type:'product',payload:{id:'ORDER'}},{id:'other',type:'product',payload:{id:'OTHER'}});
    const sent=[];executePendingOperation=async op=>{sent.push(op.id);return true;};await processPendingOps();
    const result={sent,pending:pendingOps.map(op=>op.id)};pendingOps=[];await POSStorage.savePendingOps([]);localStorage.setItem(WORK_MODE_KEY,'local');db=null;return result;
   });assert.deepEqual(result,{sent:['other'],pending:['old','new']});
 });
 await test('cinco ventas consecutivas mantienen stock, historial y cola',async()=>{
   const result=await page.evaluate(async()=>{
    const before=STATE.sales.length,stock=getProductById('P9').stock;
    for(let i=0;i<5;i++){cart=[];addToCart(getProductById('P9'));await completeSale();}
    const data=await POSStorage.loadState();return {count:data.sales.length-before,delta:stock-data.products.find(p=>p.id==='P9').stock,unique:new Set(data.sales.map(s=>s.id)).size===data.sales.length};
   });assert.deepEqual(result,{count:5,delta:5,unique:true});
 });
 await test('compra offline, doble envío y stock guardados en una transacción',async()=>{
   await page.evaluate(()=>{
    STATE.suppliers.push({id:'PROV-TEST',name:'Proveedor sintético',ruc:'12345678901'});renderIngresoSupplierOptions('PROV-TEST');
    document.querySelector('#ing-supplier-id').value='PROV-TEST';document.querySelector('#ing-doc-type').value='FACTURA';document.querySelector('#ing-doc-number').value='F001-PRUEBA';document.querySelector('#ing-date').value=todayYMD();
    ingresoDraftItems=[{productId:'P10',name:'Producto',qty:3,costPrice:1,salePrice:2,subProducts:[]}];
    window.purchaseBefore={stock:getProductById('P10').stock,count:STATE.purchases.length};
    const form=document.querySelector('#form-ingreso');form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   });
   await page.waitForFunction(()=>!purchaseSubmitInProgress);
   const result=await page.evaluate(async()=>{const state=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps();return {delta:state.products.find(p=>p.id==='P10').stock-purchaseBefore.stock,count:state.purchases.length-purchaseBefore.count,queued:ops.some(op=>op.type==='purchaseBundle'&&op.payload.purchase.docNumber==='F001-PRUEBA')};});
   assert.deepEqual(result,{delta:3,count:1,queued:true});
 });
 await test('previsualización de reportes y conteos diarios no trunca datos guardados',async()=>{
   const result=await page.evaluate(()=>{
    switchTab('reports');renderReportSummary(todayYMD(),todayYMD());
    const count=document.querySelectorAll('#report-summary tbody tr').length;
    const total=generateReportData(todayYMD(),todayYMD()).totalOps;
    document.querySelector('#daily-stock-date').value=todayYMD();renderDailyStockControl();
    const first=dailyStockRows[0];updateDailyPhysicalCount(first.productId,'55');dailyStockPage=1;renderDailyStockTable();dailyStockPage=0;renderDailyStockTable();
    return {count,total,expected:STATE.sales.filter(s=>!s.deleted&&isSameLocalDay(s.date)).length,dailyRows:dailyStockRows.length,inputs:document.querySelectorAll('[data-daily-count]').length,restored:document.querySelector('[data-daily-count]').value};
   });assert.ok(result.count<=160);assert.equal(result.total,result.expected);assert.ok(result.dailyRows>80);assert.equal(result.inputs,80);assert.equal(result.restored,'55');
 });
 await test('inicio local no espera a Firebase bloqueado',async()=>{
   const result=await page.evaluate(async()=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');bootstrapCloudSync=()=>new Promise(()=>{});appStarted=false;
    await Promise.race([startApp(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('El inicio esperó a Firebase')),200))]);
    localStorage.setItem(WORK_MODE_KEY,'local');return document.querySelector('#pos-search').dataset.bound;
   });assert.equal(result,'1');
 });
 await test('exportación Excel con carga diferida local',async()=>{
   const download=page.waitForEvent('download');await page.evaluate(()=>exportInventoryXLSX());const file=await download;assert.ok(file.suggestedFilename().endsWith('.xlsx'));assert.equal(await page.evaluate(()=>!!window.XLSX),true);
 });
 await test('lector libera stream al cerrar durante inicio',async()=>{
   await page.evaluate(()=>{window.startScanner('sale');closeModal('modal-scan');});await page.waitForTimeout(800);
   assert.equal(await page.evaluate(()=>SCANNER.running),false);
   assert.equal(await page.evaluate(()=>!!SCANNER.stream?.getTracks().some(track=>track.readyState==='live')),false);
 });
 await test('diagnóstico recoge métricas sólo al habilitarlo',async()=>{
   await page.goto(base+'?diagnostics=1');await page.waitForFunction(()=>window.TiendaPerf&&document.querySelector('#search-inv').dataset.fastSearchBound==='1');
   const data=await page.evaluate(()=>{getPosMatches('cafe');return TiendaPerf.report();});assert.equal(data.counts.getPosMatches,1);assert.ok(data.samples.some(s=>s.name==='startup.controlsReady'));
 });
 assert.deepEqual(errors,[]);assert.equal(external.length,0);
 fs.writeFileSync(`${ARTIFACTS}/regression-results.json`,JSON.stringify({passed:tests.length,tests,errors,externalRequests:external.length},null,2));
 await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
