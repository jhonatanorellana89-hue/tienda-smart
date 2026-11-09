(function(){
  'use strict';

  const DB_NAME = 'TiendaSmartOffline';
  const DB_VERSION = 3;
  const ENTITY_STORES = [
    'products','sales','customers','purchases','suppliers','auditLogs',
    'stockClosures','staff','shifts','stockMovements','syncConflicts'
  ];
  let dbPromise = null;
  let stateTimer = null;
  let pendingState = null;
  let pendingOpsTimer = null;
  let pendingOpsValue = null;

  function clone(value){
    if(value === undefined) return undefined;
    try{
      if(typeof structuredClone === 'function') return structuredClone(value);
    }catch(_){ }
    return JSON.parse(JSON.stringify(value));
  }

  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject)=>{
      if(!('indexedDB' in window)){
        reject(new Error('IndexedDB no disponible'));
        return;
      }
      const request = indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded = event=>{
        const db = event.target.result;
        if(!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots',{keyPath:'key'});
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('pendingOps')) db.createObjectStore('pendingOps',{keyPath:'id'});
        ENTITY_STORES.forEach(name=>{
          if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'});
        });
      };
      request.onsuccess = ()=>resolve(request.result);
      request.onerror = ()=>reject(request.error || new Error('No se pudo abrir IndexedDB'));
      request.onblocked = ()=>reject(new Error('IndexedDB bloqueada por otra ventana'));
    });
    return dbPromise;
  }

  function requestResult(request){
    return new Promise((resolve,reject)=>{
      request.onsuccess = ()=>resolve(request.result);
      request.onerror = ()=>reject(request.error || new Error('Error de IndexedDB'));
    });
  }

  function transactionDone(transaction){
    return new Promise((resolve,reject)=>{
      transaction.oncomplete = ()=>resolve(true);
      transaction.onerror = ()=>reject(transaction.error || new Error('Transaccion IndexedDB fallida'));
      transaction.onabort = ()=>reject(transaction.error || new Error('Transaccion IndexedDB cancelada'));
    });
  }

  async function loadState(){
    const db = await openDb();
    const tx = db.transaction('snapshots','readonly');
    const row = await requestResult(tx.objectStore('snapshots').get('current'));
    return row && row.value ?clone(row.value):null;
  }

  async function saveState(state){
    const snapshot = clone(state || {});
    const db = await openDb();
    const stores = ['snapshots','meta'].concat(ENTITY_STORES);
    const tx = db.transaction(stores,'readwrite');
    const savedAt = new Date().toISOString();
    tx.objectStore('snapshots').put({key:'current',value:snapshot,savedAt});
    tx.objectStore('meta').put({key:'lastLocalSave',value:savedAt});
    ENTITY_STORES.forEach(name=>{
      const store = tx.objectStore(name);
      store.clear();
      const rows = Array.isArray(snapshot[name]) ?snapshot[name]:[];
      rows.forEach((row,index)=>{
        if(!row || typeof row !== 'object') return;
        const item = clone(row);
        if(!item.id) item.id = `${name}-${index}`;
        store.put(item);
      });
    });
    await transactionDone(tx);
    return savedAt;
  }

  function scheduleStateSave(state,delayMs){
    pendingState = clone(state || {});
    if(stateTimer) clearTimeout(stateTimer);
    stateTimer = setTimeout(async ()=>{
      const value = pendingState;
      pendingState = null;
      stateTimer = null;
      try{ await saveState(value); }catch(error){ console.warn('IndexedDB state save failed',error); }
    },Number(delayMs)||180);
  }

  async function flushState(state){
    if(stateTimer){ clearTimeout(stateTimer); stateTimer = null; }
    const value = state ?clone(state):(pendingState ?clone(pendingState):null);
    pendingState = null;
    if(!value) return false;
    await saveState(value);
    return true;
  }

  async function loadPendingOps(){
    const db = await openDb();
    const tx = db.transaction('pendingOps','readonly');
    const rows = await requestResult(tx.objectStore('pendingOps').getAll());
    return (rows || []).sort((a,b)=>String(a.ts||'').localeCompare(String(b.ts||'')));
  }

  async function savePendingOps(ops){
    const list = clone(Array.isArray(ops)?ops:[]);
    const db = await openDb();
    const tx = db.transaction(['pendingOps','meta'],'readwrite');
    const store = tx.objectStore('pendingOps');
    store.clear();
    list.forEach(op=>{ if(op && op.id) store.put(op); });
    tx.objectStore('meta').put({key:'pendingCount',value:list.length,updatedAt:new Date().toISOString()});
    await transactionDone(tx);
  }

  function schedulePendingSave(ops,delayMs){
    pendingOpsValue = clone(Array.isArray(ops)?ops:[]);
    if(pendingOpsTimer) clearTimeout(pendingOpsTimer);
    pendingOpsTimer = setTimeout(async ()=>{
      const value = pendingOpsValue;
      pendingOpsValue = null;
      pendingOpsTimer = null;
      try{ await savePendingOps(value); }catch(error){ console.warn('IndexedDB queue save failed',error); }
    },Number(delayMs)||100);
  }

  async function setMeta(key,value){
    const db = await openDb();
    const tx = db.transaction('meta','readwrite');
    tx.objectStore('meta').put({key:String(key),value:clone(value),updatedAt:new Date().toISOString()});
    await transactionDone(tx);
  }

  async function getMeta(key){
    const db = await openDb();
    const tx = db.transaction('meta','readonly');
    const row = await requestResult(tx.objectStore('meta').get(String(key)));
    return row ?clone(row.value):null;
  }

  async function initialize(legacyState,legacyOps){
    await openDb();
    let state = await loadState();
    let ops = await loadPendingOps();
    if(!state && legacyState){
      await saveState(legacyState);
      state = clone(legacyState);
      await setMeta('legacyMigration',{completedAt:new Date().toISOString(),source:'localStorage'});
    }
    if((!ops || ops.length===0) && Array.isArray(legacyOps) && legacyOps.length){
      await savePendingOps(legacyOps);
      ops = clone(legacyOps);
    }
    return {state,ops:ops||[]};
  }

  async function createBackup(state,ops,extra){
    return {
      format:'TIENDASMART_BACKUP_V2',
      createdAt:new Date().toISOString(),
      state:clone(state||{}),
      pendingOps:clone(ops||[]),
      meta:clone(extra||{})
    };
  }

  window.POSStorage = {
    DB_NAME,DB_VERSION,open:openDb,initialize,loadState,saveState,scheduleStateSave,
    flushState,loadPendingOps,savePendingOps,schedulePendingSave,setMeta,getMeta,createBackup
  };
})();
