const fs=require('fs'),path=require('path'),{chromium}=require('playwright');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..')),label=process.argv[3]||'cloud-current';
const {createServer}=require(path.join(root,'tests/server.cjs'));
const artifacts=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 try{
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:412,height:915}});
  await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
  await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
  const report={label,browser:browser.version(),synthetic:true,collectionDelayMs:200,legacyDelayMs:2000,runs:[]};
  for(const run of ['first','reopen']){
   await page.goto('http://127.0.0.1:'+server.address().port+'/tienda-smart/');await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
   report.runs.push(await page.evaluate(async run=>{
    localStorage.setItem(WORK_MODE_KEY,'auto');ensureFirebaseLoaded=async()=>true;initFirebase=()=>{};let reads=0,listeners=0;
    db={collection:col=>({doc:doc=>({get:()=>{reads++;return new Promise(r=>setTimeout(()=>r({exists:false}),2000));},collection:key=>({
     limit:()=>({get:()=>{reads++;return new Promise(r=>setTimeout(()=>r({empty:col!==DB.col}),200));}}),
     onSnapshot:(options,next)=>{listeners++;queueMicrotask(()=>next({metadata:{fromCache:false},docChanges:()=>[]}));return ()=>{};}
    })})})};
    const started=performance.now();await bootstrapCloudSync();const elapsed=performance.now()-started;
    return {run,untilListenersMs:elapsed,reads,listeners};
   },run));
  }
  report.errors=errors;fs.writeFileSync(path.join(artifacts,label+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
