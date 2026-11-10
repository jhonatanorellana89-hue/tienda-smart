const path=require('path');
const TEST_ORIGIN=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765';
const ARTIFACTS=path.resolve(__dirname,'../work/test-results');
require('fs').mkdirSync(ARTIFACTS,{recursive:true});
const {chromium}=require('playwright');const assert=require('assert/strict');const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
 const tests=[];const errors=[];
 const context=await browser.newContext({viewport:{width:412,height:915},serviceWorkers:'allow',permissions:['camera']});
 await context.addInitScript(()=>{localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');});
 await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.type()==='confirm'?d.accept():d.dismiss());
 await page.goto(`${TEST_ORIGIN}/tienda-smart/`);await page.waitForFunction(()=>window.STATE&&document.querySelector('#search-inv').dataset.fastSearchBound==='1');
 await page.evaluate(async()=>{
   STATE.products=[{id:'TEST',name:'Café sintético',barcode:'0000000000031',stock:100,price:2,costPrice:1,movements:[]}];
   STATE.staff=[{id:'USER',name:'Personal de prueba',username:'test',active:true,passwordHash:await hashStaffSecret('test','1234')}];
   ensureStateShape();saveLocalBackup();await persistLocalState(true);
   await navigator.serviceWorker.ready;
 });
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 assert.equal(await page.evaluate(async()=>{
   const [a,b]=await Promise.all([registerPWA(),registerPWA()]);return a&&b&&(await navigator.serviceWorker.getRegistrations()).length===1;
 }),true);tests.push('una única inscripción PWA');
 await context.setOffline(true);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
 assert.equal(await page.evaluate(()=>getProductById('TEST').stock),100);tests.push('recarga completamente offline desde Service Worker e IndexedDB');
 assert.equal(await page.evaluate(()=>window.firebase===undefined&&window.XLSX===undefined&&window.jspdf===undefined&&window.Quagga===undefined),true);tests.push('módulos no esenciales no se ejecutan al iniciar offline');
 assert.equal(await page.evaluate(()=>ensureXLSXLoaded()),true);assert.equal(await page.evaluate(()=>ensurePDFLoaded()),true);tests.push('Excel y PDF cargan diferidos desde caché sin red');
 await page.evaluate(()=>{openShiftModal();});await page.waitForSelector('#shift-staff-pin');
 const shift=await page.evaluate(async()=>{
   document.querySelector('#shift-staff-id').value='USER';document.querySelector('#shift-staff-pin').value='1234';document.querySelector('#shift-opening-cash').value='10';
   await openCurrentShift();closeModal('modal-shift');return getActiveShiftForCurrentUser()?.id;
 });assert.ok(shift);tests.push('abrir turno sin conexión con PIN válido');
 await page.evaluate(()=>{cart=[];addToCart(getProductById('TEST'));});await page.evaluate(()=>completeSale());
 assert.equal(await page.evaluate(async()=>{const state=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps();return state.sales.length===1&&state.products[0].stock===99&&ops.some(op=>op.type==='sale');}),true);tests.push('venta sin conexión guardada de forma durable');
 await page.evaluate(()=>{switchTab('reports');});await page.waitForTimeout(100);
 const pdfDownload=page.waitForEvent('download');await page.evaluate(()=>downloadReportPDF());const pdf=await pdfDownload;
 const pdfPath=`${ARTIFACTS}/report-test.pdf`;await pdf.saveAs(pdfPath);assert.equal(fs.readFileSync(pdfPath).subarray(0,4).toString(),'%PDF');tests.push('PDF real con módulos locales y archivo válido');
 const excelDownload=page.waitForEvent('download');await page.evaluate(()=>exportInventoryXLSX());const excel=await excelDownload;const excelPath=`${ARTIFACTS}/report-test.xlsx`;await excel.saveAs(excelPath);assert.equal(fs.readFileSync(excelPath).subarray(0,2).toString(),'PK');tests.push('Excel real offline con archivo ZIP/XLSX válido');
 await context.setOffline(false);
 // Quagga and camera use only the synthetic Chromium video device, never a real camera.
 await page.evaluate(()=>{switchTab('home');});
 for(let i=0;i<5;i++){
  await page.evaluate(()=>window.startScanner('sale'));
  assert.equal(await page.evaluate(()=>SCANNER.running),true);
  await page.evaluate(()=>closeModal('modal-scan'));
  assert.equal(await page.evaluate(()=>SCANNER.running||!!SCANNER.stream),false);
 }
 tests.push('cinco ciclos de cámara sintética sin streams vivos después del cierre');
 await page.evaluate(()=>openShiftModal());await page.waitForSelector('#shift-actual-cash');
 await page.evaluate(async()=>{
   document.querySelector('#shift-actual-cash').value='12';document.querySelector('#shift-actual-yape').value='0';await closeCurrentShift();
 });
 assert.equal(await page.evaluate(async id=>{const state=await POSStorage.loadState();const shift=state.shifts.find(s=>s.id===id);return shift.status==='CLOSED'&&shift.cashDifference===0&&shift.salesTotal===2;},shift),true);tests.push('cierre de turno durable y conciliación exacta');
 assert.deepEqual(errors,[]);
 fs.writeFileSync(`${ARTIFACTS}/offline-results.json`,JSON.stringify({passed:tests.length,tests,errors},null,2));console.log(JSON.stringify({passed:tests.length,tests,errors}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
