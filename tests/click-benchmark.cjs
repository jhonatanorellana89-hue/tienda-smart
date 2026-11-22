const {chromium}=require('playwright'),fs=require('fs');
const path=require('path');const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const variant=process.argv[3]||'click-current';const artifacts=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(artifacts,{recursive:true});const {createServer}=require(path.join(root,'tests/server.cjs'));
const {fixture}=require(path.join(root,'tests/benchmark.cjs'));
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 const report={variant,cpu:6,viewport:'412x915',browser:browser.version(),scenarios:[]};
 for(const size of [1000,5000]){
  const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
  await page.goto(`http://127.0.0.1:${server.address().port}/tienda-smart/`);await page.waitForFunction(()=>window.STATE&&document.querySelector('#search-inv').dataset.fastSearchBound==='1');
  const data=fixture(size),now=new Date().toISOString();
  data.suppliers=Array.from({length:500},(_,i)=>({id:'PROV'+i,name:'Proveedor '+i,ruc:String(i).padStart(11,'0')}));
  data.purchases=Array.from({length:1000},(_,i)=>({id:'COMP'+i,supplierId:'PROV'+i%500,supplierName:'Proveedor '+i%500,docType:'FACTURA',docNumber:'F-'+i,date:now.slice(0,10),createdAt:now,cloudMigrationQueuedAt:now,totalCost:100,items:Array.from({length:20},(_,j)=>({productId:'P'+(i+j)%size,name:'Producto '+(i+j)%size,qty:1,costPrice:1,salePrice:2}))}));
  data.auditLogs=Array.from({length:5000},(_,i)=>({id:'A'+i,ts:now,syncQueuedAt:now,action:'TEST'}));
  data.staff=Array.from({length:100},(_,i)=>({id:'U'+i,name:'Personal '+i,username:'user'+i,active:true}));
  for(let i=0;i<5000;i++){const product=data.products[i%size];product.movements.push({id:'MOV'+i,type:'MANUAL_ADJUSTMENT',qty:0,date:now,stockBefore:100,stockAfter:100,actor:'Prueba',note:'Ajuste sintético',saleId:'V'+i});}
  await page.evaluate(async state=>{await POSStorage.settleWrites();POSStorage.cancelScheduled();STATE=state;pendingOps=[];ensureStateShape();await POSStorage.commit(STATE,[]);},data);
  await page.waitForTimeout(300);
  const actions=[['export','modal-export-center','openExportCenter()'],['purchase','modal-ingreso','openIngresoModal()'],['purchases','modal-purchase-history','openPurchaseHistoryModal()'],['personnel','modal-personnel','openPersonnelModal()'],['daily','modal-daily-stock','openDailyStockControl()'],['shift','modal-shift','openShiftModal()'],['clients','modal-clients',"openModal('modal-clients')"],['gestion','modal-gestion',"openModal('modal-gestion')"],['product','modal-product','openNewProductModal()'],['sync','modal-sync-center','openSyncCenter()']];
  const metrics=[];
  for(const [name,id,code] of actions){
   for(let run=0;run<2;run++){
    const row=await page.evaluate(async({name,id,code})=>{
     const long=[];const observer=new PerformanceObserver(list=>long.push(...list.getEntries().map(e=>e.duration)));observer.observe({type:'longtask'});
     const frames=[];let active=true;const heartbeat=timestamp=>{frames.push(timestamp);if(active) requestAnimationFrame(heartbeat);};requestAnimationFrame(heartbeat);
     const started=performance.now();eval(code);const handlerMs=performance.now()-started;
     const visible=document.getElementById(id).classList.contains('visible');
     await new Promise(r=>setTimeout(r,450));active=false;observer.disconnect();closeModal(id);
     return {name,handlerMs,visible,maxFrameGap:Math.max(0,...frames.slice(1).map((time,i)=>time-frames[i])),longTasks:long};
    },{name,id,code});metrics.push({...row,run});
   }
  }
  report.scenarios.push({size,metrics,errors});fs.writeFileSync(path.join(artifacts,variant+'-clicks.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({size,metrics:metrics.filter(r=>r.handlerMs>50||r.maxFrameGap>100),errors}));await context.close();
 }
 await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1)});
