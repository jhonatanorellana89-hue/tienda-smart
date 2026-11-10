const {spawn}=require('child_process'),path=require('path');const {createServer}=require('./server.cjs');
(async()=>{
 const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const files=process.argv.includes('--benchmark')?['benchmark.cjs']:['regression.cjs','offline.cjs','storage.cjs','sync.cjs'];
 try{for(const file of files){
   const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[path.join(__dirname,file)],{stdio:'inherit',env:{...process.env,TIENDA_TEST_ORIGIN:origin}});child.on('error',reject);child.on('exit',resolve);});
   if(code!==0) throw new Error(file+' falló ('+code+')');
 }}finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
