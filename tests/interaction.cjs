const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {chromium}=require('playwright'),{fixture}=require('./benchmark.cjs');
const reference=require('./reference-interactions.json');
const origin=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765';
const artifacts=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
 const external=[],errors=[],tests=[];
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():(external.push(r.request().url()),r.abort()));
 await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());
 const test=async(name,action)=>{await action();tests.push(name);console.log('PASS',name);};
 try{
  await page.goto(origin+'/tienda-smart/');await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
  await page.evaluate(async data=>{await POSStorage.settleWrites();POSStorage.cancelScheduled();STATE=data;pendingOps=[];ensureStateShape();await POSStorage.commit(STATE,[]);},fixture(120));
  await test('productos vendidos mantienen resultados originales, vinculados, eliminados y redondeos',async()=>{
   const result=await page.evaluate(code=>{
    STATE.products.push({id:'ROOT',name:'Caja',price:20,stock:2.5,movements:[]},{id:'CHILD',name:'Unidad',price:2,stock:30,parentProductId:'ROOT',subFactor:12,movements:[]},{id:'DEL',name:'Eliminado',deleted:true,stock:0,movements:[]});
    STATE.sales.push({id:'EDGE',date:new Date().toISOString(),responsible:'Persona A',items:[{productId:'CHILD',qty:1.333,unitPrice:0.105},{productId:'DEL',qty:2,unitPrice:1.01},{productId:'MISSING',rawName:'Nombre histórico',qty:1,unitPrice:0.01}]});
    ensureStateShape();const old=eval('('+code+')');return {old:old(todayYMD(),todayYMD()),now:buildSoldProductsForRange(todayYMD(),todayYMD())};
   },reference.buildSoldProductsForRange);assert.deepEqual(result.now,result.old);
  });
  await test('facturas y resúmenes conservan totales y subproductos del algoritmo original',async()=>{
   const rows=[{id:'OLD',supplier:'Proveedor antiguo',createdAt:'2026-01-01T12:00:00Z',items:[{qty:'3',costPrice:'1.25',subtotal:0,stockBefore:0,subName:'Unidad',subFactor:'12'},{qty:2,costPrice:0,subtotal:'0',subProducts:[{subName:'Bolsa',subFactor:2,subQty:4}]}]}, {id:'FIXED',date:'2026-01-02',totalCost:'12.34',items:[{qty:'2',costPrice:'3',subtotal:'invalid'}]}, {id:'EMPTY',items:[]}];
   const result=await page.evaluate(({code,rows})=>{
    const old=eval('('+code+')');return rows.map(raw=>({old:old(raw),now:normalizePurchaseForView(raw),summary:normalizePurchaseForView(raw,true)}));
   },{code:reference.normalizePurchaseForView,rows});
   for(const row of result){assert.deepEqual(row.now,row.old);assert.equal(row.summary.totalCost,row.old.totalCost);assert.equal(row.summary.itemCount,row.old.items.length);assert.deepEqual(row.summary.items,[]);}
  });
  await test('ediciones guardadas y reemplazos invalidan vistas; factura seleccionada conserva sus líneas',async()=>{
   assert.deepEqual(await page.evaluate(()=>{
    STATE.purchases=[{id:'ONE',date:todayYMD(),items:[{productId:'P0',qty:2,costPrice:3}]}];ensureStateShape();
    const before=getPurchaseSummaries()[0].totalCost;STATE.purchases[0].items[0].qty=4;saveLocalBackup();
    const after=getPurchaseSummaries()[0].totalCost;purchaseHistorySelectedId='ONE';const lines=getSelectedPurchaseFromHistory().items.length;
    STATE.purchases[0]={id:'REPLACED'};ensureStateShape();const normalized=Array.isArray(STATE.purchases[0].items);const id=getPurchaseSummaries()[0].id;
    return {before,after,lines,normalized,id};
   }),{before:6,after:12,lines:1,normalized:true,id:'REPLACED'});
  });
  await test('Exportar abre inmediatamente y cancela el cálculo al cerrar',async()=>{
   assert.deepEqual(await page.evaluate(async()=>{
    const original=renderExportCenterPreview;let calls=0;renderExportCenterPreview=()=>calls++;
    openExportCenter();const visible=isModalVisible('modal-export-center'),loading=$('#export-center-summary').textContent;
    closeModal('modal-export-center');await new Promise(r=>setTimeout(r,80));renderExportCenterPreview=original;
    return {visible,loading,calls,tasks:$('#modal-export-center')._tasks.size};
   }),{visible:true,loading:'Calculando vista previa...',calls:0,tasks:0});
  });
  await test('vista previa paginada permite recorrer todos los productos vendidos',async()=>{
   await page.evaluate(()=>openExportCenter());await page.waitForFunction(()=>$('#export-products-preview tbody')&&!$('#export-products-preview tbody').hasAttribute('aria-busy'));
   const first=await page.locator('#export-products-preview tbody tr').count();assert.equal(first,80);
   const last=await page.evaluate(()=>{exportPreviewPage=1;renderExportCenterPreview();return $('#export-products-preview tbody').children.length;});
   assert.equal(last,43);await page.evaluate(()=>closeModal('modal-export-center'));
  });
  await test('filas progresivas cancelan tareas; conteos tardíos y caja se conservan al reabrir',async()=>{
   assert.deepEqual(await page.evaluate(()=>{
    openModal('modal-daily-stock');renderDailyStockControl();renderDailyStockTable(true);const initial=$$('[data-daily-count]').length;
    closeModal('modal-daily-stock');return {initial,tasks:$('#modal-daily-stock')._tasks.size};
   }),{initial:10,tasks:0});
   await page.evaluate(()=>openDailyStockControl());await page.waitForFunction(()=>$('#daily-stock-table tbody')&&!$('#daily-stock-table tbody').hasAttribute('aria-busy'));
   const id=await page.evaluate(()=>{
    const input=$$('[data-daily-count]')[60];input.value='7.5';input.dispatchEvent(new Event('input',{bubbles:true}));$('#daily-actual-cash').value='23.45';
    const id=input.dataset.dailyCount;if(dailyPhysicalDraft.get(id)!==7.5) throw new Error('La fila tardía no recibió el conteo');window.testDailyPreviousBody=$('#daily-stock-table tbody');closeModal('modal-daily-stock');openDailyStockControl();return id;
   });
   await page.waitForFunction(()=>$('#daily-stock-table tbody')!==testDailyPreviousBody&&!$('#daily-stock-table tbody').hasAttribute('aria-busy'));
   assert.deepEqual(await page.evaluate(id=>({physical:dailyPhysicalDraft.get(id),cash:$('#daily-actual-cash').value,count:$$('[data-daily-count]').length}),id),{physical:7.5,cash:'23.45',count:80});
   await page.evaluate(()=>closeModal('modal-daily-stock'));
  });
  await test('personal paginado conserva todos los usuarios y su turno abierto',async()=>{
   assert.deepEqual(await page.evaluate(()=>{
    STATE.staff=Array.from({length:91},(_,i)=>({id:'STAFF'+i,name:'Persona '+String(i).padStart(3,'0'),username:'user'+i,active:true}));
    STATE.shifts.push({id:'OPEN-90',staffId:'STAFF90',status:'OPEN',openedAt:new Date().toISOString()});ensureStateShape();personnelPage=0;renderPersonnelList();
    const first=$$('#personnel-list .staff-row').length;personnelPage=2;renderPersonnelList();return {first,last:$$('#personnel-list .staff-row').length,open:$('#personnel-list').textContent.includes('user90 · Turno abierto')};
   }),{first:40,last:11,open:true});
  });
  await test('venta vinculada responde Guardando, evita doble cobro y persiste stock exacto',async()=>{
   const result=await page.evaluate(async()=>{
    const shift={id:'ADMIN-TEST',staffId:'ADMIN-LIZ',staffName:'Liz',status:'OPEN',openedAt:new Date().toISOString(),openingCash:0};STATE.shifts.push(shift);activateShiftLocally(shift.id);
    cart=[];addToCart(getProductById('ROOT'));addToCart(getProductById('CHILD'));setQty(1,6);payMethod='EFECTIVO';
    const button=$('#modal-sale button[onclick="completeSale()"]'),text=button.textContent,count=STATE.sales.length;
    const first=completeSale();const busy=button.disabled&&button.textContent==='Guardando venta...'&&button.getAttribute('aria-busy')==='true';await Promise.all([first,completeSale()]);
    const state=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps();return {busy,sales:state.sales.length-count,parent:state.products.find(p=>p.id==='ROOT').stock,child:state.products.find(p=>p.id==='CHILD').stock,total:state.sales[0].total,restored:button.textContent===text&&!button.disabled,queued:ops.some(op=>op.type==='sale'&&op.payload.id===state.sales[0].id)};
   });assert.deepEqual(result,{busy:true,sales:1,parent:1,child:12,total:32,restored:true,queued:true});
  });
  await page.evaluate(async()=>{STATE.purchases=[];STATE.staff=[];STATE.shifts=[];STATE.auditLogs=[];STATE.stockMovements=[];STATE.sales=STATE.sales.slice(0,3);saveLocalBackup();await ensureXLSXLoaded(true,true);});
  // Ambos archivos deben representar el mismo instante, incluso al cruzar un segundo.
  await page.clock.setFixedTime(new Date());
  const exports=['exportInventoryXLSX','exportSalesXLSX','exportCombinedXLSX','exportStockHistoryXLSX','exportDailyStockXLSX'];
  const workbook=async(name,worker)=>{
   await page.evaluate(useWorker=>{if(!window.testOriginalWorker) window.testOriginalWorker=Worker;window.Worker=useWorker?testOriginalWorker:undefined;},worker);
   const downloaded=page.waitForEvent('download');assert.equal(await page.evaluate(name=>window[name](),name),true);
   const file=await downloaded,output=path.join(artifacts,(worker?'worker-':'compatible-')+name+'.xlsx');await file.saveAs(output);
   return page.evaluate(bytes=>{const wb=XLSX.read(new Uint8Array(bytes),{type:'array'});return {mode:excelWriteMode,names:wb.SheetNames,sheets:wb.SheetNames.map(name=>XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1,defval:null}))};},[...fs.readFileSync(output)]);
  };
  for(const name of exports) await test(name+': Excel en segundo plano coincide con el exportador compatible',async()=>{
   const threaded=await workbook(name,true),compatible=await workbook(name,false);assert.equal(threaded.mode,'worker');assert.equal(compatible.mode,'main-fallback');assert.deepEqual(threaded.names,compatible.names);assert.deepEqual(threaded.sheets,compatible.sheets);assert.ok(threaded.names.length>0);
  });
  await test('doble clic en Excel genera un solo archivo y restaura el botón',async()=>{
   await page.evaluate(()=>window.Worker=testOriginalWorker);const downloads=[];const track=d=>downloads.push(d);page.on('download',track);
   const result=await page.evaluate(async()=>{
    const button=document.createElement('button');button.textContent='Excel';button.setAttribute('onclick','exportInventoryXLSX()');document.body.appendChild(button);button.focus();
    const first=exportInventoryXLSX(),busy=button.disabled&&button.textContent==='Preparando Excel...';const same=first===exportInventoryXLSX();await first;
    const restored=!button.disabled&&button.textContent==='Excel';button.remove();return {busy,same,restored};
   });await page.waitForTimeout(150);page.off('download',track);assert.deepEqual(result,{busy:true,same:true,restored:true});assert.equal(downloads.length,1);
  });
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  fs.writeFileSync(path.join(artifacts,'interaction-results.json'),JSON.stringify({passed:tests.length,tests,errors,externalRequests:external.length},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
