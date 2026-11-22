const path=require('path');
const TEST_ORIGIN=process.env.TIENDA_TEST_ORIGIN||'http://127.0.0.1:8765';
const ARTIFACTS=path.resolve(__dirname,'../work/test-results');
require('fs').mkdirSync(ARTIFACTS,{recursive:true});
const {chromium}=require('playwright');const assert=require('assert/strict');const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({...require('./browser-options.cjs'),args:['--no-sandbox']});const tests=[],errors=[];
 const context=await browser.newContext({serviceWorkers:'block'});await context.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());
 await page.goto(`${TEST_ORIGIN}/`);
 await page.evaluate(async()=>{
  const state={products:[{id:'P',name:'Prueba',stock:100,price:2,movements:[]}],sales:[],customers:[],staff:[],shifts:[],purchases:[],suppliers:[],auditLogs:[],stockMovements:[],stockClosures:[],syncConflicts:[]};
  const db=await new Promise((resolve,reject)=>{
    const req=indexedDB.open('TiendaSmartOffline',3);
    req.onupgradeneeded=()=>{['meta','snapshots'].forEach(name=>req.result.createObjectStore(name,{keyPath:'key'}));['pendingOps',...Object.keys(state)].forEach(name=>req.result.createObjectStore(name,{keyPath:'id'}));};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
  const tx=db.transaction(['snapshots','products','pendingOps'],'readwrite');tx.objectStore('snapshots').put({key:'current',value:state,savedAt:'2020-01-01'});tx.objectStore('products').put(state.products[0]);tx.objectStore('pendingOps').put({id:'LEGACY',type:'product',payload:state.products[0],ts:'2020-01-01'});
  await new Promise((r,j)=>{tx.oncomplete=r;tx.onerror=j;});db.close();
  localStorage.setItem('tienda_work_mode_v1','local');localStorage.setItem('auth_token','ok');localStorage.setItem('auth_user','liz');
 });
 const base=`${TEST_ORIGIN}/tienda-smart/`;await page.goto(base);await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
 assert.equal(await page.evaluate(async()=>{
  const db=await POSStorage.open();const row=await new Promise((r,j)=>{const q=db.transaction('snapshots').objectStore('snapshots').get('current');q.onsuccess=()=>r(q.result);q.onerror=j;});
  return row.savedAt==='2020-01-01'&&STATE.products[0].stock===100&&pendingOps.some(op=>op.id==='LEGACY');
 }),true);tests.push('migración del esquema v3 conserva instantánea y cola originales');
 await page.evaluate(async()=>{
  STATE.products.push({id:'REMOVE',name:'Eliminar',stock:10,price:3,movements:[]});saveLocalBackup();await persistLocalState(true);
  localStorage.setItem(LOCAL_BACKUP_KEY,JSON.stringify(STATE));localStorage.setItem(PENDING_KEY,JSON.stringify(pendingOps));
  STATE.products=STATE.products.filter(p=>p.id!=='REMOVE');pendingOps=[];saveLocalBackup();await persistLocalState(true);
 });
 await page.reload();await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
 assert.equal(await page.evaluate(()=>STATE.products.length===1&&pendingOps.length===0),true);tests.push('respaldos antiguos no resucitan entidades ni operaciones ya confirmadas');
 assert.equal(await page.evaluate(async()=>{
  const original=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(row,...args){if(this.name==='pendingOps') throw new Error('Fallo de transacción simulado');return original.call(this,row,...args);};
  const state=structuredClone(STATE);state.products[0].stock=50;
  let failed=false;try{await POSStorage.commit(state,[{id:'FAIL',type:'product',payload:state.products[0]}]);}catch(_){failed=true;}finally{IDBObjectStore.prototype.put=original;}
  const saved=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps();return failed&&saved.products[0].stock===100&&ops.length===0;
 }),true);tests.push('abortar una transacción no guarda sólo una parte del estado y la cola');
 await page.evaluate(async()=>{
  const now=new Date().toISOString();STATE.shifts.push({id:'SHIFT',status:'OPEN',staffId:'TEST',staffName:'Prueba',openedAt:now,openingCash:0});activateShiftLocally('SHIFT');
  cart=[];addToCart(getProductById('P'));const original=POSStorage.commit;POSStorage.commit=async()=>{throw new Error('Fallo IDB simulado');};
  await completeSale();POSStorage.commit=original;
 });
 assert.equal(await page.evaluate(()=>!!localStorage.getItem('tienda_critical_fallback_v1')),true);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#search-inv').dataset.fastSearchBound==='1');
 assert.equal(await page.evaluate(async()=>{const data=await POSStorage.loadState(),ops=await POSStorage.loadPendingOps();return data.products[0].stock===99&&data.sales.length===1&&ops.some(op=>op.type==='sale')&&!localStorage.getItem('tienda_critical_fallback_v1');}),true);tests.push('respaldo alternativo atómico se reimporta con venta y cola tras recargar');
 await page.evaluate(async()=>{
  STATE.products.push({id:'ROOT',name:'Caja',stock:1,price:12,movements:[]},{id:'CHILD',name:'Unidad',parentProductId:'ROOT',subFactor:12,stock:12,price:1,movements:[]});rebuildLinkedStocks();pendingOps=[];
  mergeFromSubcollection('products',[{id:'ROOT',name:'Caja',stock:0,price:12,movements:[],updatedAt:'2040-01-01'}]);
 });
 assert.equal(await page.evaluate(()=>getAvailableQtyForSale('CHILD')===0&&getProductById('ROOT').stock===0),true);tests.push('stock remoto cero no se reconstruye desde un subproducto desactualizado');
 assert.deepEqual(errors,[]);fs.writeFileSync(`${ARTIFACTS}/storage-results.json`,JSON.stringify({passed:tests.length,tests,errors},null,2));console.log(JSON.stringify({passed:tests.length,tests,errors}));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
