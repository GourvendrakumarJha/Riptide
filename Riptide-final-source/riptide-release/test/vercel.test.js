'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process');
const ROOT=path.join(__dirname,'..');
const post=(data,token,method='POST')=>({method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});
async function worker(dir,url,extra={}){
 const script=`const http=require('node:http');const handler=require('./api/index.js');const server=http.createServer(async(req,res)=>{if(!['GET','HEAD'].includes(req.method)){const chunks=[];for await(const chunk of req)chunks.push(chunk);req.body=JSON.parse(Buffer.concat(chunks).toString()||'{}')}await handler(req,res)});server.listen(0,'127.0.0.1',()=>console.log('PORT='+server.address().port));`;
 const child=spawn(process.execPath,['-e',script],{cwd:ROOT,env:{...process.env,VERCEL:'',TURSO_DATABASE_URL:url,RIPTIDE_DATA_DIR:dir,RIPTIDE_DEMO_MODE:'true',RIPTIDE_PREVIEW_COOKIES:'true',...extra}});let errors='';child.stderr.on('data',x=>{errors+=x;if(process.env.DEBUG_SERVERLESS_TEST)console.error(String(x))});
 const port=await new Promise((resolve,reject)=>{child.stdout.on('data',x=>{const match=x.toString().match(/PORT=(\d+)/);if(match)resolve(match[1])});child.once('exit',code=>reject(Error('Worker exited '+code+' '+errors)))});
 return {base:'http://127.0.0.1:'+port,async stop(){if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill()})}};
}
test('serverless entry shares durable state across instances and handles 5 MB attachments in chunks',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'riptide-libsql-')),url='file:'+path.join(dir,'shared.sqlite');let a,b;
 try{
  a=await worker(dir,url);b=await worker(dir,url);
  const call=(w,route,options)=>fetch(w.base+route,options);
  const login=async(w,username,password)=>{const r=await call(w,'/api/login',post({username,password}));assert.equal(r.status,200,await r.clone().text());return (await r.json()).previewSessionToken};
  const admin=await login(a,'demo.admin','Demo-Admin-2026!'),hydro=await login(b,'demo.hydrology','Demo-Hydrology-2026!');
  let r=await call(b,'/api/staff-directory',{headers:{Authorization:'Bearer '+admin}});assert.equal(r.status,200);const directory=await r.json();assert.equal(directory.length,5);
  r=await call(a,'/api/alerts',post({recipientId:directory.find(u=>u.role==='hydrology').id,message:'Shared serverless conversation'},admin));assert.equal(r.status,201);const id=(await r.json()).id;
  r=await call(b,'/api/alerts',{headers:{Authorization:'Bearer '+hydro}});assert.ok((await r.json()).some(t=>t.id===id));
  r=await call(b,`/api/alerts/${id}/messages`,post({message:'Reply from a separate function instance'},hydro));assert.equal(r.status,201);
  r=await call(a,`/api/alerts/${id}/messages`,{headers:{Authorization:'Bearer '+admin}});assert.equal((await r.json()).messages.length,1);
  // Exactly 5 MiB: larger than Vercel's whole-request limit, preserved through chunks.
  const bytes=Buffer.alloc(5*1024*1024,23);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  r=await call(a,'/api/uploads',post({name:'large-evidence.png',mime:'image/png',size:bytes.length}));assert.equal(r.status,201);const upload=await r.json();
  for(let offset=0,part=0;offset<bytes.length;offset+=upload.chunkSize,part++){
   const options=post({data:bytes.subarray(offset,offset+upload.chunkSize).toString('base64')},null,'PUT');options.headers['X-Riptide-Upload-Token']=upload.token;
   r=await call(part%2?a:b,`/api/uploads/${upload.id}/chunks/${part}`,options);assert.equal(r.status,200,await r.clone().text());assert.ok(Buffer.byteLength(options.body)<4_500_000);
  }
  const report={id:'serverless-report-001',type:'report',createdAt:new Date().toISOString(),description:'Chunked evidence',location:'Demo location',media:{uploadId:upload.id,uploadToken:upload.token}};
  r=await call(a,'/api/items',post(report));assert.equal(r.status,201,await r.clone().text());r=await call(b,'/api/items',post(report));assert.equal(r.status,200);assert.equal((await r.json()).duplicate,true);
  r=await call(b,`/api/items/${report.id}/attachment/info`,{headers:{Authorization:'Bearer '+admin}});const info=await r.json();assert.equal(info.size,bytes.length);
  const parts=[];for(let part=0;part<Math.ceil(info.size/info.chunkSize);part++){r=await call(a,`/api/items/${report.id}/attachment/parts/${part}`,{headers:{Authorization:'Bearer '+admin}});assert.equal(r.status,200);parts.push(Buffer.from((await r.json()).data,'base64'))}assert.deepEqual(Buffer.concat(parts),bytes);
  r=await call(a,`/api/items/${report.id}/attachment/info`);assert.equal(r.status,401);
  // Concurrent scenario edits must not both win the same revision.
  r=await call(a,'/api/scenario');const scenario=await r.json();const update={...scenario,baseRevision:scenario.revision,water:3};
  const edits=await Promise.all([call(a,'/api/scenario',post(update)),call(b,'/api/scenario',post(update))]);assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
  r=await call(a,'/api/items',post({id:'serverless-gps-sos',type:'sos',createdAt:new Date().toISOString(),description:'GPS SOS',locationStatus:'captured',gps:{latitude:24.925,longitude:86.225,accuracy:15,capturedAt:new Date().toISOString()}}));assert.equal(r.status,201);
  // Failed sign-ins must still consume shared limits and preserve audit events.
  const failures=[];for(let n=0;n<11;n++){r=await call(n%2?a:b,'/api/login',post({username:'missing-user',password:'wrong-password'}));failures.push(r.status)}assert.ok(failures.includes(401));assert.ok(failures.every(status=>status===401||status===429));assert.equal(failures.at(-1),429);
  r=await call(a,'/api/audit',{headers:{Authorization:'Bearer '+admin}});assert.ok((await r.json()).some(event=>event.action==='login.failed'));
  await a.stop();a=null;await b.stop();b=null;a=await worker(dir,url);
  r=await call(a,'/api/items',{headers:{Authorization:'Bearer '+admin}});assert.ok((await r.json()).some(item=>item.id==='serverless-gps-sos'));
  r=await call(a,`/api/alerts/${id}/messages`,{headers:{Authorization:'Bearer '+admin}});assert.equal((await r.json()).messages.length,1);
 }finally{await a?.stop();await b?.stop();fs.rmSync(dir,{recursive:true,force:true})}
});
test('Vercel refuses ephemeral SQLite instead of pretending to persist data',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'riptide-vercel-config-'));let w;
 try{w=await worker(dir,'',{VERCEL:'1',TURSO_AUTH_TOKEN:''});const r=await fetch(w.base+'/api/session');assert.equal(r.status,503);assert.equal(fs.existsSync(path.join(dir,'riptide.sqlite')),false)}finally{await w?.stop();fs.rmSync(dir,{recursive:true,force:true})}
});

test('one-time importer preserves records and refuses to overwrite a populated target',async()=>{
 const {execFileSync,spawnSync}=require('node:child_process');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'riptide-import-')),source=path.join(dir,'source'),target='file:'+path.join(dir,'target.sqlite');
 try{
  const seed=`(async()=>{const {db}=await require('./server').ready;const at=new Date().toISOString();const payload={id:'migration-sos-001',type:'sos',createdAt:at,description:'Preserve GPS',gps:{latitude:24.9,longitude:86.2,accuracy:10,capturedAt:at}};db.prepare('INSERT INTO items(id,type,payload,payload_hash,created_at,received_at) VALUES(?,?,?,?,?,?)').run(payload.id,'sos',JSON.stringify(payload),'hash',at,at);db.prepare('INSERT INTO staff_alerts(sender_id,sender_name,sender_role,recipient_id,message,created_at) VALUES(?,?,?,?,?,?)').run(1,'demo.admin','admin',3,'Preserve chat',at);db.prepare('INSERT INTO alert_replies(alert_id,sender_id,sender_name,sender_role,message,created_at) VALUES(?,?,?,?,?,?)').run(1,3,'demo.hydrology','hydrology','Preserve reply',at);db.close()})().catch(e=>{console.error(e);process.exit(1)})`;
  execFileSync(process.execPath,['-e',seed],{cwd:ROOT,env:{...process.env,VERCEL:'',TURSO_DATABASE_URL:'',RIPTIDE_DATA_DIR:source,RIPTIDE_DEMO_MODE:'true'},stdio:'pipe'});
  const env={...process.env,VERCEL:'',TURSO_DATABASE_URL:target,TURSO_AUTH_TOKEN:'',RIPTIDE_DATA_DIR:path.join(dir,'unused')};
  execFileSync(process.execPath,['scripts/migrate-to-turso.cjs',path.join(source,'riptide.sqlite')],{cwd:ROOT,env,stdio:'pipe'});
  const {createClient}=require('@libsql/client'),client=createClient({url:target});
  try{assert.equal((await client.execute('SELECT COUNT(*) AS n FROM users')).rows[0].n,5);const record=(await client.execute('SELECT payload FROM items')).rows[0];assert.equal(JSON.parse(record.payload).gps.latitude,24.9);assert.equal((await client.execute('SELECT message FROM alert_replies')).rows[0].message,'Preserve reply');assert.equal((await client.execute('SELECT COUNT(*) AS n FROM sessions')).rows[0].n,0)}finally{client.close()}
  const repeat=spawnSync(process.execPath,['scripts/migrate-to-turso.cjs',path.join(source,'riptide.sqlite')],{cwd:ROOT,env,encoding:'utf8'});assert.equal(repeat.status,1);assert.ok(repeat.stderr.includes('not empty'));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
