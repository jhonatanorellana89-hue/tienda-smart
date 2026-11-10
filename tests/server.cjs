const http=require('http'),fs=require('fs'),path=require('path');
const root=path.resolve(__dirname,'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png'};
function createServer(){return http.createServer((request,response)=>{
 const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
 if(pathname==='/'){response.setHeader('Content-Type','text/html');response.end('<!doctype html><title>Origen aislado de pruebas</title>');return;}
 if(!pathname.startsWith('/tienda-smart/')){response.writeHead(404);response.end();return;}
 const relative=pathname.slice('/tienda-smart/'.length)||'index.html';
 const file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep)){response.writeHead(403);response.end();return;}
 fs.readFile(file,(error,data)=>{if(error){response.writeHead(404);response.end();return;}response.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');response.setHeader('Cache-Control','no-cache');response.end(data);});
});}
module.exports={createServer};
if(require.main===module) createServer().listen(Number(process.env.PORT)||8765,'127.0.0.1',()=>console.log('Vista local: http://127.0.0.1:'+(process.env.PORT||8765)+'/tienda-smart/'));
