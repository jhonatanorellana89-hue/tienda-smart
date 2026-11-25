(function(){
  'use strict';
  const DB_NAME = 'TiendaSmartOffline', DB_VERSION = 3;
  const ENTITY_STORES = ['products','sales','customers','purchases','suppliers','auditLogs','stockClosures','staff','shifts','stockMovements','syncConflicts'];
  let dbPromise, activeDb=null, openAttempt=0, entityStateInitialized=false, writeChain = Promise.resolve(), stateTimer, opsTimer, pendingState, pendingOps;
  const signatures = new Map();
  const clone = value => typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  function openDb(){
    if(dbPromise) return dbPromise;
    const attempt=++openAttempt;
    dbPromise = new Promise((resolve,reject)=>{
      let failed=false;
      const fail=error=>{failed=true;if(attempt===openAttempt) dbPromise=null;reject(error);};
      const request = indexedDB.open(DB_NAME,DB_VERSION);
      request.onupgradeneeded = ()=>{
        entityStateInitialized=false;
        const db=request.result;
        ['snapshots','meta'].forEach(name=>{ if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'key'}); });
        ['pendingOps',...ENTITY_STORES].forEach(name=>{ if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'}); });
      };
      request.onsuccess=()=>{
        const db=request.result;
        if(failed||attempt!==openAttempt){db.close();return;}
        activeDb=db;
        db.onclose=()=>{if(activeDb===db){activeDb=null;dbPromise=null;}};
        db.onversionchange=()=>{db.close();if(activeDb===db){activeDb=null;dbPromise=null;signatures.clear();}};
        resolve(db);
      };
      request.onerror=()=>fail(request.error||new Error('IndexedDB no disponible'));
      request.onblocked=()=>fail(Object.assign(new Error('Cierra las otras pestañas de TiendaSmart para habilitar el guardado'),{name:'StorageBlockedError'}));
    });
    const pending=dbPromise;
    pending.catch(()=>{if(dbPromise===pending) dbPromise=null;});
    return pending;
  }
  function resetConnection(){
    try{activeDb?.close();}catch(_){}activeDb=null;dbPromise=null;
    // Las firmas siguen representando la última transacción confirmada.
  }
  function notifyStorageFailure(error){
    console.warn('Guardado local pendiente',error);
    window.dispatchEvent(new CustomEvent('tienda-storage-error',{detail:error}));
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
      entityStateInitialized=true;
      const heads=await getMeta('incrementalOrderHeadsV1')||{};
      const tx=db.transaction(ENTITY_STORES);const result={...manifest.extra};
      await Promise.all(ENTITY_STORES.map(async name=>{
        const rows=await requestResult(tx.objectStore(name).getAll());
        const order=new Map((manifest.order?.[name]||[]).map((id,i)=>[id,i]));
        if(heads[name]?.length){
          const recent=new Map(heads[name].map((id,i)=>[id,i]));
          const times=new Map(rows.map(row=>{const value=row.date||row.ts||0;const seconds=value?.seconds??value?._seconds;return [row.id,Number.isFinite(seconds)?seconds*1000:new Date(value).getTime()||0];}));
          rows.sort((a,b)=>times.get(b.id)-times.get(a.id)||(recent.get(a.id)??Infinity)-(recent.get(b.id)??Infinity)||(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
        }else rows.sort((a,b)=>(order.get(a.id)??Infinity)-(order.get(b.id)??Infinity));
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
  function enqueueWrite(run){
    const result=writeChain.then(async()=>{
      try{return await run();}catch(error){
        if(!['InvalidStateError','TransactionInactiveError'].includes(error?.name)) throw error;
        resetConnection();return run();
      }
    });writeChain=result.catch(()=>{});return result;
  }
  function acknowledgePendingOps(ids,receipts){
    const removed=[...ids],log=clone(receipts);
    return enqueueWrite(async()=>{
      const db=await openDb();let tx;
      try{tx=db.transaction(['pendingOps','meta'],'readwrite',{durability:'strict'});}catch(_){tx=db.transaction(['pendingOps','meta'],'readwrite');}
      const done=transactionDone(tx);
      try{
        const store=tx.objectStore('pendingOps');removed.forEach(id=>store.delete(id));
        tx.objectStore('meta').put({key:'syncReceiptLogV1',value:log});
        tx.objectStore('meta').put({key:'queueAuthoritativeV1',value:true});
      }catch(error){tx.abort();await done.catch(()=>{});throw error;}
      await done;const previous=signatures.get('pendingOps');removed.forEach(id=>previous?.delete(id));return true;
    });
  }
  // Sólo filas modificadas; estado y cola se confirman en la misma transacción.
  function commitChangedRows(ops,options){
    return enqueueWrite(async()=>{
      if(!entityStateInitialized) throw new Error('Falta el guardado inicial completo');
      const db=await openDb(),rows=new Map(),queue=new Map(),newHeads={};
      for(const [name,changes] of Object.entries(options.changes)){
        if(!ENTITY_STORES.includes(name)) throw new Error('Almacén no válido: '+name);
        rows.set(name,changes.map(row=>{if(!row?.id) throw new Error('Registro sin ID');const json=JSON.stringify(row);return {id:row.id,json,value:JSON.parse(json)};}));
        if(['sales','stockMovements','auditLogs'].includes(name)) newHeads[name]=changes.filter(row=>!signatures.get(name)?.has(row.id)).map(row=>row.id);
      }
      const ids=new Set(options.operationIds||[]);
      ops.filter(op=>ids.has(op.id)).forEach(op=>{const json=JSON.stringify(op);queue.set(op.id,{json,value:JSON.parse(json)});});
      if(queue.size!==ids.size) throw new Error('Faltan operaciones para guardar la venta');
      let tx;const names=['meta','pendingOps',...rows.keys()];
      try{tx=db.transaction(names,'readwrite',{durability:'strict'});}catch(_){tx=db.transaction(names,'readwrite');}
      const done=transactionDone(tx);let requestError=null;
      try{
        rows.forEach((changes,name)=>changes.forEach(row=>tx.objectStore(name).put(row.value)));
        queue.forEach(row=>tx.objectStore('pendingOps').put(row.value));
        const meta=tx.objectStore('meta');meta.put({key:'queueAuthoritativeV1',value:true});
        if(options.lastSale) meta.put({key:'lastLocalSaleV1',value:clone(options.lastSale)});
        const request=meta.get('incrementalOrderHeadsV1');request.onsuccess=()=>{
          try{
            const current=request.result?.value||{};
            for(const [name,ids] of Object.entries(newHeads)) if(ids.length) current[name]=[...new Set([...ids,...(current[name]||[])])].slice(0,200);
            meta.put({key:'incrementalOrderHeadsV1',value:current});
          }catch(error){requestError=error;tx.abort();}
        };
      }catch(error){tx.abort();await done.catch(()=>{});throw error;}
      try{await done;}catch(error){throw requestError||error;}
      rows.forEach((changes,name)=>{if(!signatures.has(name)) signatures.set(name,new Map());changes.forEach(row=>signatures.get(name).set(row.id,row.json));});
      if(!signatures.has('pendingOps')) signatures.set('pendingOps',new Map());queue.forEach((row,id)=>signatures.get('pendingOps').set(id,row.json));return true;
    });
  }
  function commit(state,ops,receipts,options={}){
    if(options.changes) return commitChangedRows(ops,options);
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
          tx.objectStore('meta').put({key:'incrementalOrderHeadsV1',value:{}});
        }
        if(options.lastSale) tx.objectStore('meta').put({key:'lastLocalSaleV1',value:clone(options.lastSale)});
        if(ops) tx.objectStore('meta').put({key:'queueAuthoritativeV1',value:true});
        if(Array.isArray(receipts)) tx.objectStore('meta').put({key:'syncReceiptLogV1',value:clone(receipts)});
      }catch(error){tx.abort();await done.catch(()=>{});throw error;}
      await done;if(state) entityStateInitialized=true;next.forEach((value,key)=>signatures.set(key,value));return true;
    };
    return enqueueWrite(run);
  }
  function scheduleStateSave(state,delay=180){
    pendingState=state;clearTimeout(stateTimer);
    stateTimer=setTimeout(()=>flushState().catch(notifyStorageFailure),delay);
  }
  async function flushState(state){
    clearTimeout(stateTimer);const value=state||pendingState;pendingState=null;
    if(value) return commit(value);await writeChain;return true;
  }
  function schedulePendingSave(ops,delay=100){
    pendingOps=ops;clearTimeout(opsTimer);
    opsTimer=setTimeout(()=>{const value=pendingOps;pendingOps=null;commit(null,value).catch(notifyStorageFailure);},delay);
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
    const receipts=await getMeta('syncReceiptLogV1'),lastSale=await getMeta('lastLocalSaleV1');
    return {state,ops,receipts:Array.isArray(receipts)?receipts:[],lastSale,authoritative,queueAuthoritative:true};
  }
  window.POSStorage={DB_NAME,DB_VERSION,supportsChangedRows:true,open:openDb,initialize,loadState,saveState:state=>commit(state),scheduleStateSave,flushState,
    loadPendingOps,savePendingOps:(ops,receipts)=>commit(null,ops,receipts),acknowledgePendingOps,schedulePendingSave,setMeta,getMeta,commit,cancelScheduled,settleWrites:()=>writeChain,
    createBackup:async(state,ops,extra)=>({format:'TIENDASMART_BACKUP_V2',createdAt:new Date().toISOString(),state:clone(state||{}),pendingOps:clone(ops||[]),meta:clone(extra||{})})};
})();
