const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),label=process.argv[3]||'minute-current';
const {createServer}=require(path.join(root,'tests/server.cjs')),out=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 try{
  const report={label,cpu:6,viewport:'412x915',browser:browser.version(),scenarios:[]};
  for(const history of [10000,100000]){
   const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
   await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
   const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());
   await page.goto('http://127.0.0.1:'+server.address().port+'/tienda-smart/');await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
   await page.evaluate(async history=>{
    await POSStorage.settleWrites();POSStorage.cancelScheduled();clearTimeout(mergedStateBackupTimer);
    const now=Date.now(),date=new Date(now).toISOString();STATE={products:Array.from({length:5000},(_,i)=>({id:'P'+i,name:'Producto '+i,stock:10000,price:2,costPrice:1,barcode:String(i).padStart(13,'0'),movements:[]})),sales:Array.from({length:history},(_,i)=>({id:'H'+i,date:new Date(now-(i+1)*60000).toISOString(),total:2,paymentType:'EFECTIVO',shiftId:'HISTORY',items:[{productId:'P'+i%5000,qty:1,unitPrice:2}]})),customers:Array.from({length:500},(_,i)=>({id:'C'+i,name:'Cliente '+i,balance:0})),stockMovements:Array.from({length:history},(_,i)=>({id:'M'+i,productId:'P'+i%5000,date:new Date(now-(i+1)*60000).toISOString(),type:'OUT',qty:1})),shifts:[{id:'MINUTE',status:'OPEN',staffId:'ADMIN-LIZ',staffName:'Liz',openedAt:date,openingCash:0}],staff:[],purchases:[],suppliers:[],auditLogs:[],stockClosures:[],syncConflicts:[]};
    STATE.products[0].movements=Array.from({length:5000},(_,i)=>({id:'HOT'+i,type:'OUT',qty:1,date:new Date(now-(i+1)*60000).toISOString(),saleId:'H'+i,stockBefore:15000-i,stockAfter:14999-i}));
    pendingOps=[];ensureStateShape();activateShiftLocally('MINUTE');await persistLocalState(true);renderDashboard(true);
   },history);
   const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
   const rows=[];
   for(let i=0;i<3;i++) rows.push(await page.evaluate(async()=>{
    await POSStorage.settleWrites();POSStorage.cancelScheduled();clearTimeout(mergedStateBackupTimer);cart=[];addToCart(getProductById('P0'));payMethod='EFECTIVO';
    const phases={},originals={};for(const name of ['rebuildLinkedStocks','captureCriticalRollback','saveLocalBackup','renderCart','updateShiftUI','renderDashboard']){originals[name]=window[name];window[name]=function(...args){const t=performance.now();try{return originals[name].apply(this,args);}finally{phases[name]=(phases[name]||0)+performance.now()-t;}};}
    const commit=POSStorage.commit;POSStorage.commit=async(...args)=>{const t=performance.now();try{return await commit(...args);}finally{phases.fullCommit=(phases.fullCommit||0)+performance.now()-t;}};
    const stringify=JSON.stringify;let serializations=0;JSON.stringify=function(...args){serializations++;return stringify(...args);};
    const before=STATE.sales.length,previousCount=document.querySelector('#stat-count').textContent,previousReceipt=document.querySelector('#last-sale-receipt')?.dataset.saleId;let visible=null;const start=performance.now();
    const observer=new MutationObserver(()=>{const receipt=document.querySelector('#last-sale-receipt');if(receipt?receipt.dataset.saleId!==previousReceipt&&receipt.dataset.saleId===STATE.sales[0]?.id:document.querySelector('#stat-count').textContent!==previousCount){if(visible===null) visible=performance.now()-start;}});
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true});
    await completeSale();const commitMs=performance.now()-start;await new Promise(r=>requestAnimationFrame(()=>setTimeout(r,50)));observer.disconnect();JSON.stringify=stringify;POSStorage.commit=commit;for(const name of Object.keys(originals)) window[name]=originals[name];
    return {commitMs,visibleMs:visible,serializations,phases,salesAdded:STATE.sales.length-before,stock:getProductById('P0').stock,receipt:!!document.querySelector('#last-sale-receipt')?.dataset.saleId};
   }));
   report.scenarios.push({history,products:5000,rows,errors});fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({history,rows,errors}));await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
