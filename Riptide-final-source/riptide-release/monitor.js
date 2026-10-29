'use strict';
const $=id=>document.getElementById(id);let scenario=null,items=[],pendingSupport=[],flushing=false,currentUser=null;let authGeneration=0,reauthRequired=false,authRequestSequence=0,lastAuthSuccess=0;
// Embedded previews may block cookies. Preview-only bearer access uses the
// same expiring/revocable server session, never a client-side role override.
let previewSessionToken='';
try{previewSessionToken=sessionStorage.getItem('riptide-preview-session')||''}catch(e){}
function storePreviewToken(token){previewSessionToken=token||'';try{if(token)sessionStorage.setItem('riptide-preview-session',token);else sessionStorage.removeItem('riptide-preview-session')}catch(e){}}
async function apiFetch(path,options={}){
 if(path==='/api/items'&&options.method==='POST'&&typeof options.body==='string'){const item=JSON.parse(options.body);if(item.media?.data?.length>2_000_000){item.media=await uploadEvidence(item.media);options={...options,body:JSON.stringify(item)}}}
 const headers={...options.headers};
 if(previewSessionToken&&new URL(path,location.href).origin===location.origin){headers['X-Riptide-Session']=previewSessionToken;headers.Authorization='Bearer '+previewSessionToken;}
 return fetch(path,{credentials:'same-origin',...options,headers});
}
const roleLabels={admin:'Administrator',relief:'Relief and Resource Coordinator',hydrology:'Hydrology Expert',rescue:'Rescue Initiator',verification:'Reports and Data Verification Specialist'};
const roleActions={admin:['pumps','gate','sandbags','clearDrain','manualReroute','siren','broadcast'],hydrology:['pumps','gate','sandbags','clearDrain'],rescue:['manualReroute','siren'],relief:['broadcast'],verification:[]};
const workspaceRoutes={admin:'admin',relief:'relief-workspace',hydrology:'hydrology-workspace',rescue:'rescue-workspace',verification:'verification-workspace'};
const pageRole=location.pathname.match(/^\/workspace\/(admin|relief|hydrology|rescue|verification)$/)?.[1];const requestedWorkspace=new URLSearchParams(location.search).get('workspace');const initialView=pageRole?workspaceRoutes[pageRole]:location.hash.slice(1);let sessionRestored=false;
const views={operator:['STAFF WORKSPACE','Your operational workspace.','Role-assigned controls and targeted coordination.'],overview:['OVERALL SCENARIO','The complete picture.','Simulated flood status.'],citizen:['CITIZEN PORTAL','Your community, connected.','Reports, alerts and shelters.'],response:['RESPONSE PORTAL','Coordinate the response.','Reports and infrastructure status.'],support:['EXTERNAL SUPPORT','Stronger together.','Requests and offers of aid.'],admin:['ADMINISTRATION','Staff & activity.','Manage individual accounts and review operator actions.']};
function sessionWarning(sequence=++authRequestSequence){
 if(!currentUser||sequence<lastAuthSuccess)return;
 reauthRequired=true;setWorkspaceConfirmation(false);$('sessionNotice').hidden=false;$('accountButton').textContent='SIGN IN AGAIN';
}
function setWorkspaceConfirmation(confirmed){const el=$('workspaceSession');el.hidden=!currentUser;if(!currentUser)return;el.dataset.confirmed=confirmed===null?'pending':String(confirmed);el.textContent=(confirmed===null?'VERIFYING WORKSPACE':confirmed?'WORKSPACE CONFIRMED':'WORKSPACE RECONNECT REQUIRED')+' · '+currentUser.username+' · '+roleLabels[currentUser.role];}
function confirmWorkspaceSession(sequence=++authRequestSequence){if(!currentUser)return;lastAuthSuccess=Math.max(lastAuthSuccess,sequence);reauthRequired=false;$('sessionNotice').hidden=true;$('accountButton').textContent='SIGN OUT · '+currentUser.username.toUpperCase();setWorkspaceConfirmation(true);}
async function verifyWorkspaceSession(){if(!currentUser)return;const generation=authGeneration,sequence=++authRequestSequence;try{const response=await apiFetch('/api/session',{cache:'no-store'});const data=await response.json();if(generation!==authGeneration)return;if(response.ok&&data.user?.username===currentUser.username)confirmWorkspaceSession(sequence);else sessionWarning(sequence)}catch(e){if(generation!==authGeneration||!currentUser)return;$('workspaceSession').textContent='CONNECTION UNAVAILABLE · '+currentUser.username+' · workspace retained';}}
function acceptUser(user){if(!user)storePreviewToken('');authGeneration++;currentUser=user;reauthRequired=false;$('sessionNotice').hidden=true;setWorkspaceConfirmation(null);}
function showView(name){
 if(name==='operator')name=currentUser?.role==='admin'?'admin':workspaceRoutes[currentUser?.role]||'overview';
 const requestedRole=Object.keys(workspaceRoutes).find(role=>workspaceRoutes[role]===name);
 if(requestedRole&&currentUser?.role!==requestedRole)name='overview';
 if(['admin','response','support'].includes(name)&&currentUser?.role!=='admin')name='overview';
 const roleView=Object.values(workspaceRoutes).includes(name)&&currentUser;
 if(!views[name]&&!roleView)name='overview';
 const info=roleView?[roleLabels[currentUser.role].toUpperCase(),roleLabels[currentUser.role]+' workspace','Your role-specific tools and operational records.']:views[name];
 document.querySelectorAll('.view').forEach(v=>v.hidden=v.id!==name);
 document.querySelectorAll('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===name||(b.dataset.view==='operator'&&roleView)));
 $('viewLabel').textContent=info[0];$('pageTitle').textContent=info[1];$('pageSubtitle').textContent=info[2];
 const path=roleView?'/workspace/'+currentUser.role:'/monitor.html#'+name;history.replaceState(null,'',path);
 document.body.dataset.workspace=roleView?currentUser.role:'';
 if(name==='admin')refreshAdmin();$('sos').hidden=!['citizen','overview'].includes(name);$('scenario-strip').hidden=name==='overview';
}

document.querySelectorAll('.nav-item').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)));showView(initialView);
const openDB=()=>new Promise((resolve,reject)=>{const r=indexedDB.open('riptide-outbox',2);r.onupgradeneeded=()=>{for(const name of ['outbox','sosHistory'])if(!r.result.objectStoreNames.contains(name))r.result.createObjectStore(name,{keyPath:'id'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
async function outbox(op,value,storeName='outbox'){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(storeName,op==='getAll'?'readonly':'readwrite');const store=tx.objectStore(storeName);const request=op==='getAll'?store.getAll():op==='put'?store.put(value):store.delete(value);tx.oncomplete=()=>{db.close();resolve(request.result)};tx.onerror=()=>{db.close();reject(tx.error)}})}
function id(){return crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2)}
async function enqueue(item){await outbox('put',item);await queueCount();flush()}
async function queueCount(){try{const queued=await outbox('getAll');pendingSupport=queued.filter(i=>i.type==='support').map(i=>({...i,status:'queued'}));renderItems();$('queueStatus').textContent='QUEUE: '+queued.length;const list=$('outboxList');list.replaceChildren();if(!queued.length){const p=document.createElement('p');p.className='muted';p.textContent='No queued items.';list.append(p)}queued.forEach(item=>{const row=document.createElement('div');row.className='incident';const description=document.createElement('span');description.textContent=item.type.toUpperCase()+' · '+(item.queueError?'Needs attention: '+item.queueError:'Waiting to send');const remove=document.createElement('button');remove.className='text-button';remove.textContent='DISCARD';remove.addEventListener('click',async()=>{if(confirm('Discard this unsent item from this device?')){await outbox('delete',item.id);if(item.type==='sos')await saveSOSHistory(item,'discarded');await queueCount()}});row.append(description,document.createElement('br'),remove);list.append(row)})}catch(e){$('queueStatus').textContent='QUEUE UNAVAILABLE'}}
async function flush(){if(flushing||!navigator.onLine)return;flushing=true;try{for(const item of await outbox('getAll')){const r=await apiFetch('/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});if(r.ok){if(item.type==='sos')await saveSOSHistory(item,'sent');await outbox('delete',item.id);continue}if(r.status===400||r.status===413||r.status===415||r.status===409){let message='Server rejected this item';try{message=(await r.json()).error||message}catch(e){}item.queueError=message;await outbox('put',item);if(item.type==='sos')await saveSOSHistory(item,'needs_attention');continue}break}await queueCount();await refreshItems()}catch(e){console.warn('Outbox waiting for connection',e)}finally{flushing=false}}
function makeItem(type,fields){return {id:id(),type,createdAt:new Date().toISOString(),...fields}}
let sosRequest=0,sosBusy=false;
function gpsDetails(item){
 const box=document.createElement('div');
 if(item.gps){const g=item.gps;const text=document.createElement('p');text.textContent=`GPS: ${g.latitude.toFixed(6)}, ${g.longitude.toFixed(6)} · accuracy ±${Math.round(g.accuracy)} m · captured ${new Date(g.capturedAt).toLocaleString()}`;
 const link=document.createElement('a');link.href='https://www.openstreetmap.org/?mlat='+encodeURIComponent(g.latitude)+'&mlon='+encodeURIComponent(g.longitude)+'#map=16/'+encodeURIComponent(g.latitude)+'/'+encodeURIComponent(g.longitude);link.target='_blank';link.rel='noopener noreferrer';link.textContent='OPEN GPS LOCATION ON MAP ↗';box.append(text,link);
 }else{box.textContent='GPS not available · '+(item.locationStatus||'not recorded').replaceAll('_',' ')}return box;
}
async function saveSOSHistory(item,delivery){await outbox('put',{...item,delivery,deliveryUpdatedAt:new Date().toISOString()},'sosHistory');await renderSOSHistory()}
async function renderSOSHistory(){
 try{const records=await outbox('getAll',undefined,'sosHistory');const target=$('sosHistory');target.replaceChildren();if(!records.length)target.textContent='No SOS records on this device.';
 records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).forEach(item=>{const entry=document.createElement('div');entry.className='incident';const title=document.createElement('strong');title.textContent='SIMULATED SOS · '+item.delivery.replaceAll('_',' ').toUpperCase();const meta=document.createElement('p');meta.textContent=item.id+' · '+new Date(item.createdAt).toLocaleString();entry.append(title,meta,gpsDetails(item));if(item.queueError){const error=document.createElement('p');error.textContent=item.queueError;entry.append(error)}if(['sent','discarded'].includes(item.delivery)){const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='REMOVE DEVICE COPY';remove.onclick=async()=>{await outbox('delete',item.id,'sosHistory');await renderSOSHistory()};entry.append(document.createElement('br'),remove)}target.append(entry)});
 }catch(e){$('sosHistory').textContent='Device SOS history unavailable. Check browser storage.'}
}
async function recordSOS(gps,locationStatus){
 const item=makeItem('sos',{description:'Simulated SOS. No real emergency service has been notified.',gps,locationStatus});
 try{
 // Save queue and device record together so neither claims success without persistence.
 const db=await openDB();await new Promise((resolve,reject)=>{const tx=db.transaction(['outbox','sosHistory'],'readwrite');tx.objectStore('outbox').put(item);tx.objectStore('sosHistory').put({...item,delivery:'queued'});tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}});
 $('sosMessage').textContent='SOS recorded on this device'+(gps?' with GPS':' without GPS')+'. Delivery status is shown below. Demo only; no real emergency service was contacted.';await renderSOSHistory();await queueCount();flush();
 }catch(e){$('sosMessage').textContent='SOS could not be saved. Check device storage. For real danger call local emergency services.'}
 finally{sosBusy=false;$('sos').disabled=false;$('sosWithoutLocation').hidden=true}
}
$('sos').addEventListener('click',()=>{
 if(sosBusy)return;showView('citizen');$('gpsHelp').hidden=true;delete $('sosWithoutLocation').dataset.reason;sosBusy=true;const request=++sosRequest;$('sos').disabled=true;$('sosWithoutLocation').hidden=false;$('sosMessage').textContent='Requesting GPS permission… You can send without location at any time.';
 const fail=status=>{if(request!==sosRequest)return;sosBusy=false;$('sos').disabled=false;$('sosWithoutLocation').dataset.reason=status;$('sosMessage').textContent=status==='denied'?'Location access was blocked by the browser. No SOS has been recorded yet. Open the app in a new tab and allow Location, or send without location.':'GPS '+status+'. No SOS has been recorded yet. Retry SOS or choose Send without location.';
 $('gpsHelp').hidden=false;
 const policy=document.permissionsPolicy||document.featurePolicy;
 const embeddedBlocked=policy&&typeof policy.allowsFeature==='function'&&!policy.allowsFeature('geolocation');
 $('gpsHelpText').textContent=embeddedBlocked?'This embedded page is not allowed to use geolocation by the browser’s Permissions Policy. Open the SOS page in a new tab to request access directly.':status==='denied'?'Your site permission, browser privacy settings, or embedded-preview policy refused location access. The app cannot bypass this restriction.':status==='insecure'?'Geolocation requires HTTPS (or localhost). Open the HTTPS live preview.':status==='timeout'?'The device did not return a location within 15 seconds. Move somewhere with a better signal and try again.':'Check browser and device location settings. You can record an SOS without coordinates.'};
 if(!window.isSecureContext){fail('insecure');return}if(!navigator.geolocation){fail('unsupported');return}
 navigator.geolocation.getCurrentPosition(position=>{if(request!==sosRequest)return;const c=position.coords;recordSOS({latitude:c.latitude,longitude:c.longitude,accuracy:c.accuracy,capturedAt:new Date(position.timestamp).toISOString()},'captured')},error=>fail(error.code===1?'denied':error.code===3?'timeout':'unavailable'),{enableHighAccuracy:true,timeout:15000,maximumAge:0});
});
$('sosWithoutLocation').addEventListener('click',()=>{++sosRequest;sosBusy=true;$('sos').disabled=true;$('sosWithoutLocation').hidden=true;recordSOS(null,$('sosWithoutLocation').dataset.reason||'without_location')});
renderSOSHistory();

$('reportForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget,file=f.elements.media.files[0];if(file&&file.size>5*1024*1024){$('reportMessage').textContent='Attachment exceeds 5 MB.';return}try{let media=null;if(file)media=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve({name:file.name,data:reader.result});reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});await enqueue(makeItem('report',{location:f.elements.location.value.trim(),description:f.elements.description.value.trim(),media}));f.reset();$('reportMessage').textContent='Saved on this device. It will be submitted to the demo server when reachable.'}catch(err){$('reportMessage').textContent='Could not save report. Check device storage and try again.'}});
$('supportForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,button=f.querySelector('button[type="submit"],button:not([type])');
 const item=makeItem('support',{kind:f.elements.kind.value,organization:f.elements.organization.value.trim(),contact:f.elements.contact.value.trim(),description:f.elements.description.value.trim()});
 button.disabled=true;
 try{
  await adminFetch('/api/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(item)});
  // Show the accepted record immediately, even if the list refresh is delayed.
  items=[{...item,status:'new',receivedAt:new Date().toISOString()},...items.filter(i=>i.id!==item.id)];renderItems();f.reset();
  $('supportMessage').textContent='Support record saved. It is listed in Support requests & offers. No organization was contacted.';
  await refreshItems();
 }catch(err){
  if(err instanceof TypeError){try{await enqueue(item);f.reset();$('supportMessage').textContent='Saved on this device and listed as pending delivery. It will retry when connected.'}catch(e){$('supportMessage').textContent='Could not save the record on this device.'}}
  else $('supportMessage').textContent=err.message||'Could not save the support record.';
 }finally{button.disabled=false}
});

function row(label,value){const div=document.createElement('div');div.className='info-row';const a=document.createElement('span'),b=document.createElement('b');a.textContent=label;b.textContent=value;div.append(a,b);return div}
function setControl(id,value){const el=$(id);if(document.activeElement!==el)el.value=String(value)}
function renderScenario(s){if(!s)return;renderStaffMap(s);scenario=s;renderRoleFacts(s);$('syncStatus').textContent='● SCENARIO SYNCED';const stage=Number(s.stage||0),a=Array.isArray(s.assets)?s.assets:[];const blocked=a.filter(x=>x.status==='BLOCKED').length;let risk=stage>=4.5||blocked>=2?'CRITICAL':stage>=3||a.some(x=>x.status!=='SAFE')?'WARNING':stage>=2.2||s.rainfall>=40?'ADVISORY':'NORMAL';$('risk').textContent=risk;$('riskDetail').textContent='Simulated scenario · '+(s.updatedAt?new Date(s.updatedAt).toLocaleTimeString():'baseline');$('stage').textContent=stage.toFixed(2)+' m';$('rainfall').textContent=s.rainfall+' mm/h';$('area').textContent=Number(s.area||0).toFixed(1)+' km²';setControl('mitigationPumps',s.pumps);setControl('mitigationGate',s.gate);setControl('mitigationSandbags',s.sandbags);setControl('mitigationReroute',!!s.manualReroute);setControl('mitigationSiren',!!s.siren);setControl('mitigationBroadcast',!!s.broadcast);$('managementState').replaceChildren(row('Traffic diversion',s.manualReroute?'MANUAL':'AUTOMATIC'),row('Simulated siren',s.siren?'ACTIVE':'OFF'),row('Simulated broadcast',s.broadcast?'ISSUED':'NOT ISSUED'));$('citizenAlert').textContent=`${risk}: simulated water stage is ${stage.toFixed(2)} m. ${s.broadcast?'A simulated warning has been issued.':''}`;const snap=$('snapshot'),response=$('responseAssets');snap.replaceChildren();response.replaceChildren();a.forEach(x=>{snap.append(row(x.name,x.status+' · '+Number(x.depth).toFixed(2)+' m'));response.append(row(x.name,x.status))});const p=$('priorities');p.replaceChildren();(risk==='NORMAL'?['Maintain readiness and check drainage.','Review community communication plans.','Keep response resources prepared.']:['Review impacted transport corridors.','Assess simulated citizen reports and shelter needs.','Coordinate drainage, rescue and support resources.']).forEach((x,i)=>p.append(row('0'+(i+1),x)))}
function renderItems(){for(const [id,filter] of [['incidentList',i=>i.type!=='support'],['supportList',i=>i.type==='support']]){const target=$(id);target.replaceChildren();const visible=id==='supportList'?[...pendingSupport.filter(q=>!items.some(i=>i.id===q.id)),...items]:items;const list=visible.filter(filter);if(!list.length){const p=document.createElement('p');p.className='muted';p.textContent='No submitted items yet.';target.append(p)}list.forEach(i=>{const div=document.createElement('div');div.className='incident';const title=document.createElement('strong');title.textContent=i.type==='sos'?'SIMULATED SOS':i.type==='report'?'CITIZEN REPORT · '+i.location:i.kind+' · '+i.organization;const p=document.createElement('p');p.textContent=i.description;const small=document.createElement('small');small.textContent=new Date(i.createdAt).toLocaleString()+(i.contact?' · '+i.contact:'');div.append(title,p,small);if(i.type==='sos')div.append(gpsDetails(i));if(i.hasMedia){const link=document.createElement('a');link.href='/api/items/'+encodeURIComponent(i.id)+'/attachment';link.textContent='DOWNLOAD ATTACHMENT ↓';div.append(document.createElement('br'),link)}const status=document.createElement('small');status.textContent=' · STATUS: '+(i.status||'new').toUpperCase();div.append(status);if(i.status!=='resolved'&&i.status!=='queued'&&['admin','verification'].includes(currentUser?.role)){const action=document.createElement('button');action.className='text-button';action.textContent=i.status==='new'?'ACKNOWLEDGE':'RESOLVE';action.addEventListener('click',async()=>{try{const r=await apiFetch('/api/items/'+encodeURIComponent(i.id)+'/status',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:i.status==='new'?'acknowledged':'resolved'})});if(!r.ok)throw Error();await refreshItems()}catch(e){alert('Unable to update status. Check your connection and permissions.')}});div.append(document.createElement('br'),action)}target.append(div)})}if(currentUser&&['verification','rescue'].includes(currentUser.role)){$('operatorIncidents').replaceChildren(...Array.from($('incidentList').children).map(n=>n.cloneNode(true)));$('operatorIncidents').querySelectorAll('button').forEach((b,i)=>b.addEventListener('click',()=>$('incidentList').querySelectorAll('button')[i].click()))}}
async function refreshItems(){
 if(!currentUser)return;const generation=authGeneration,sequence=++authRequestSequence;
 try{const r=await apiFetch('/api/items',{cache:'no-store',credentials:'same-origin'});if(generation!==authGeneration)return;
 $('connection').textContent='● SERVER CONNECTED';
 if(r.status===401){items=[];renderItems();sessionWarning(sequence);return}
 if(r.status===403){items=[];renderItems();return}
 if(!r.ok)throw Error();const data=await r.json();if(generation!==authGeneration)return;items=data;renderItems();
 }catch(e){$('connection').textContent='● OFFLINE / SERVER UNAVAILABLE'}
}

function updateAccount(){$('accountButton').textContent=currentUser?'SIGN OUT · '+currentUser.username.toUpperCase():'STAFF SIGN IN';$('passwordButton').hidden=!currentUser;const isAdmin=currentUser?.role==='admin';configureWorkspace();document.querySelectorAll('[data-view="response"],[data-view="support"]').forEach(b=>b.hidden=!isAdmin);$('operatorNav').hidden=!currentUser;if(!isAdmin&&(!$('response').hidden||!$('support').hidden))showView(currentUser?'operator':'overview');if(!currentUser&&document.body.dataset.workspace)showView('overview');$('adminNav').hidden=!isAdmin;if(!isAdmin){$('staffList').replaceChildren();$('auditList').replaceChildren();$('createUserForm').reset();$('createUserMessage').textContent='';if(!$('admin').hidden)showView('overview')}if(!currentUser){$('passwordForm').reset();if($('passwordDialog').open)$('passwordDialog').close()}}
async function refreshSession(){const generation=authGeneration;try{const r=await apiFetch('/api/session',{cache:'no-store'});if(r.ok){const data=await r.json();if(generation!==authGeneration)return;if(currentUser&&!data.user){sessionWarning();return}acceptUser(data.user);$('demoPickerButton').hidden=false;$('demoPickerButton').dataset.enabled=String(!!data.demoMode);$('demoPicker').hidden=true;$('accountHelp').textContent=data.setupRequired?'No staff account is configured. Set RIPTIDE_ADMIN_USER and RIPTIDE_ADMIN_PASSWORD on the server and restart it.':'Response and partner workspaces require a staff account.';updateAccount();if(!sessionRestored){sessionRestored=true;if(currentUser)showView(['admin','response','support','operator',...Object.values(workspaceRoutes)].includes(initialView)?initialView:currentUser.role==='admin'?'admin':'operator');else if(requestedWorkspace&&roleLabels[requestedWorkspace])openRequestedWorkspace(requestedWorkspace)}}}catch(e){$('accountHelp').textContent='The server is unavailable. Reconnect to sign in.'}}
$('accountButton').addEventListener('click',async()=>{if(currentUser&&!reauthRequired){try{const response=await apiFetch('/api/logout',{method:'POST'});if(!response.ok)throw Error('Sign-out failed');acceptUser(null);updateAccount();await refreshItems()}catch(e){alert('Unable to sign out while offline.')}}else{$('loginMessage').textContent='';await refreshSession();$('accountDialog').showModal()}});
$('passwordButton').addEventListener('click',()=>{$('passwordMessage').textContent='';$('passwordDialog').showModal()});
$('closePassword').addEventListener('click',()=>$('passwordDialog').close());
$('passwordForm').addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget;try{const r=await apiFetch('/api/change-password',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({currentPassword:f.elements.currentPassword.value,newPassword:f.elements.newPassword.value})});const data=await r.json();if(!r.ok)throw Error(data.error||'Unable to change password');f.reset();$('passwordDialog').close();acceptUser(null);updateAccount();await refreshItems();alert('Password changed. Please sign in again.')}catch(e){$('passwordMessage').textContent=e.message||'Unable to reach server.'}});
$('closeAccount').addEventListener('click',()=>$('accountDialog').close());
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;try{const r=await apiFetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:f.elements.username.value,password:f.elements.password.value})});const data=await r.json().catch(()=>{throw Error('Backend unavailable. Start the Riptide server to sign in.')});if(!r.ok)throw Error(data.error||'Sign in failed');if(!data.user)throw Error('Backend unavailable. Start the Riptide server to sign in.');storePreviewToken(data.previewSessionToken||'');acceptUser(data.user);updateAccount();f.reset();$('accountDialog').close();showView(currentUser.role==='admin'?'admin':'operator');await verifyWorkspaceSession();await refreshItems()}catch(err){$('loginMessage').textContent=err.message||'Unable to sign in.'}});
async function refreshScenario(){try{const pending=localStorage.getItem('riptidePendingScenario');if(pending){renderScenario(JSON.parse(pending));$('syncStatus').textContent='● LOCAL SCENARIO PENDING';return}const r=await apiFetch('/api/scenario',{cache:'no-store'});if(!r.ok)throw Error();const s=await r.json();if(s){localStorage.setItem('riptideScenario',JSON.stringify(s));renderScenario(s)}}catch(e){$('syncStatus').textContent='● LAST SAVED SCENARIO'}}
for(let n=0;n<=100;n+=5){const option=document.createElement('option');option.value=String(n);option.textContent=n+'%';$('mitigationGate').append(option)}
document.querySelectorAll('[data-action]').forEach(button=>button.addEventListener('click',async()=>{
 const action=button.dataset.action, message=$('mitigationMessage');
 if(!currentUser||!roleActions[currentUser.role]?.includes(action)){message.textContent='Sign in with a responder or admin account to change the simulation.';message.className='form-message error';return}
 if(localStorage.getItem('riptidePendingScenario')){message.textContent='A local simulator edit is pending. Resolve its sync before applying an intervention.';message.className='form-message error';return}
 const value=action==='pumps'?Number($('mitigationPumps').value):action==='gate'?Number($('mitigationGate').value):action==='sandbags'?$('mitigationSandbags').value==='true':action==='manualReroute'?$('mitigationReroute').value==='true':action==='siren'?$('mitigationSiren').value==='true':action==='broadcast'?$('mitigationBroadcast').value==='true':undefined;
 button.disabled=true;try{const response=await apiFetch('/api/scenario/actions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,value})});const result=await response.json();if(!response.ok)throw Error(result.error||'Intervention failed');localStorage.setItem('riptideScenario',JSON.stringify(result.scenario));renderScenario(result.scenario);message.textContent='Intervention applied to the shared simulation.';message.className='form-message'}catch(e){message.textContent=e.message||'Unable to reach the server.';message.className='form-message error'}finally{button.disabled=false}
}));
async function adminFetch(path, options={}) {
 const generation=authGeneration,sequence=++authRequestSequence;const response=await apiFetch(path,{cache:'no-store',credentials:'same-origin',...options});const data=await response.json();
 if(generation!==authGeneration)throw Error('Account changed; discarded an outdated response.');
 if(response.status===401)sessionWarning(sequence);
 if(!response.ok)throw Error(data.error||'Unable to complete the request');confirmWorkspaceSession(sequence);return data;
}
function staffMessage(message,isError=false){const p=$('createUserMessage');p.textContent=message;p.className='form-message'+(isError?' error':'')}
function createStaffRow(user){
 const entry=document.createElement('div');entry.className='staff-entry';
 const title=document.createElement('div');title.className='staff-title';const name=document.createElement('strong');name.textContent=user.username+(currentUser?.username===user.username?' (you)':'');const state=document.createElement('small');state.textContent=user.active?'ACTIVE':'DISABLED';if(!user.active)state.className='disabled';title.append(name,state);entry.append(title);
 const controls=document.createElement('div');controls.className='staff-controls';const roleLabel=document.createElement('label');roleLabel.textContent='Role';const select=document.createElement('select');select.setAttribute('aria-label','Role for '+user.username);
 for(const [value,label] of Object.entries(roleLabels)){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option)}select.value=user.role;roleLabel.append(select);controls.append(roleLabel);
 const roleButton=document.createElement('button');roleButton.type='button';roleButton.className='text-button';roleButton.textContent='SAVE ROLE';roleButton.disabled=currentUser?.username===user.username;roleButton.addEventListener('click',async()=>{if(select.value===user.role)return;await changeStaff(user,{role:select.value},entry)});controls.append(roleButton);
 const toggle=document.createElement('button');toggle.type='button';toggle.className='text-button';toggle.textContent=user.active?'DISABLE':'ENABLE';toggle.disabled=currentUser?.username===user.username;toggle.addEventListener('click',async()=>{if(confirm((user.active?'Disable ':'Enable ')+user.username+'?'))await changeStaff(user,{active:!user.active},entry)});controls.append(toggle);entry.append(controls);
 const reset=document.createElement('form');reset.className='staff-controls staff-reset';const input=document.createElement('input');input.type='password';input.autocomplete='new-password';input.minLength=12;input.maxLength=256;input.required=true;input.placeholder='New password (12+ characters)';input.setAttribute('aria-label','New password for '+user.username);const button=document.createElement('button');button.className='text-button';button.textContent='RESET PASSWORD';reset.append(input,button);reset.addEventListener('submit',async event=>{event.preventDefault();if(!confirm('Reset password for '+user.username+' and sign out their sessions?'))return;const password=input.value;input.value='';await changeStaff(user,{password},entry)});entry.append(reset);return entry;
}
async function changeStaff(user,change,entry){
 let msg=entry.querySelector('.staff-message');if(!msg){msg=document.createElement('p');msg.className='staff-message';entry.append(msg)}
 try{await adminFetch('/api/users/'+encodeURIComponent(user.id),{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(change)});if(user.username===currentUser?.username&&change.password){acceptUser(null);updateAccount();await refreshItems();alert('Password changed. Please sign in again.');return}await refreshAdmin()}
 catch(e){msg.className='staff-message error';msg.textContent=e.message}
}
async function refreshAudit(){
 if(currentUser?.role!=='admin'||$('admin').hidden)return;try{const rows=await adminFetch('/api/audit');if(currentUser?.role!=='admin'||$('admin').hidden)return;const target=$('auditList');target.replaceChildren();if(!rows.length){target.textContent='No activity recorded.';return}rows.forEach(item=>{const div=document.createElement('div');div.className='audit-entry';const time=document.createElement('time');time.textContent=new Date(item.at).toLocaleString();const actor=document.createElement('strong');actor.textContent=item.actor;const event=document.createElement('span');event.textContent=item.action+' · '+item.target;div.append(time,actor,event);target.append(div)})}catch(e){if(currentUser?.role==='admin')$('auditList').textContent=e.message}
}
async function refreshAdmin(){
 if(currentUser?.role!=='admin')return;try{const users=await adminFetch('/api/users');if(currentUser?.role!=='admin')return;const target=$('staffList');target.replaceChildren();users.forEach(user=>target.append(createStaffRow(user)));await refreshAudit()}catch(e){if(currentUser?.role==='admin')$('staffList').textContent=e.message}
}
$('adminRefresh').addEventListener('click',refreshAdmin);
$('createUserForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const username=form.elements.username.value.trim(), role=form.elements.role.value, password=form.elements.password.value;if(role==='admin'&&!confirm('Grant '+username+' administrator access?'))return;try{await adminFetch('/api/users',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,role,password})});form.reset();staffMessage('Account created. Share the temporary password securely.');await refreshAdmin()}catch(e){staffMessage(e.message,true)}});
$('refresh').addEventListener('click',()=>{refreshItems();refreshScenario();flush()});window.addEventListener('online',()=>{flush();refreshScenario()});window.addEventListener('offline',()=>{$('connection').textContent='● OFFLINE / SERVER UNAVAILABLE'});window.addEventListener('storage',e=>{if(e.key==='riptideScenario'&&e.newValue)renderScenario(JSON.parse(e.newValue))});try{renderScenario(JSON.parse(localStorage.getItem('riptideScenario')))}catch(e){}renderItems();queueCount();refreshSession();refreshScenario();refreshItems();flush();setInterval(()=>{refreshScenario();refreshItems();flush()},2000);setInterval(refreshAudit,10000);

function configureWorkspace(){
 const role=currentUser?.role;
 document.querySelectorAll('.workspace-tool-dock').forEach(dock=>{while(dock.firstChild)$('operator').append(dock.firstChild)});
 $('operatorRole').textContent=(roleLabels[role]||'Staff')+' workspace';configureRoleDashboard(role);$('operatorNav').querySelector('span:nth-child(2)').textContent=roleLabels[role]||'Staff workspace';if(role){views.operator=[roleLabels[role].toUpperCase(),roleLabels[role]+' workspace', 'Your assigned tools, map and staff coordination.']}
 const scopes={admin:'Oversee all operations and send instructions to individual operators.',relief:'Coordinate relief needs and issue simulated broadcasts. Escalate supply requests to the administrator.',hydrology:'Monitor water levels and manage pumps, gates, levees and drainage.',rescue:'Review incidents, allocate simulated access routes and activate the simulated siren.',verification:'Review citizen reports and evidence, acknowledge or resolve verified reports, and alert the relevant operator.'};
 $('operatorScope').textContent=scopes[role]||'';
 // Move the existing controls rather than duplicate IDs or handlers.
 const card=$('mitigationMessage').closest('article');
 (role&&role!=='admin'?$('operatorControls'):$('response')).append(card);
 card.hidden=!role||roleActions[role].length===0;
 document.querySelectorAll('[data-action]').forEach(b=>b.closest('label').hidden=!roleActions[role]?.includes(b.dataset.action));
 $('operatorReports').hidden=!['verification','rescue'].includes(role);
 if(currentUser){const dock=$(role+'-tools');const order=['roleDashboard','operatorControls','roleWorkPanel','operatorReports','roleWorkRecords'];order.forEach(id=>{if($(id).parentElement===$('operator'))dock.append($(id))});while($('operator').firstChild)dock.append($('operator').firstChild);refreshWork();refreshStaff();if(scenario)renderStaffMap(scenario)}else{$('staffInbox').replaceChildren();delete $('staffInbox').dataset.alerts;$('staffSent').replaceChildren();delete $('staffSent').dataset.alerts;$('operatorIncidents').replaceChildren();$('alertRecipient').replaceChildren(new Option('Sign in to load recipients',''));$('alertRecipient').disabled=true;$('alertRecipient').setAttribute('aria-busy','false');$('recipientRetry').hidden=true;delete $('alertRecipient').dataset.directory;$('recipientSelection').textContent='No recipient selected.'}
}
function renderStaffMap(s){
 const map=$('operatorMap');map.replaceChildren();
 const positions=[[15,68],[36,62],[53,37],[67,27],[31,22],[77,65],[86,35]];
 (s.assets||[]).forEach((a,i)=>{const pin=document.createElement('div');pin.className='map-pin '+a.status.toLowerCase();pin.style.left=positions[i%7][0]+'%';pin.style.top=positions[i%7][1]+'%';pin.textContent=a.name+' · '+a.status+' · '+Number(a.depth).toFixed(2)+' m';map.append(pin)});
}
const recipientLoads=new Set();
async function refreshRecipients(force=false){
 if(!currentUser)return;const generation=authGeneration,username=currentUser.username;
 if(recipientLoads.has(generation))return;
 recipientLoads.add(generation);
 const select=$('alertRecipient'),hasOptions=select.options.length>1;
 if(!hasOptions){select.disabled=true;select.setAttribute('aria-busy','true');$('recipientHelp').textContent='Loading active staff accounts…'}
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
 try{
  const directory=await adminFetch('/api/staff-directory',{signal:controller.signal});
  if(generation!==authGeneration)return;
  const recipients=directory.filter(u=>u.username!==username),signature=JSON.stringify(recipients.map(u=>[u.id,u.username,u.role]));
  // An empty dropdown must load even if focused; a populated open dropdown stays stable.
  if(select.dataset.directory!==signature&&(force||!hasOptions||document.activeElement!==select)){
   const value=select.value,fragment=document.createDocumentFragment(),blank=document.createElement('option');blank.value='';blank.textContent=recipients.length?'Choose a recipient':'No other active staff accounts';fragment.append(blank);
   recipients.forEach(u=>{const option=document.createElement('option');option.value=String(u.id);option.textContent=u.username+' — '+(recipientRoleLabels[u.role]||u.role);option.dataset.fullName=(roleLabels[u.role]||u.role)+' — '+u.username;fragment.append(option)});
   select.replaceChildren(fragment);select.dataset.directory=signature;if([...select.options].some(o=>o.value===value))select.value=value;
   updateRecipientSelection();
  }
  select.disabled=recipients.length===0;select.setAttribute('aria-busy','false');$('recipientRetry').hidden=recipients.length>0;
  $('recipientHelp').textContent=recipients.length?recipients.length+' active recipients. Choose one from the dropdown.':'No other active staff accounts. Ask the administrator to create or enable an account.';
 }catch(error){
  if(generation!==authGeneration)return;
  select.setAttribute('aria-busy','false');select.disabled=!hasOptions;$('recipientRetry').hidden=false;
  if(!hasOptions){const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Recipients could not be loaded';select.replaceChildren(placeholder)}
  $('recipientHelp').textContent='Could not load recipients. '+(error.name==='AbortError'?'The request timed out.':error.message)+' Use Retry loading recipients.';
 }finally{clearTimeout(timeout);recipientLoads.delete(generation)}
}
$('recipientRetry').addEventListener('click',()=>refreshRecipients(true));
async function refreshStaff(){
 if(!currentUser)return;const username=currentUser.username;
 // Directory failure and alerts failure must not prevent each other from rendering.
 refreshRecipients();
 try{const alerts=await adminFetch('/api/alerts');if(currentUser?.username!==username)return;
 for(const [id,list] of [['staffInbox',alerts.filter(a=>a.recipient_name===username)],['staffSent',alerts.filter(a=>a.sender_name===username||currentUser.role==='admin')]]){
 const target=$(id),signature=JSON.stringify(list);if(target.dataset.alerts===signature)continue;target.dataset.alerts=signature;target.replaceChildren();if(!list.length)target.textContent='No conversations yet.';
 list.forEach(a=>{const article=document.createElement('div');article.className='incident';const title=document.createElement('strong');title.textContent='From '+a.sender_name+' ('+roleLabels[a.sender_role]+') → '+a.recipient_name+' ('+roleLabels[a.recipient_role]+')';const message=document.createElement('p');message.textContent=a.message;const detail=document.createElement('small');detail.textContent=new Date(a.created_at).toLocaleString()+' · '+a.status.toUpperCase();article.append(title,message,detail,createConversation(a,id));
 if(id==='staffInbox'&&a.status!=='completed'){const button=document.createElement('button');button.className='text-button';button.textContent=a.status==='new'?'ACKNOWLEDGE':'MARK COMPLETED';button.onclick=async()=>{try{await adminFetch('/api/alerts/'+a.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:a.status==='new'?'acknowledged':'completed'})});await refreshStaff()}catch(e){$('alertMessage').textContent=e.message}};article.append(document.createElement('br'),button)}target.append(article)});
 }
 $('messengerStatus').textContent='Messenger connected · updated '+new Date().toLocaleTimeString();
 }catch(e){$('messengerStatus').textContent='Messenger could not refresh: '+e.message}
}
$('alertForm').addEventListener('submit',async e=>{
 e.preventDefault();const f=e.currentTarget,button=f.querySelector('button.primary');if(button.disabled)return;
 if(!$('alertRecipient').value){$('alertMessage').textContent='Choose a recipient before sending the alert.';$('alertRecipient').focus();return}
 button.disabled=true;$('alertMessage').textContent='Sending…';
 try{const result=await adminFetch('/api/alerts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({recipientId:Number($('alertRecipient').value),message:f.elements.message.value})});f.elements.message.value='';$('alertMessage').textContent='Alert delivered to the selected staff inbox. Conversation #'+result.id;await refreshStaff();const thread=$('staffSent').querySelector('[data-thread="'+result.id+'"]');if(thread){thread.open=true;loadConversation(thread)}}catch(err){$('alertMessage').textContent='Not sent: '+err.message}finally{button.disabled=false}
});

setInterval(refreshStaff,4000);

$('demoPickerButton').addEventListener('click',async()=>{
 const picker=$('demoPicker');picker.hidden=!picker.hidden;if(picker.hidden)return;
 const target=$('demoAccountCards');target.textContent='Loading demo accounts…';
 try{const response=await apiFetch('/api/demo-accounts',{cache:'no-store'});if(response.status===404)throw Error('Demo autofill is not enabled on this server. Use the live demo preview, or start this server with RIPTIDE_DEMO_MODE=true.');if(!response.ok)throw Error('Demo accounts could not be loaded. Check the server connection.');const accounts=await response.json();target.replaceChildren();if(!accounts.length)target.textContent='No unchanged demo accounts are available.';
 accounts.forEach(account=>{const button=document.createElement('button');button.type='button';button.className='demo-account-card';const title=document.createElement('strong');title.textContent=roleLabels[account.role];const login=document.createElement('small');login.textContent=account.username;button.append(title,login);button.addEventListener('click',()=>{const form=$('loginForm');form.elements.username.value=account.username;form.elements.password.value=account.password;$('loginMessage').textContent='Demo credentials filled for '+roleLabels[account.role]+'. Press Sign in to continue.';picker.hidden=true;form.querySelector('[type="submit"]').focus()});target.append(button)});
 }catch(e){target.textContent=e.message}
});


document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>showView(b.dataset.go)));

const workspaceSpecs={
 admin:{kicker:'COMMAND & OVERSIGHT',title:'Administrator command workspace',description:'Manage accounts, oversee resources and rescue plans, operate all mitigation controls and coordinate every staff role.'},
 relief:{kicker:'RELIEF & RESOURCE DESK',title:'Relief distribution planner',description:'Record shelter supply allocations, track distribution progress and issue simulated community broadcasts.',form:'Plan a relief allocation',quantity:'Supply units / kits',detail:'Supplies, shelter needs and distribution instructions',submit:'SAVE RELIEF ALLOCATION'},
 hydrology:{kicker:'HYDROLOGY OPERATIONS',title:'Water & mitigation control desk',description:'Review live simulated water conditions and infrastructure depths. Operate pumps, gates, levees and drainage; send findings to rescue or administration.'},
 rescue:{kicker:'RESCUE ALLOCATION',title:'Rescue team allocation desk',description:'Review incoming SOS and blocked access, plan team assignments, set traffic diversion and activate the simulated siren.',form:'Allocate a simulated rescue team',quantity:'Number of teams',detail:'Team identifiers, mission, priority and safe access plan',submit:'SAVE TEAM ALLOCATION'},
 verification:{kicker:'REPORTS & DATA VERIFICATION',title:'Evidence verification desk',description:'Review submitted reports and attachments below. Acknowledge reports under review, resolve completed reviews and record evidence findings for escalation.',form:'Record verification findings',quantity:'Number of reports reviewed',detail:'Report IDs, evidence checked, findings and verification outcome',submit:'SAVE VERIFICATION FINDING'}
};
function configureRoleDashboard(role){
 // Called after scripts finish loading, during asynchronous session restoration.
 const spec=workspaceSpecs[role];if(!spec)return;
 $('roleKicker').textContent=spec.kicker;$('roleDashboardTitle').textContent=spec.title;$('roleDashboardDescription').textContent=spec.description;
 $('roleWorkPanel').hidden=!spec.form;$('roleWorkRecords').hidden=role==='hydrology';
 (role==='admin'?$('admin'):$('operator')).append($('roleWorkRecords'));$('roleWorkForm').reset();$('workMessage').textContent='';
 if(spec.form){$('roleWorkTitle').textContent=spec.form;$('workQuantityLabel').textContent=spec.quantity;$('workDetailLabel').textContent=spec.detail;$('workSubmit').textContent=spec.submit}
 $('incidentReviewTitle').textContent=role==='verification'?'Citizen evidence & verification queue':'SOS & incident intelligence';
 if(scenario)renderRoleFacts(scenario);
}
function renderRoleFacts(s){
 if(!currentUser)return;const role=currentUser.role,assets=s.assets||[];const facts=role==='hydrology'?[['Water stage',Number(s.stage).toFixed(2)+' m'],['Rainfall',s.rainfall+' mm/h'],['Drain blockage',s.blockage+'%'],['Pumps',s.pumps+' / 4']]:role==='rescue'?[['Blocked assets',assets.filter(a=>a.status==='BLOCKED').length],['Diversion',s.manualReroute?'Manual':'Automatic'],['Siren',s.siren?'Active':'Off']]:role==='relief'?[['Inundated area',Number(s.area).toFixed(1)+' km²'],['Hospital',assets.find(a=>a.id==='hospital')?.status||'Unknown'],['Broadcast',s.broadcast?'Issued':'Not issued']]:[['Scenario revision',s.revision||0],['Assets needing review',assets.filter(a=>a.status!=='SAFE').length]];
 $('roleFacts').replaceChildren(...facts.map(([label,value])=>row(label,value)));
}
async function refreshWork(){
 if(!currentUser)return;const username=currentUser.username;
 try{const records=await adminFetch('/api/work');if(currentUser?.username!==username)return;const target=$('workRecords');target.replaceChildren();if(!records.length)target.textContent='No saved workspace records yet.';
 records.forEach(record=>{const article=document.createElement('div');article.className='incident';const heading=document.createElement('strong');heading.textContent=record.location+' · '+roleLabels[record.role];const text=document.createElement('p');text.textContent=record.detail;const info=document.createElement('small');info.textContent=record.quantity+' units/teams/reports · '+record.actor+' · '+new Date(record.created_at).toLocaleString()+' · '+record.status.replace('_',' ').toUpperCase();article.append(heading,text,info);
 if(record.status!=='completed'){const button=document.createElement('button');button.className='text-button';button.textContent=record.status==='planned'?'START WORK':'MARK COMPLETED';button.onclick=async()=>{try{await adminFetch('/api/work/'+record.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:record.status==='planned'?'in_progress':'completed'})});await refreshWork()}catch(e){$('workMessage').textContent=e.message}};article.append(document.createElement('br'),button)}target.append(article)});
 }catch(e){$('workMessage').textContent=e.message}
}
$('roleWorkForm').addEventListener('submit',async event=>{event.preventDefault();const f=event.currentTarget;try{await adminFetch('/api/work',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:f.elements.location.value,quantity:Number(f.elements.quantity.value),detail:f.elements.detail.value})});f.reset();$('workMessage').textContent='Saved to your role workspace and administrator oversight.';await refreshWork()}catch(e){$('workMessage').textContent=e.message}});
setInterval(refreshWork,4000);

// Direct workspace links can request sign-in without a portal-selection page.
async function openRequestedWorkspace(role){
 if(!roleLabels[role]||currentUser)return;
 $('loginMessage').textContent='Sign in as '+roleLabels[role]+' to open this workspace.';
 if(!$('accountDialog').open)$('accountDialog').showModal();
 if($('demoPickerButton').dataset.enabled==='true'){$('demoPicker').hidden=true;$('demoPickerButton').click()}
}

$('reauthenticate').addEventListener('click',()=>{$('loginMessage').textContent='Sign in again to reconnect this workspace.';$('accountDialog').showModal()});

const recipientRoleLabels={admin:'Administrator',relief:'Relief & Resources',hydrology:'Hydrology Expert',rescue:'Rescue Initiator',verification:'Reports & Data Verification'};
function updateRecipientSelection(){
 const select=$('alertRecipient'),option=select.selectedOptions[0];
 $('recipientSelection').textContent=select.value?(option.dataset.fullName||option.textContent):'No recipient selected.';
 select.title=select.value?$('recipientSelection').textContent:'Choose a recipient';
}
$('alertRecipient').addEventListener('change',()=>{updateRecipientSelection();$('alertMessage').textContent=''});

function createConversation(alert,group){
 const details=document.createElement('details');details.className='alert-conversation';details.dataset.thread=String(alert.id);const summary=document.createElement('summary');summary.textContent='OPEN CONVERSATION / REPLY';details.append(summary);
 const messages=document.createElement('div');messages.className='thread-messages';messages.setAttribute('aria-live','polite');details.append(messages);
 const form=document.createElement('form');form.className='reply-form';const label=document.createElement('label');label.textContent='Reply to this conversation';const input=document.createElement('textarea');input.name='reply';input.required=true;input.maxLength=2000;input.rows=2;label.append(input);const button=document.createElement('button');button.type='submit';button.className='primary';button.textContent='SEND REPLY';const status=document.createElement('p');status.className='reply-status';status.setAttribute('role','status');form.append(label,button,status);form.hidden=![alert.sender_name,alert.recipient_name].includes(currentUser.username);details.append(form);
 details.addEventListener('toggle',()=>{if(details.open)loadConversation(details)});
 form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled)return;button.disabled=true;status.textContent='Sending reply…';try{await adminFetch('/api/alerts/'+alert.id+'/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:input.value})});input.value='';status.textContent='Reply saved and delivered.';await loadConversation(details)}catch(e){status.textContent='Reply not sent: '+e.message}finally{button.disabled=false}});
 return details;
}
async function loadConversation(details){
 if(!currentUser||details.dataset.loading==='true')return;details.dataset.loading='true';const generation=authGeneration;
 try{const data=await adminFetch('/api/alerts/'+details.dataset.thread+'/messages');if(generation!==authGeneration||!details.isConnected)return;const target=details.querySelector('.thread-messages'),signature=JSON.stringify(data.messages);if(target.dataset.messages===signature)return;target.dataset.messages=signature;target.replaceChildren();if(!data.messages.length)target.textContent='No replies yet. Start the conversation below.';
 data.messages.forEach(message=>{const entry=document.createElement('div');entry.className='chat-message';const from=document.createElement('strong');from.textContent=message.sender_name+' · '+roleLabels[message.sender_role];const text=document.createElement('p');text.textContent=message.message;const time=document.createElement('small');time.textContent=new Date(message.created_at).toLocaleString();entry.append(from,text,time);target.append(entry)});
 }catch(e){if(details.isConnected)details.querySelector('.reply-status').textContent='Could not load replies: '+e.message}finally{delete details.dataset.loading}
}
$('messengerRefresh').addEventListener('click',()=>{verifyWorkspaceSession();refreshRecipients(true);refreshStaff();document.querySelectorAll('.alert-conversation[open]').forEach(loadConversation)});
setInterval(()=>document.querySelectorAll('.alert-conversation[open]').forEach(loadConversation),3000);
setInterval(verifyWorkspaceSession,15000);

async function uploadEvidence(media){
 const match=media.data.match(/^data:([^;]+);base64,(.*)$/s);if(!match)throw Error('Invalid attachment encoding');const encoded=match[2],size=encoded.length/4*3-(encoded.endsWith('==')?2:encoded.endsWith('=')?1:0);
 const start=await adminFetch('/api/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:media.name,mime:match[1],size})});
 const characters=start.chunkSize*4/3;
 for(let offset=0,part=0;offset<encoded.length;offset+=characters,part++)await adminFetch('/api/uploads/'+start.id+'/chunks/'+part,{method:'PUT',headers:{'Content-Type':'application/json','X-Riptide-Upload-Token':start.token},body:JSON.stringify({data:encoded.slice(offset,offset+characters)})});
 return {uploadId:start.id,uploadToken:start.token};
}
document.addEventListener('click',async event=>{
 const link=event.target.closest('a[href]');if(!link)return;const url=new URL(link.href,location.href),match=url.pathname.match(/^\/api\/items\/([a-zA-Z0-9_-]{8,100})\/attachment$/);if(url.origin!==location.origin||!match)return;event.preventDefault();if(link.dataset.loading)return;link.dataset.loading='true';const label=link.textContent;link.textContent='DOWNLOADING…';
 try{const info=await adminFetch(url.pathname+'/info'),parts=[];for(let part=0;part<Math.ceil(info.size/info.chunkSize);part++){const result=await adminFetch(url.pathname+'/parts/'+part),raw=atob(result.data);parts.push(Uint8Array.from(raw,c=>c.charCodeAt(0)))}const blob=new Blob(parts,{type:'application/octet-stream'});if(blob.size!==info.size)throw Error('Download size mismatch');const target=document.createElement('a'),objectUrl=URL.createObjectURL(blob);target.href=objectUrl;target.download=info.name;document.body.append(target);target.click();target.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
 }catch(error){alert('Attachment download failed: '+error.message)}finally{link.textContent=label;delete link.dataset.loading}
});
