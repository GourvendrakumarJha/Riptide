'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {JSDOM,VirtualConsole}=require('jsdom');const {indexedDB}=require('fake-indexeddb');
const ROOT=path.join(__dirname,'..');
async function until(check){for(let i=0;i<100;i++){if(check())return;await new Promise(r=>setTimeout(r,20))}throw Error('UI condition did not become true')}
test('demo picker fills credentials and all five roles open their assigned UI',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'riptide-ui-'));const port=32000+Math.floor(Math.random()*10000);const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['server.js'],{cwd:ROOT,env:{...process.env,PORT:String(port),RIPTIDE_DATA_DIR:dir,VERCEL:'',TURSO_DATABASE_URL:'',RIPTIDE_DEMO_MODE:'true',RIPTIDE_PREVIEW_COOKIES:'true'}});
 let dom,peerDom;
 try{
 await new Promise((resolve,reject)=>{child.stdout.on('data',x=>{if(x.toString().includes('listening'))resolve()});child.once('exit',code=>reject(Error('Server exited '+code)))});
 const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));
 dom=new JSDOM(fs.readFileSync(path.join(ROOT,'monitor.html'),'utf8'),{url:base+'/monitor.html',runScripts:'outside-only',virtualConsole:vc});
 const w=dom.window;let cookie='',blockCookies=false,failDirectory=false,failAlerts=false;w.indexedDB=indexedDB;
 w.fetch=async(url,opts={})=>{if(blockCookies){opts={...opts,headers:{...opts.headers}};delete opts.headers.Authorization;delete opts.headers['X-Riptide-Session']}if((url==='/api/staff-directory'&&failDirectory)||(url==='/api/alerts'&&failAlerts))return new Response(JSON.stringify({error:'Injected endpoint failure'}),{status:503,headers:{'Content-Type':'application/json'}});const r=await fetch(new URL(url,w.location.href),{...opts,headers:{...opts.headers,}});const next=r.headers.get('set-cookie');if(next)cookie=next.split(';')[0];return r};
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true};w.HTMLDialogElement.prototype.close=function(){this.open=false};w.alert=()=>{};w.confirm=()=>true;
 w.eval(fs.readFileSync(path.join(ROOT,'monitor.js'),'utf8'));
 const $=id=>w.document.getElementById(id);const authHeaders=()=>({Authorization:'Bearer '+w.sessionStorage.getItem('riptide-preview-session')});
 await until(()=>$('demoPickerButton').dataset.enabled==='true');
 assert.equal($('demoPickerButton').hidden,false);
 Object.defineProperty(w,'isSecureContext',{value:true});
 Object.defineProperty(w.navigator,'geolocation',{value:{getCurrentPosition:success=>success({coords:{latitude:24.925,longitude:86.225,accuracy:12},timestamp:Date.now()})},configurable:true});
 $('sos').click();await until(()=>$('sosHistory').textContent.includes('SENT'));assert.ok($('sosHistory').textContent.includes('24.925000'));assert.ok($('sosHistory').textContent.includes('±12 m'));
 Object.defineProperty(w.navigator,'geolocation',{value:{getCurrentPosition:(_success,fail)=>fail({code:1})},configurable:true});
 $('sos').click();assert.equal($('sosWithoutLocation').hidden,false);assert.equal($('gpsHelp').hidden,false);assert.ok($('sosMessage').textContent.includes('No SOS has been recorded yet'));assert.ok($('gpsHelp').querySelector('a').href.endsWith('/monitor.html#citizen'));$('sosWithoutLocation').click();await until(()=>$('sosHistory').querySelectorAll('.incident').length===2&&!$('sosHistory').textContent.includes('QUEUED'));assert.ok($('sosHistory').textContent.includes('denied'));
 assert.equal(w.document.querySelector('[data-view="gateway"]'),null);assert.equal($('gateway'),null);
 const cases=[['admin',[]],['relief',['broadcast']],['hydrology',['pumps','gate','sandbags','clearDrain']],['rescue',['manualReroute','siren']],['verification',[]]];
 for(const [role,actions] of cases){
 if(role==='admin'){failDirectory=true;failAlerts=true}
 $('accountButton').click();await until(()=>$('accountDialog').open);await until(()=>$('demoPickerButton').dataset.enabled==='true');$('demoPickerButton').click();
 await until(()=>w.document.querySelectorAll('.demo-account-card').length===5&&!$('demoPicker').hidden);
 const card=[...w.document.querySelectorAll('.demo-account-card')].find(c=>c.textContent.includes('demo.'+role));assert.ok(card);card.click();
 assert.equal($('loginForm').elements.username.value,'demo.'+role);assert.ok($('loginForm').elements.password.value.length>=12);
 $('loginForm').dispatchEvent(new w.Event('submit',{cancelable:true}));
 await until(()=>$('accountButton').textContent.includes('SIGN OUT')&&!$('accountDialog').open);
 assert.ok(w.sessionStorage.getItem('riptide-preview-session'),'Embedded-preview login should retain its session even without cookies');await until(()=>$('workspaceSession').dataset.confirmed==='true');assert.ok($('workspaceSession').textContent.includes('demo.'+role));assert.equal(w.location.pathname,'/workspace/'+role);const page=await w.fetch('/workspace/'+role,{headers:authHeaders()});assert.equal(page.status,200);assert.ok((await page.text()).includes('workspace-tool-dock'));const wrong=await w.fetch('/workspace/'+(role==='admin'?'relief':'admin'),{redirect:'manual',headers:authHeaders()});assert.equal(wrong.status,302);
 if(role==='admin'){
  await until(()=>$('recipientRetry').hidden===false);assert.equal($('alertRecipient').disabled,true);assert.ok($('recipientHelp').textContent.includes('Could not load recipients'));
  failDirectory=false;$('recipientRetry').click();await until(()=>$('alertRecipient').options.length===5);
  assert.equal($('alertRecipient').disabled,false,'Dropdown must load even while alerts endpoint fails');assert.equal($('recipientRetry').hidden,true);failAlerts=false;
 }
 if(role==='admin'){assert.equal($('admin').hidden,false);assert.equal(w.document.querySelector('[data-view="response"]').hidden,false)}else{
 assert.equal($(role+'-workspace').hidden,false);assert.equal($('operator').hidden,true);assert.ok($(role+'-tools').contains($('roleDashboard')));assert.ok($('operatorRole').textContent.includes('workspace'));
 assert.equal(w.document.querySelector('[data-view="response"]').hidden,true);
 assert.deepEqual([...w.document.querySelectorAll('[data-action]')].filter(b=>!b.closest('label').hidden).map(b=>b.dataset.action).sort(),actions.sort());
 assert.equal($('roleWorkPanel').hidden,role==='hydrology');assert.equal($('operatorReports').hidden,!['verification','rescue'].includes(role));await until(()=>$('operatorMap').children.length===7);$('operatorMap').click();assert.equal($('accountDialog').open,false);
 }
 await until(()=>$('alertRecipient').options.length===5);
 const recipient=$('alertRecipient'),option=recipient.options[1];
 assert.equal(recipient.tagName,'SELECT');assert.equal(recipient.hidden,false);assert.equal(recipient.disabled,false);assert.equal(recipient.required,true);assert.equal($('recipientSearch'),null);assert.equal($('recipientPicker'),null);
 recipient.value=option.value;recipient.dispatchEvent(new w.Event('change'));recipient.focus();
 assert.equal($('recipientSelection').textContent,option.dataset.fullName);
 await new Promise(resolve=>setTimeout(resolve,4200));
 assert.equal(recipient.options[1],option,'Background refresh must not rebuild an active dropdown');assert.equal(recipient.value,option.value);recipient.blur();
 $('alertForm').elements.message.value='Recipient picker selection test';$('alertForm').dispatchEvent(new w.Event('submit',{cancelable:true}));await until(()=>$('alertMessage').textContent.includes('Alert delivered'));
 const alerts=await w.fetch('/api/alerts',{headers:authHeaders()});assert.ok((await alerts.json()).some(a=>a.message==='Recipient picker selection test'&&a.recipient_id===Number(option.value)));

 if(role==='admin'){
  // Separate browser-like session: verify actual receiving, reply and task acknowledgement.
  const sent=(await (await w.fetch('/api/alerts',{headers:authHeaders()})).json()).find(a=>a.message==='Recipient picker selection test');
  const passwords={'demo.hydrology':'Demo-Hydrology-2026!','demo.relief':'Demo-Relief-2026!','demo.rescue':'Demo-Rescue-2026!','demo.verification':'Demo-Verify-2026!'};
  const peerLogin=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:sent.recipient_name,password:passwords[sent.recipient_name]})});assert.equal(peerLogin.status,200);const peerToken=(await peerLogin.json()).previewSessionToken;
  peerDom=new JSDOM(fs.readFileSync(path.join(ROOT,'monitor.html'),'utf8'),{url:base+'/monitor.html',runScripts:'outside-only',virtualConsole:vc});const peer=peerDom.window;peer.indexedDB=indexedDB;peer.sessionStorage.setItem('riptide-preview-session',peerToken);
  peer.fetch=(url,opts={})=>fetch(new URL(url,peer.location.href),opts);peer.HTMLDialogElement.prototype.showModal=function(){this.open=true};peer.HTMLDialogElement.prototype.close=function(){this.open=false};peer.alert=()=>{};peer.confirm=()=>true;
  peer.eval(fs.readFileSync(path.join(ROOT,'monitor.js'),'utf8'));
  const byId=id=>peer.document.getElementById(id);
  await until(()=>byId('staffInbox').textContent.includes('Recipient picker selection test')&&byId('workspaceSession').dataset.confirmed==='true');
  const conversation=byId('staffInbox').querySelector('[data-thread="'+sent.id+'"]');assert.ok(conversation);conversation.open=true;
  const reply=conversation.querySelector('form');reply.elements.reply.value='Hydrology confirms receipt and is preparing pumps';reply.dispatchEvent(new peer.Event('submit',{cancelable:true}));await until(()=>conversation.querySelector('.reply-status').textContent.includes('Reply saved'));
  $('messengerRefresh').click();await until(()=>$('staffSent').textContent.includes('Hydrology confirms receipt'));
  const acknowledge=[...byId('staffInbox').querySelectorAll('button')].find(b=>b.textContent==='ACKNOWLEDGE');acknowledge.click();await until(()=>byId('staffInbox').textContent.includes('MARK COMPLETED'));
  $('messengerRefresh').click();await until(()=>$('staffSent').textContent.includes('ACKNOWLEDGED'));
  assert.equal($('sessionNotice').hidden,true);assert.equal(byId('sessionNotice').hidden,true);
  peerDom.window.close();peerDom=null;
 }
 if(role==='admin'){
  w.document.querySelector('[data-go="support"]').click();
  const form=$('supportForm');form.elements.organization.value='Demo relief partner';form.elements.contact.value='demo@example.invalid';form.elements.description.value='Request 40 supply kits for the demo shelter';
  form.dispatchEvent(new w.Event('submit',{cancelable:true}));
  await until(()=>$('supportMessage').textContent.includes('Support record saved'));
  assert.ok($('supportList').textContent.includes('Demo relief partner'));assert.ok($('supportList').textContent.includes('Request 40 supply kits'));
  const saved=await w.fetch('/api/items',{headers:authHeaders()});assert.ok((await saved.json()).some(i=>i.type==='support'&&i.organization==='Demo relief partner'));
  w.document.querySelector('[data-go="operator"]').click();
 }
 // Reproduce embedded-preview cookie loss across multiple polling cycles.
 const destination=w.location.pathname;blockCookies=true;
 await new Promise(resolve=>setTimeout(resolve,4500));
 assert.equal(w.location.pathname,destination,'Background 401 must not quit the workspace');
 assert.equal($(role==='admin'?'admin':role+'-workspace').hidden,false);
 assert.equal($('sessionNotice').hidden,false);
 blockCookies=false;$('messengerRefresh').click();
 await until(()=>$('sessionNotice').hidden&&$('workspaceSession').dataset.confirmed==='true');
 assert.equal(w.location.pathname,destination);
 $('accountButton').click();await until(()=>$('accountButton').textContent==='STAFF SIGN IN');
 }
 assert.deepEqual(errors,[]);
 }finally{peerDom?.window.close();dom?.window.close();if(child.exitCode===null)await new Promise(resolve=>{child.once('exit',resolve);child.kill()});fs.rmSync(dir,{recursive:true,force:true})}
});
