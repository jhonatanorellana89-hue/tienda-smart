(function(){
  'use strict';
  const DB_NAME = 'TiendaSmartOffline', DB_VERSION = 3;
  const ENTITY_STORES = ['products','sales','customers','purchases','suppliers','auditLogs','stockClosures','staff','shifts','stockMovements','syncConflicts'];
  let dbPromise, writeChain = Promise.resolve(), stateTimer, opsTimer, pendingState, pendingOps;
  const signatures = new Map();
  const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  function openDb(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject)=>{
      const request = indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded = ()=>{
        const db=request.result;
        ['snapshots','meta'].forEach(name=>{ if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'key'}); });
        ['pendingOps',...ENTITY_STORES].forEach(name=>{ if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'}); });
      };
      request.onsuccess=()=>{
        const db=request.result;
        db.onversionchange=()=>{db.close(); dbPromise=null; signatures.clear();};
        resolve(db);
      };
      request.onerror=()=>{dbPromise=null;reject(request.error||new Error('IndexedDB no disponible'));};
      request.onblocked=()=>reject(new Error('Cierra las otras pestañas para actualizar IndexedDB'));
    });
    return dbPromise;
  }
  function requestResult(request){return new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
  function transactionDone(tx){return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve(true);tx.onabort=tx.onerror=()=>reject(tx.error||new Error('No se pudo guardar en IndexedDB'));
  });}
  async function getMeta(key){
    const db=await openDb();const row=await requestResult(db.transaction('meta').objectStore('meta').get(key));return row?.value??null;
  }
  async function setMeta(key,value){
    const db=await openDb();const tx=db.transaction('meta','readwrite');const done=transactionDone(tx);
    tx.objectStore('meta').put({key,value});await done;
  }
  async function loadState(){
    const db=await openDb();const manifest=await getMeta('entityStateV1');
    if(manifest){
      const tx=db.transaction(ENTITY_STORES);const result={...manifest.extra};
      await Promise.all(ENTITY_STORES.map(async name=>{
        const rows=await requestResult(tx.objectStore(name).getAll());
        const order=new Map((manifest.order?.[name]||[]).map((id,i)=>[id,i]));
        rows.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
        result[name]=rows;
        signatures.set(name,new Map(rows.map(row=>[row.id,JSON.stringify(row)])));
      }));
      return result;
    }
    const row=await requestResult(db.transaction('snapshots').objectStore('snapshots').get('current'));
    return row?.value||null;
  }
  async function loadPendingOps(){
    const db=await openDb();return (await requestResult(db.transaction('pendingOps').objectStore('pendingOps').getAll())).sort((a,b)=>String(a.ts||'').localeCompare(String(b.ts||'')));
  }
  // Sólo filas modificadas; estado y cola se confirman en la misma transacción.
  function commit(state,ops){
    const run=async()=>{
      const db=await openDb(), changes=[], next=new Map(), order={};
      if(state) ENTITY_STORES.forEach(name=>{
        const previous=signatures.get(name)||new Map(), current=new Map(), puts=[];
        order[name]=[];
        (state[name]||[]).forEach((row,index)=>{
          if(!row || typeof row!=='object') return;
          const value=row.id?row:{...row,id:`${name}-${index}`};
          const json=JSON.stringify(value);current.set(value.id,json);order[name].push(value.id);
          if(previous.get(value.id)!==json) puts.push(JSON.parse(json));
        });
        changes.push({name,puts,deletes:[...previous.keys()].filter(id=>!current.has(id))});next.set(name,current);
      });
      let queueChanges;
      if(ops){
        const previous=signatures.get('pendingOps')||new Map(), current=new Map(), puts=[];
        ops.forEach(op=>{if(op?.id){const json=JSON.stringify(op);current.set(op.id,json);if(previous.get(op.id)!==json) puts.push(JSON.parse(json));}});
        queueChanges={name:'pendingOps',puts,deletes:[...previous.keys()].filter(id=>!current.has(id))};
        next.set('pendingOps',current);
      }
      const names=['meta',...(state?ENTITY_STORES:[]),...(ops?['pendingOps']:[])];
      let tx;
      try{tx=db.transaction(names,'readwrite',{durability:'strict'});}catch(_){tx=db.transaction(names,'readwrite');}
      const done=transactionDone(tx);
      try{
        [...changes,...(queueChanges?[queueChanges]:[])].forEach(change=>{
          const store=tx.objectStore(change.name);change.deletes.forEach(id=>store.delete(id));change.puts.forEach(row=>store.put(row));
        });
        if(state){
          const extra=Object.fromEntries(Object.entries(state).filter(([key])=>!ENTITY_STORES.includes(key)));
          tx.objectStore('meta').put({key:'entityStateV1',value:{savedAt:new Date().toISOString(),order,extra:clone(extra)}});
        }
        if(ops) tx.objectStore('meta').put({key:'queueAuthoritativeV1',value:true});
      }catch(error){tx.abort();await done.catch(()=>{});throw error;}
      await done;next.forEach((value,key)=>signatures.set(key,value));return true;
    };
    const result=writeChain.then(run);writeChain=result.catch(()=>{});return result;
  }
  function scheduleStateSave(state,delay=180){
    pendingState=state;clearTimeout(stateTimer);
    stateTimer=setTimeout(()=>flushState().catch(error=>console.warn('IndexedDB state save failed',error)),delay);
  }
  async function flushState(state){
    clearTimeout(stateTimer);const value=state||pendingState;pendingState=null;
    if(value) return commit(value);await writeChain;return true;
  }
  function schedulePendingSave(ops,delay=100){
    pendingOps=ops;clearTimeout(opsTimer);
    opsTimer=setTimeout(()=>{const value=pendingOps;pendingOps=null;commit(null,value).catch(error=>console.warn('IndexedDB queue save failed',error));},delay);
  }
  function cancelScheduled(){
    clearTimeout(stateTimer);clearTimeout(opsTimer);pendingState=null;pendingOps=null;
  }
  async function initialize(legacyState,legacyOps){
    await openDb();const authoritative=!!await getMeta('entityStateV1');
    let state=await loadState();
    // Se conserva intacta la instantánea v3 para restauración.
    if(!state) state=legacyState;
    if(!authoritative && state) await commit(state);
    let ops=await loadPendingOps();const queueAuthoritative=!!await getMeta('queueAuthoritativeV1');
    if(!queueAuthoritative){
      const all=new Map([...ops,...(legacyOps||[])].filter(op=>op?.id).map(op=>[op.id,op]));
      ops=[...all.values()];await commit(null,ops);
    }else signatures.set('pendingOps',new Map(ops.map(op=>[op.id,JSON.stringify(op)])));
    return {state,ops,authoritative,queueAuthoritative:true};
  }
  window.POSStorage={DB_NAME,DB_VERSION,open:openDb,initialize,loadState,saveState:state=>commit(state),scheduleStateSave,flushState,
    loadPendingOps,savePendingOps:ops=>commit(null,ops),schedulePendingSave,setMeta,getMeta,commit,cancelScheduled,settleWrites:()=>writeChain,
    createBackup:async(state,ops,extra)=>({format:'TIENDASMART_BACKUP_V2',createdAt:new Date().toISOString(),state:clone(state||{}),pendingOps:clone(ops||[]),meta:clone(extra||{})})};
})();
