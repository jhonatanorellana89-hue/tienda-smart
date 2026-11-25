const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),label=process.argv[3]||'sales-current';
const {createServer}=require(path.join(root,'tests/server.cjs')),out=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:412,height:915}});await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
  const page=await context.newPage();await page.goto('http://127.0.0.1:'+server.address().port+'/tienda-smart/');await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
  const result=await page.evaluate(async()=>{
   await POSStorage.settleWrites();clearTimeout(mergedStateBackupTimer);POSStorage.cancelScheduled();localStorage.setItem(WORK_MODE_KEY,'auto');cloudRouteReady=true;cloudWritesReady=true;
   let requests=0,count=0,newestMs=null,start=0;
   const accept=rows=>{requests++;return new Promise(resolve=>setTimeout(()=>{count+=rows.length;if(rows.some(row=>row.id==='S999')&&newestMs===null) newestMs=performance.now()-start;resolve();},10));};
   db={batch:()=>{const rows=[];return {set:(ref,payload)=>rows.push(payload),commit:()=>accept(rows)};}};subcolRef=()=>({doc:id=>({set:payload=>accept([payload])})});
   pendingOps=Array.from({length:1000},(_,i)=>({id:'OP'+i,type:'sale',payload:{id:'S'+i,date:new Date().toISOString(),total:2,items:[]},ts:new Date(i).toISOString(),silent:true}));
   start=performance.now();await processPendingOps();return {untilNewestMs:newestMs,totalMs:performance.now()-start,requests,remoteSales:count,queue:pendingOps.length,durable:(await POSStorage.loadPendingOps()).length};
  });const report={label,synthetic:true,latencyPerRequestMs:10,browser:browser.version(),...result};fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
