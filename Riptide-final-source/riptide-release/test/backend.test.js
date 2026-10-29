'use strict';
const { test, after } = require('node:test');
const assert=require('node:assert/strict');const {spawn}=require('node:child_process');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'riptide-test-'));const port=19000+Math.floor(Math.random()*10000);const base=`http://127.0.0.1:${port}`;let processHandle;
function start(){return new Promise((resolve,reject)=>{processHandle=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(port),RIPTIDE_DATA_DIR:dir,VERCEL:'',TURSO_DATABASE_URL:process.env.RIPTIDE_TEST_DRIVER==='libsql'?'file:'+path.join(dir,'riptide.sqlite'):'',RIPTIDE_ADMIN_USER:'test-admin',RIPTIDE_ADMIN_PASSWORD:'test-password-12345'}});let stderr='';processHandle.stderr.on('data',x=>stderr+=x);processHandle.stdout.on('data',x=>{if(x.toString().includes('listening'))resolve()});processHandle.once('exit',code=>reject(new Error('server exited '+code+' '+stderr)))});}
async function stop(){if(!processHandle||processHandle.exitCode!==null)return;await new Promise(resolve=>{processHandle.once('exit',resolve);processHandle.kill()});processHandle=null}
after(async()=>{await stop();fs.rmSync(dir,{recursive:true,force:true})});
async function request(url,options={}){return fetch(base+url,options)}
function post(data,cookie){return {method:'POST',headers:{'content-type':'application/json',...(cookie?{cookie}:{})},body:JSON.stringify(data)}}
const report={id:'test-report-0001',type:'report',createdAt:'2026-01-01T00:00:00.000Z',location:'North road',description:'Water rising',media:{name:'pixel.png',data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='}};
test('backend auth, offline submission semantics, roles, media, status and persistence',async()=>{
 await start();let r=await request('/api/health');assert.equal(r.status,200);
 r=await request('/api/items');assert.equal(r.status,401);
 r=await request('/api/items',post(report));assert.equal(r.status,201);
 r=await request('/api/items',post(report));assert.equal(r.status,200);assert.equal((await r.json()).duplicate,true);
 r=await request('/api/items',post({...report,description:'different'}));assert.equal(r.status,409);
 r=await request('/api/items',post({...report,id:'test-report-0002',media:{name:'bad.svg',data:'data:image/svg+xml;base64,PHN2Zz4='}}));assert.equal(r.status,400);
 r=await request('/api/items/test-report-0001/attachment');assert.equal(r.status,401);
 r=await request('/api/login',post({username:'test-admin',password:'wrong'}));assert.equal(r.status,401);
 r=await request('/api/login',post({username:'test-admin',password:'test-password-12345'}));assert.equal(r.status,200);const admin=r.headers.get('set-cookie').split(';')[0];
 r=await request('/api/users',post({username:'partner',password:'partner-password-123',role:'relief'},admin));assert.equal(r.status,201);
 const logins={};
 for(const role of ['hydrology','rescue','verification']){r=await request('/api/users',post({username:role,password:'operator-password-123',role},admin));assert.equal(r.status,201);r=await request('/api/login',post({username:role,password:'operator-password-123'}));logins[role]=r.headers.get('set-cookie').split(';')[0]}
 r=await request('/api/staff-directory',{headers:{cookie:admin}});const directory=await r.json();const recipientId=directory.find(u=>u.username==='hydrology').id;
 r=await request('/api/alerts',post({recipientId,message:'Check river stage and prepare pumps'},admin));assert.equal(r.status,201);
 r=await request('/api/alerts',{headers:{cookie:logins.hydrology}});const alerts=await r.json();assert.equal(alerts.length,1);assert.equal(alerts[0].sender_name,'test-admin');assert.equal(alerts[0].recipient_name,'hydrology');
 r=await request('/api/alerts',{headers:{cookie:logins.rescue}});assert.equal((await r.json()).length,0);
 const alertPatch={method:'PATCH',headers:{'content-type':'application/json',cookie:logins.rescue},body:JSON.stringify({status:'completed'})};r=await request('/api/alerts/'+alerts[0].id,alertPatch);assert.equal(r.status,403);alertPatch.headers.cookie=logins.hydrology;r=await request('/api/alerts/'+alerts[0].id,alertPatch);assert.equal(r.status,200);
 r=await request('/api/work',post({location:'North shelter',detail:'Assign team Alpha for simulated rescue',quantity:2},logins.rescue));assert.equal(r.status,201);
 r=await request('/api/work',{headers:{cookie:logins.rescue}});const work=await r.json();assert.equal(work.length,1);assert.equal(work[0].role,'rescue');
 r=await request('/api/work',{headers:{cookie:logins.verification}});assert.equal((await r.json()).length,0);
 const workPatch={method:'PATCH',headers:{cookie:logins.verification,'content-type':'application/json'},body:JSON.stringify({status:'completed'})};r=await request('/api/work/'+work[0].id,workPatch);assert.equal(r.status,403);workPatch.headers.cookie=logins.rescue;r=await request('/api/work/'+work[0].id,workPatch);assert.equal(r.status,200);
 r=await request('/api/work',post({location:'River',detail:'Not a hydrology form',quantity:1},logins.hydrology));assert.equal(r.status,403);
 r=await request('/api/work',{headers:{cookie:admin}});assert.equal((await r.json()).length,1);
 r=await request('/api/items',post({id:'support-test-001',type:'support',createdAt:report.createdAt,kind:'Offer support',organization:'Demo',contact:'Demo',description:'Supplies'},logins.hydrology));assert.equal(r.status,403);
 r=await request('/api/scenario/actions',post({action:'pumps',value:2},logins.rescue));assert.equal(r.status,403);
 r=await request('/api/items/test-report-0001/status',{method:'PATCH',headers:{cookie:logins.rescue,'content-type':'application/json'},body:JSON.stringify({status:'resolved'})});assert.equal(r.status,403);
 r=await request('/api/items',{headers:{cookie:admin}});let items=await r.json();assert.equal(items.length,1);assert.equal(items[0].hasMedia,true);assert.equal(items[0].media,undefined);
 r=await request('/api/items/test-report-0001/attachment',{headers:{cookie:admin}});assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'application/octet-stream');
 r=await request('/api/items/test-report-0001/status',{method:'PATCH',headers:{cookie:admin,'content-type':'application/json'},body:JSON.stringify({status:'acknowledged'})});assert.equal(r.status,200);
 r=await request('/api/login',post({username:'partner',password:'partner-password-123'}));const partner=r.headers.get('set-cookie').split(';')[0];r=await request('/api/items',{headers:{cookie:partner}});assert.equal(r.status,403);
 r=await request('/api/items/test-report-0001/attachment',{headers:{cookie:partner}});assert.equal(r.status,403);
 r=await request('/api/items',{...post({...report,id:'test-report-0003'}),headers:{'content-type':'application/json',origin:'https://evil.example'}});assert.equal(r.status,403);
 r=await request('/api/scenario',post({water:999}));assert.equal(r.status,400);
 const names=['underpass','road','rail','station','canal','power','hospital'];const scenario={water:1.8,velocity:1.2,rainfall:15,blockage:20,gate:60,pumps:2,sandbags:false,stage:1.69,area:1.4,assets:names.map(id=>({id,name:id,status:'SAFE',depth:0}))};
 r=await request('/api/scenario',post(scenario));assert.equal(r.status,200);let stored=(await r.json()).scenario;assert.equal(stored.revision,1);r=await request('/api/scenario');assert.equal((await r.json()).assets.length,7);
 r=await request('/api/scenario/actions',post({action:'pumps',value:4}));assert.equal(r.status,401);
 r=await request('/api/scenario/actions',post({action:'pumps',value:4},admin));assert.equal(r.status,200);let acted=(await r.json()).scenario;assert.equal(acted.pumps,4);assert.equal(acted.revision,2);assert.ok(acted.stage<stored.stage);
 r=await request('/api/scenario',post({...scenario,baseRevision:1}));assert.equal(r.status,409);assert.equal((await r.json()).scenario.pumps,4);
 r=await request('/api/scenario',post({...scenario,water:5,baseRevision:2}));assert.equal(r.status,200);stored=(await r.json()).scenario;assert.equal(stored.revision,3);assert.equal(stored.water,5);assert.ok(stored.stage>acted.stage);
 r=await request('/api/scenario/actions',post({action:'clearDrain'},partner));assert.equal(r.status,403);
 r=await request('/api/scenario/actions',post({action:'siren',value:true},admin));assert.equal(r.status,200);assert.equal((await r.json()).scenario.siren,true);r=await request('/api/scenario');assert.equal((await r.json()).siren,true);
 r=await request('/api/scenario',post({...scenario,assets:[...scenario.assets.slice(0,6),scenario.assets[0]]}));assert.equal(r.status,400);
 await stop();await start();r=await request('/api/items',{headers:{cookie:admin}});items=await r.json();assert.equal(items[0].status,'acknowledged');r=await request('/api/scenario');assert.equal((await r.json()).water,5);
 r=await request('/api/users',{headers:{cookie:partner}});assert.equal(r.status,403);
 r=await request('/api/audit',{headers:{cookie:partner}});assert.equal(r.status,403);
 r=await request('/api/users',{headers:{cookie:admin}});let users=await r.json();const partnerId=users.find(u=>u.username==='partner').id;const adminId=users.find(u=>u.username==='test-admin').id;assert.equal(users.some(u=>u.password_hash||u.salt),false);
 const patch=(id,data,cookie)=>({method:'PATCH',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(data)});
 r=await request('/api/users/'+adminId,patch(adminId,{active:false},admin));assert.equal(r.status,400);
 r=await request('/api/users/'+partnerId,patch(partnerId,{role:'rescue'},admin));assert.equal(r.status,200);
 r=await request('/api/session',{headers:{cookie:partner}});assert.equal((await r.json()).user,null);
 r=await request('/api/login',post({username:'partner',password:'partner-password-123'}));assert.equal((await r.json()).user.role,'rescue');const responder=r.headers.get('set-cookie').split(';')[0];
 r=await request('/api/users/'+partnerId,patch(partnerId,{active:false},admin));assert.equal(r.status,200);r=await request('/api/items',{headers:{cookie:responder}});assert.equal(r.status,401);
 r=await request('/api/login',post({username:'partner',password:'partner-password-123'}));assert.equal(r.status,401);
 r=await request('/api/users/'+partnerId,patch(partnerId,{active:true},admin));assert.equal(r.status,200);
 r=await request('/api/users/'+partnerId,patch(partnerId,{password:'temporary-password-999'},admin));assert.equal(r.status,200);
 r=await request('/api/login',post({username:'partner',password:'temporary-password-999'}));assert.equal(r.status,200);const resetCookie=r.headers.get('set-cookie').split(';')[0];
 r=await request('/api/change-password',post({currentPassword:'incorrect',newPassword:'new-password-1234'},resetCookie));assert.equal(r.status,401);
 r=await request('/api/change-password',post({currentPassword:'temporary-password-999',newPassword:'new-password-1234'},resetCookie));assert.equal(r.status,200);
 r=await request('/api/items',{headers:{cookie:resetCookie}});assert.equal(r.status,401);
 r=await request('/api/login',post({username:'partner',password:'new-password-1234'}));assert.equal(r.status,200);
 r=await request('/api/audit',{headers:{cookie:admin}});const audit=await r.json();assert.ok(audit.some(a=>a.actor==='test-admin'&&a.action==='user.role_changed'));assert.ok(audit.some(a=>a.actor==='partner'&&a.action==='user.password_changed'));assert.equal(JSON.stringify(audit).includes('temporary-password-999'),false);
 r=await request('/api/alerts',{headers:{cookie:admin}});const existingThread=(await r.json())[0];
 r=await request('/api/alerts/'+existingThread.id+'/messages',post({message:'Administrator clarification'},admin));assert.equal(r.status,201);
 r=await request('/api/alerts/'+existingThread.id+'/messages',post({message:'Hydrology has received the task'},logins.hydrology));assert.equal(r.status,201);
 r=await request('/api/alerts/'+existingThread.id+'/messages',{headers:{cookie:admin}});assert.equal((await r.json()).messages.length,2);
 r=await request('/api/alerts/'+existingThread.id+'/messages',{headers:{cookie:logins.rescue}});assert.equal(r.status,403);
 r=await request('/api/alerts/'+existingThread.id+'/messages',post({message:'Unauthorized reply'},logins.rescue));assert.equal(r.status,403);
 const gpsSOS={id:'gps-sos-test-0001',type:'sos',createdAt:report.createdAt,description:'Simulated GPS SOS',locationStatus:'captured',gps:{latitude:24.925,longitude:86.225,accuracy:18,capturedAt:report.createdAt}};
 r=await request('/api/items',post(gpsSOS));assert.equal(r.status,201);r=await request('/api/items',post(gpsSOS));assert.equal(r.status,200);assert.equal((await r.json()).duplicate,true);
 r=await request('/api/items',post({...gpsSOS,id:'gps-sos-test-bad',gps:{...gpsSOS.gps,latitude:100}}));assert.equal(r.status,400);
 r=await request('/api/items',post({...gpsSOS,id:'gps-sos-test-status',locationStatus:'denied'}));assert.equal(r.status,400);
 r=await request('/api/items',post({id:'gps-sos-denied-001',type:'sos',createdAt:report.createdAt,description:'No location permission',gps:null,locationStatus:'denied'}));assert.equal(r.status,201);
 r=await request('/api/items',{headers:{cookie:admin}});const sosRecords=await r.json();assert.deepEqual(sosRecords.find(i=>i.id===gpsSOS.id).gps,gpsSOS.gps);
 r=await request('/api/items');assert.equal(r.status,401);
 r=await request('/api/logout',{method:'POST',headers:{cookie:admin}});assert.equal(r.status,200);r=await request('/api/items',{headers:{cookie:admin}});assert.equal(r.status,401);
});

test('existing staff databases receive the active-account migration',()=>{
 const child=require('node:child_process'), old=fs.mkdtempSync(path.join(os.tmpdir(),'riptide-migration-'));
 try{
  const create=`const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.argv[1]);db.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TEXT NOT NULL); INSERT INTO users(username,role,salt,password_hash,created_at) VALUES('existing','admin','salt','hash','2026-01-01');");db.close();`;
  child.execFileSync(process.execPath,['-e',create,path.join(old,'riptide.sqlite')],{stdio:'ignore'});
  const inspect=`require('./server.js').ready.then(async({db})=>{const u=await db.prepare("SELECT username,active FROM users WHERE username='existing'").get();if(!u||u.active!==1)process.exit(2);db.close()}).catch(()=>process.exit(3));`;
  child.execFileSync(process.execPath,['-e',inspect],{cwd:path.join(__dirname,'..'),env:{...process.env,RIPTIDE_DATA_DIR:old,VERCEL:'',TURSO_DATABASE_URL:'',RIPTIDE_ADMIN_USER:'',RIPTIDE_ADMIN_PASSWORD:''},stdio:'ignore'});
 }finally{fs.rmSync(old,{recursive:true,force:true})}
});

test('opt-in demo accounts authenticate in all five roles and stay out of normal mode',async()=>{
 const demoDir=fs.mkdtempSync(path.join(os.tmpdir(),'riptide-demo-'));
 const demoPort=port+1;let child;
 const launch=async(enabled)=>{child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:String(demoPort),RIPTIDE_DATA_DIR:demoDir,VERCEL:'',TURSO_DATABASE_URL:process.env.RIPTIDE_TEST_DRIVER==='libsql'?'file:'+path.join(demoDir,'riptide.sqlite'):'',RIPTIDE_DEMO_MODE:String(enabled),RIPTIDE_ADMIN_USER:'',RIPTIDE_ADMIN_PASSWORD:''}});await new Promise((resolve,reject)=>{let errors='';child.stderr.on('data',x=>errors+=x);child.stdout.on('data',x=>{if(x.toString().includes('listening'))resolve()});child.once('exit',code=>reject(Error('Demo server exited '+code+errors)))});};
 const shutdown=async()=>{if(child&&child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill()});child=null};
 const call=(route,opts)=>fetch(`http://127.0.0.1:${demoPort}`+route,opts);
 try{
  await launch(true);let r=await call('/api/demo-accounts');assert.equal(r.status,200);const accounts=await r.json();assert.deepEqual(accounts.map(a=>a.role),['admin','relief','hydrology','rescue','verification']);
  for(const account of accounts){r=await call('/api/login',post(account));assert.equal(r.status,200);assert.equal((await r.json()).user.role,account.role)}
  await shutdown();await launch(false);r=await call('/api/demo-accounts');assert.equal(r.status,404);r=await call('/api/session');assert.equal((await r.json()).demoMode,false);
 }finally{await shutdown();fs.rmSync(demoDir,{recursive:true,force:true})}
});
