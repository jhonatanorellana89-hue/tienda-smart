const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),{chromium}=require('playwright');
const artifacts=path.resolve(__dirname,'../work/test-results');fs.mkdirSync(artifacts,{recursive:true});
(async()=>{
 let version='old',runtimeRequests=0;const sw=fs.readFileSync(path.join(__dirname,'../service-worker.js'),'utf8');
 const html='<!doctype html><title>Prueba aislada de actualización</title><script src="./pos-offline.js"></script>';
 // Sin routing de Playwright: necesitamos la caché HTTP real, que routing deshabilita.
 const server=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost'),file=url.pathname;
  response.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':'text/html');
  response.setHeader('Cache-Control',file.endsWith('pos-offline.js')?'max-age=3600':'no-cache');
  if(file.endsWith('pos-offline.js')){runtimeRequests++;response.end('window.assetVersion='+JSON.stringify(version));return;}
  if(file.endsWith('service-worker.js')){response.end(sw);return;}
  response.end(file.endsWith('/')||file.endsWith('index.html')?html:'');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});
 const errors=[],external=[];
 try{
  const context=await browser.newContext({serviceWorkers:'allow'});context.on('request',request=>{if(new URL(request.url()).hostname!=='127.0.0.1') external.push(request.url());});
  const page=await context.newPage();page.on('pageerror',error=>errors.push(String(error)));
  await page.goto('http://127.0.0.1:'+server.address().port+'/tienda-smart/');assert.equal(await page.evaluate(()=>assetVersion),'old');assert.equal(runtimeRequests,1);
  version='new';await page.evaluate(async()=>{await navigator.serviceWorker.register('./service-worker.js');await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  assert.equal(await page.evaluate(async()=>await(await caches.match('./pos-offline.js')).text()),'window.assetVersion="new"');
  assert.equal(runtimeRequests,2);await context.setOffline(true);await page.reload();assert.equal(await page.evaluate(()=>assetVersion),'new');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const result={passed:1,tests:['actualización fuerza el módulo nuevo aunque el HTTP anterior siga fresco; recarga offline usa esa versión'],runtimeRequests,errors,externalRequests:external.length};
  fs.writeFileSync(path.join(artifacts,'cache-update-results.json'),JSON.stringify(result,null,2));console.log('PASS',result.tests[0]);
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
