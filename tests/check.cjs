const fs=require('fs'),vm=require('vm'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
let scripts=0;
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)){new vm.Script(match[1],{filename:'index.html:inline'});scripts++;}
for(const file of ['pos-offline.js','service-worker.js']) new vm.Script(fs.readFileSync(path.join(root,file),'utf8'),{filename:file});
const markup=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
assert.equal(new Set(ids).size,ids.length,'Identificadores HTML repetidos');
const expected=require('./original-ids.json');assert.deepEqual(expected.filter(id=>!ids.includes(id)),[],'Faltan identificadores originales');
let handlers=0;
for(const match of markup.matchAll(/\bon(?:click|submit|change|input|keydown)="([^"]*)"/g)){
  const code=match[1].replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');new Function('event',code);handlers++;
}
for(const match of markup.matchAll(/(?:src|href)="\.\/([^"?#]+)(?:[?#][^"]*)?"/g)) assert.ok(fs.existsSync(path.join(root,match[1])),'Falta '+match[1]);
console.log(JSON.stringify({scripts,handlers,preservedIds:expected.length,uniqueIds:ids.length,syntax:'OK',localResources:'OK'}));
