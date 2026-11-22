const path=require('path');
const TEST_ORIGIN=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765';
const ARTIFACTS=path.resolve(__dirname,'../work/test-results');
require('fs').mkdirSync(ARTIFACTS,{recursive:true});
const {chromium} = require('playwright');
const fs = require('fs');
const target = process.argv[2] || 'tienda-smart';
const outputName=process.argv[3]||target;
const fixture = (n) => {
  const now = new Date().toISOString();
  return {
    products:Array.from({length:n},(_,i)=>({id:`P${i}`,name:`Producto café ${i}`,category:`Categoria ${i%20}`,barcode:String(i).padStart(13,'0'),stock:100,price:2,costPrice:1,createdAt:now,movements:[]})),
    sales:Array.from({length:10000},(_,i)=>({id:`V${i}`,date:now,total:2,shiftId:`T${i%40}`,paymentType:'EFECTIVO',items:[{productId:`P${i%n}`,qty:1,unitPrice:2}]})),
    customers:Array.from({length:500},(_,i)=>({id:`C${i}`,name:`Cliente ${i}`,balance:i})),
    stockMovements:Array.from({length:5000},(_,i)=>({id:`M${i}`,productId:`P${i%n}`,qty:1,type:'OUT',date:now})),
    staff:Array.from({length:10},(_,i)=>({id:`U${i}`,name:`Persona ${i}`,username:`persona${i}`,active:true})),
    shifts:Array.from({length:40},(_,i)=>({id:`T${i}`,staffId:`U${i%10}`,staffName:`Persona ${i%10}`,status:'CLOSED',openedAt:now,closedAt:now,openingCash:10})),
    purchases:[],suppliers:[],auditLogs:[],stockClosures:[],syncConflicts:[]
  };
};
module.exports={fixture};
if(require.main===module)(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 const results={target,cpuSlowdown:4,scenarios:[]};
 for(const size of [100,1000,5000]){
  const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'block'});
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.addInitScript(()=>{
   window.testLongTasks=[];
   new PerformanceObserver(list=>window.testLongTasks.push(...list.getEntries().map(x=>x.duration))).observe({type:'longtask',buffered:true});
   localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');
  });
  await page.goto(`${TEST_ORIGIN}/${target}/`,{waitUntil:'load'});
  await page.waitForFunction(()=>window.STATE && document.querySelector('#search-inv')?.dataset.fastSearchBound==='1');
  await page.evaluate(async state=>{
   STATE=state;cart=[];ensureStateShape();pendingOps=[];
   await POSStorage.saveState(STATE);await POSStorage.savePendingOps([]);localStorage.removeItem(LOCAL_BACKUP_KEY);
  },fixture(size));
  await page.reload({waitUntil:'load'});
  await page.waitForFunction(()=>document.querySelector('#search-inv')?.dataset.fastSearchBound==='1');
  const metrics=await page.evaluate(async()=>{
   const sync=(fn)=>{const t=performance.now();fn();return performance.now()-t;};
   const frame=()=>new Promise(r=>requestAnimationFrame(()=>setTimeout(r,0)));
   const result={startupMs:performance.now(),resourceBytes:performance.getEntriesByType('resource').reduce((a,x)=>a+x.decodedBodySize,0)};
   document.querySelector('#tab-home').classList.add('hidden');document.querySelector('#tab-inventory').classList.remove('hidden');
   result.inventoryMs=sync(()=>renderInventoryList());await frame();await frame();
   result.inventoryNodes=document.querySelector('#inventory-list').querySelectorAll('*').length;
   result.searchMs=[];for(let i=0;i<7;i++)result.searchMs.push(sync(()=>getPosMatches('pcf42')));
   result.stringifyMs=sync(()=>JSON.stringify(STATE));result.backupScheduleMs=sync(()=>saveLocalBackup());
   await new Promise(r=>setTimeout(r,600));
   const started=performance.now();await POSStorage.flushState(STATE);result.flushMs=performance.now()-started;
   result.modalMs=[];for(let i=0;i<10;i++){const t=performance.now();openModal('modal-sync-center');await frame();result.modalMs.push(performance.now()-t);closeModal('modal-sync-center');}
   result.shiftRenderMs=sync(()=>renderShiftModal());
   result.longTasks=window.testLongTasks;result.memory=performance.memory?.usedJSHeapSize;
   return result;
  });
  results.scenarios.push({size,...metrics,errors});fs.writeFileSync(`${ARTIFACTS}/${outputName}-metrics.json`,JSON.stringify(results,null,2));
  console.log(JSON.stringify({size,...metrics,errors}));await context.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
