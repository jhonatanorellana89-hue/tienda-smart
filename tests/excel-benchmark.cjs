const {chromium}=require('playwright'),fs=require('fs'),path=require('path');const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));const variant=process.argv[3]||'click-current';const artifacts=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(artifacts,{recursive:true});
const {createServer}=require(path.join(root,'tests/server.cjs'));const {fixture}=require(path.join(root,'tests/benchmark.cjs'));
(async()=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:412,height:915}});await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
 const page=await context.newPage(),cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});await page.goto(`http://127.0.0.1:${server.address().port}/tienda-smart/`);await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
 await page.evaluate(async data=>{STATE=data;ensureStateShape();await ensureXLSXLoaded();},fixture(5000));
 const download=page.waitForEvent('download');
 const result=await page.evaluate(async()=>{
  let running=true;const frames=[];const beat=t=>{frames.push(t);if(running) requestAnimationFrame(beat);};requestAnimationFrame(beat);
  await new Promise(r=>setTimeout(r,50));const started=performance.now();await exportInventoryXLSX();const total=performance.now()-started;
  await new Promise(r=>setTimeout(r,100));running=false;return {totalMs:total,maxFrameGap:Math.max(...frames.slice(1).map((t,i)=>t-frames[i])),mode:typeof excelWriteMode==='undefined'?'main':excelWriteMode};
 });await download;fs.writeFileSync(path.join(artifacts,variant+'-excel.json'),JSON.stringify(result,null,2));console.log(result);await browser.close();server.close();
})().catch(e=>{console.error(e);process.exit(1)});
