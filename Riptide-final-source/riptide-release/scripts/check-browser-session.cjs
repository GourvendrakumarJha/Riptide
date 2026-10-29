'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process');const {chromium}=require('playwright');
(async()=>{
 const root=path.join(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'riptide-browser-'));const port=43000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,PORT:String(port),RIPTIDE_DATA_DIR:dir,VERCEL:'',TURSO_DATABASE_URL:process.argv.includes('--libsql')?'file:'+path.join(dir,'browser.sqlite'):'',RIPTIDE_DEMO_MODE:'true',RIPTIDE_PREVIEW_COOKIES:'false',RIPTIDE_ADMIN_USER:'',RIPTIDE_ADMIN_PASSWORD:''}});
 let browser;const errors=[];let sessionHeaderRequests=0,strippedAuthorization=0,largestRequest=0;
 try{
  await new Promise((resolve,reject)=>{child.stdout.on('data',x=>{if(x.toString().includes('listening'))resolve()});child.once('exit',code=>reject(Error('Server exited '+code)))});
  browser=await chromium.launch({...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--no-zygote','--single-process','--use-angle=swiftshader'],headless:true});
  async function client(){
   const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:900}});
   await context.route('http://host.test/**',route=>route.fulfill({contentType:'text/html',body:'<iframe title="Embedded Riptide" src="http://riptide.test/monitor.html" style="width:100%;height:850px;border:0"></iframe>'}));
   await context.route('http://riptide.test/**',async route=>{
    const req=route.request();largestRequest=Math.max(largestRequest,req.postDataBuffer()?.length||0);const url=new URL(req.url()),headers={...req.headers()};
    // Reproduce embedded preview: cookies unavailable, Authorization consumed by gateway.
    if(headers.authorization)strippedAuthorization++;delete headers.authorization;delete headers.cookie;delete headers.host;delete headers['content-length'];delete headers.connection;
    if(headers.origin)headers.origin=base;
    if(headers['x-riptide-session'])sessionHeaderRequests++;
    const response=await fetch(base+url.pathname+url.search,{method:req.method(),headers,...(!['GET','HEAD'].includes(req.method())?{body:req.postDataBuffer()}:{}),redirect:'manual'});
    const forwarded={...Object.fromEntries(response.headers)};for(const key of ['set-cookie','content-length','content-encoding','transfer-encoding'])delete forwarded[key];
    await route.fulfill({status:response.status,headers:forwarded,body:Buffer.from(await response.arrayBuffer())});
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto('http://host.test/');const frame=page.frameLocator('iframe');await frame.locator('#accountButton').waitFor();return {context,page,frame};
  }
  async function signIn(client,username){const f=client.frame;await f.locator('#accountButton').click();await f.locator('#demoPickerButton').click();await f.locator('.demo-account-card').filter({hasText:username}).click();await f.locator('#loginForm button[type=submit]').click();await f.locator('#workspaceSession[data-confirmed=true]').waitFor();assert.match(await f.locator('#workspaceSession').textContent(),new RegExp(username));}
  const admin=await client(),hydrology=await client();await signIn(admin,'demo.admin');await signIn(hydrology,'demo.hydrology');
  const select=admin.frame.locator('#alertRecipient');await select.locator('option').filter({hasText:'demo.hydrology'}).waitFor({state:'attached'});
  const target=await select.locator('option').filter({hasText:'demo.hydrology'}).getAttribute('value');
  await select.selectOption(target);const text='Browser gateway regression task '+Date.now();await admin.frame.locator('#alertForm textarea').fill(text);await admin.frame.locator('#alertForm button.primary').click();
  await admin.frame.locator('#alertMessage').filter({hasText:'Alert delivered'}).waitFor();
  const received=hydrology.frame.locator('#staffInbox .incident').filter({hasText:text});await received.waitFor();await received.locator('summary').click();await received.locator('.reply-form textarea').fill('Hydrology confirms the task and replies from a separate session');await received.locator('.reply-form button').click();await received.locator('.reply-status').filter({hasText:'Reply saved'}).waitFor();
  const sent=admin.frame.locator('#staffSent .incident').filter({hasText:text});await sent.locator('.thread-messages').filter({hasText:'Hydrology confirms'}).waitFor();
  await received.getByRole('button',{name:'ACKNOWLEDGE',exact:true}).click();await sent.filter({hasText:'ACKNOWLEDGED'}).waitFor();
  // Real polling over more than two verification cycles, not just immediate login.
  await admin.page.waitForTimeout(32000);
  for(const c of [admin,hydrology]){assert.equal(await c.frame.locator('#sessionNotice').isVisible(),false);assert.equal(await c.frame.locator('#workspaceSession').getAttribute('data-confirmed'),'true');}
  // Reload embedded page: sessionStorage restores authentication without cookies.
  await hydrology.page.reload();await hydrology.frame.locator('#workspaceSession[data-confirmed=true]').waitFor();await hydrology.frame.locator('#staffInbox').filter({hasText:text}).waitFor();
  // Preserve full-size evidence on serverless hosting: browser uploads and downloads in chunks.
  const evidence=Buffer.alloc(5*1024*1024,19);Buffer.from([137,80,78,71,13,10,26,10]).copy(evidence);
  await hydrology.frame.locator('[data-view="citizen"]').click();
  await hydrology.frame.locator('#reportForm input[name=location]').fill('Browser evidence site');
  await hydrology.frame.locator('#reportForm textarea').fill('Full-size browser evidence '+text);
  await hydrology.frame.locator('#reportForm input[type=file]').setInputFiles({name:'five-megabytes.png',mimeType:'image/png',buffer:evidence});
  await hydrology.frame.locator('#reportForm button[type=submit]').click();
  await admin.frame.locator('[data-view="response"]').click();
  const incident=admin.frame.locator('#incidentList .incident').filter({hasText:'Full-size browser evidence '+text});await incident.waitFor({timeout:30000});
  const downloadPromise=admin.page.waitForEvent('download');await incident.getByRole('link',{name:'DOWNLOAD ATTACHMENT'}).click();const download=await downloadPromise;assert.equal(download.suggestedFilename(),'five-megabytes.png');assert.deepEqual(fs.readFileSync(await download.path()),evidence);
  assert.ok(largestRequest<4_500_000,'All browser API payloads must fit under the serverless request limit');
  assert.ok(sessionHeaderRequests>0);assert.ok(strippedAuthorization>0);assert.deepEqual(errors,[]);
  console.log('PASS: two embedded Chromium sessions; no cookies; Authorization stripped; recipient selection, task, reply, acknowledgement, 32s polling, reload persistence and a complete 5 MiB evidence upload/download.');
 }finally{await browser?.close();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill()});fs.rmSync(dir,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
