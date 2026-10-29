'use strict';
const $ = id => document.getElementById(id);
const presets = {
  normal: {water:1.8, velocity:1.2, rainfall:15, blockage:20, gate:60, pumps:2, sandbags:false},
  monsoon: {water:2.8, velocity:2, rainfall:45, blockage:35, gate:70, pumps:2, sandbags:false},
  urban: {water:3.4, velocity:2.4, rainfall:80, blockage:75, gate:40, pumps:1, sandbags:false},
  breach: {water:5.8, velocity:4.2, rainfall:110, blockage:85, gate:20, pumps:0, sandbags:false}
};
const state = {...presets.normal, vectors:true, labels:true, rain:true, manualReroute:false, siren:false, broadcast:false};
const controls = [
  ['water','🌊','River base water level',0,7.5,.1,'m','0.0m · Dry','7.5m · Extreme'],
  ['velocity','⚡','Water flow velocity',.1,5,.1,'m/s','0.1m/s · Calm','5.0m/s · Torrential'],
  ['rainfall','🌧','Rainfall intensity',0,150,5,'mm/h','0 · Clear','150 · Cloudburst'],
  ['blockage','◈','Drainage clog / siltation',0,100,5,'%','0% · Clear','100% · Blocked'],
  ['gate','▤','River sluice gate opening',0,100,5,'%','0% · Closed','100% · Open']
];
const assets = [
  {id:'underpass',name:'Central underpass',type:'Road infrastructure',x:320,y:290,elevation:.8,caution:.1,critical:.4,icon:'●',protocol:'Simulated barrier closure when depth exceeds 0.4 m.'},
  {id:'road',name:'MG arterial road',type:'Urban highway',x:490,y:245,elevation:2.2,caution:.1,critical:.4,icon:'●',protocol:'Simulated traffic diversion when depth exceeds 0.4 m.'},
  {id:'rail',name:'Rail track cutting',type:'Railway corridor',x:230,y:190,elevation:1.6,caution:.1,critical:.3,icon:'●',protocol:'Simulated train suspension when depth exceeds 0.3 m.'},
  {id:'station',name:'Central station',type:'Passenger hub',x:145,y:145,elevation:2.5,caution:.4,critical:.9,icon:'●',protocol:'Illustrative passenger hub and evacuation point.'},
  {id:'canal',name:'Storm drain outfall',type:'Drainage infrastructure',x:425,y:350,elevation:1.1,caution:.4,critical:.8,icon:'●',protocol:'Illustrative gravity outfall and sluice gate.'},
  {id:'power',name:'Power substation',type:'Critical utility',x:590,y:180,elevation:2,caution:.3,critical:.7,icon:'●',protocol:'Simulated critical utility flood exposure.'},
  {id:'hospital',name:'District hospital',type:'Emergency care',x:680,y:315,elevation:4.5,caution:.5,critical:1.2,icon:'●',protocol:'Illustrative high-ground emergency hub.'}
];
let selected = null, lastEvents = {}, animation = 0;
const log = (tag, message) => { const item=document.createElement('div'); const time=document.createElement('time'); time.textContent=new Date().toLocaleTimeString(); const text=document.createElement('span'); text.textContent=`${tag} · ${message}`; item.append(time,text); $('log').prepend(item); while($('log').children.length>40) $('log').lastChild.remove(); };
controls.forEach(([key,icon,label,min,max,step,unit,left,right])=>{
 const block=document.createElement('div'); block.className='slider-block';
 block.innerHTML=`<div class="slider-label"><label for="${key}">${icon} &nbsp;${label}</label><output id="${key}Output" for="${key}"></output></div><input id="${key}" type="range" min="${min}" max="${max}" step="${step}"><div class="range-ends"><span>${left}</span><span>${right}</span></div>`;
 $('sliders').append(block);
 $(key).addEventListener('input',e=>{state[key]=Number(e.target.value); document.querySelectorAll('.preset').forEach(b=>b.classList.remove('selected')); update();});
});
assets.forEach(asset=>{const b=document.createElement('button');b.textContent=asset.name;b.addEventListener('click',()=>inspect(asset));$('assetList').append(b)});
function inspect(asset){selected=asset; $('probeName').textContent=asset.name; $('probeDetail').textContent=`${asset.type} · Elev. ${asset.elevation.toFixed(1)} m · Depth ${asset.depth.toFixed(2)} m · ${asset.status}`; $('probeDetail').title=asset.protocol;}
function badge(id,text,level){$(id).textContent=text;$(id).className=`badge ${level}`;}
function eventTransition(key,active,message){if(active&&!lastEvents[key])log('TRIGGER',message);lastEvents[key]=active;}
let sharedRevision=null;
function update(publish=true){
 controls.forEach(([key,,,,,,unit])=>{ $(key).value=state[key]; $(key+'Output').textContent=(key==='water'||key==='velocity'?state[key].toFixed(1):state[key])+(unit==='%'?'%':' '+unit); });
 $('pumpValue').textContent=`${state.pumps} / 4 running`; $('sandbagValue').textContent=state.sandbags?'Deployed':'Disabled';
 const calculated=RiptideModel.calculate(state), stage=calculated.stage;
 state.stage=stage;
 const flow=state.pumps*6+(1-state.blockage/100)*state.gate/100*20-state.rainfall*.4;
 calculated.assets.forEach(value=>{const asset=assets.find(a=>a.id===value.id);asset.depth=value.depth;asset.status=value.status});
 const get=id=>assets.find(a=>a.id===id), under=get('underpass'), road=get('road'), rail=get('rail');
 const roadBlocked=under.status==='BLOCKED'||road.status==='BLOCKED', roadCaution=under.status==='CAUTION'||road.status==='CAUTION';
 const railBlocked=rail.status==='BLOCKED', railCaution=rail.status==='CAUTION';
 const drainBlocked=state.blockage>65&&state.rainfall>40, drainCaution=state.blockage>40;
 const submerged=assets.filter(a=>a.status==='BLOCKED').length, caution=assets.some(a=>a.status==='CAUTION');
 const level=stage>=4.5||submerged>=2?'critical':stage>=3||caution||submerged?'warning':stage>=2.2||state.rainfall>=40?'warning':'normal';
 $('threat').className='threat '+level; $('threatText').textContent=level==='critical'?'RED ALERT · SEVERE FLOOD':level==='warning'?'WARNING · INFRASTRUCTURE IMPACT':'NORMAL · ALL SYSTEMS CLEAR';
 $('stage').textContent=stage.toFixed(2)+' m'; $('flow').textContent=(flow>=0?'+':'')+flow.toFixed(1)+' m³/s'; $('area').textContent=(stage>1.2?Math.min(18.5,(stage-1.2)*2.8+submerged*.8):.2).toFixed(1)+' km²';
 badge('roadBadge',roadBlocked?'BLOCKED':roadCaution?'CAUTION':'CLEAR',roadBlocked?'danger':roadCaution?'caution':'safe');
 $('underpassDepth').textContent=under.depth.toFixed(2)+' m'; $('roadDepth').textContent=road.depth.toFixed(2)+' m'; $('bridgeStatus').textContent=stage>3.5?'At risk':'Passable'; $('roadMessage').textContent=roadBlocked?'Simulated road closure and diversion via the ring flyover.':roadCaution?'Water accumulating. Reduced speed recommended.':'All lanes operational in this scenario.';
 badge('railBadge',railBlocked?'SUSPENDED':railCaution?'CAUTION':'OPERATIONAL',railBlocked?'danger':railCaution?'caution':'safe'); $('railDepth').textContent=rail.depth.toFixed(2)+' m'; $('stationStatus').textContent=railBlocked?'Suspended':railCaution?'Delayed':'On time'; $('railBridge').textContent=stage>4.5?'At risk':'Safe clearance'; $('railMessage').textContent=railBlocked?'Simulated train services suspended at track cutting.':railCaution?'Simulated speed restriction in effect.':'Signaling normal. Track clear of water.';
 badge('drainBadge',drainBlocked?'OVERFLOW':drainCaution?'LIMITED':'OPTIMAL',drainBlocked?'danger':drainCaution?'caution':'safe'); $('canalLoad').textContent=Math.min(100,Math.round(state.rainfall/120*50+state.blockage*.5))+'%'; $('backflow').textContent=drainBlocked?'High':drainCaution?'Moderate':'Low'; $('discharge').textContent=(state.pumps*6).toFixed(1)+' m³/s'; $('drainMessage').textContent=drainBlocked?'Simulated drain blockage causing urban backflow.':drainCaution?'Drainage capacity restricted.':'Gravity discharge functional.';
 $('rerouteValue').textContent=state.manualReroute?'Manual diversion active':roadBlocked?'Automatic diversion active':'Automatic on road block';
 $('sirenValue').textContent=state.siren?'Simulated siren active':'Simulate visual alert';$('broadcastValue').textContent=state.broadcast?'Simulated warning issued':'Simulate a citizen alert';
 eventTransition('road',roadBlocked,'Road closure and traffic diversion triggered.');eventTransition('rail',railBlocked,'Rail track submerged; train services suspended.');eventTransition('drain',drainBlocked,'Drainage choke and backflow detected.');
 if(selected)inspect(selected);
 const snapshot={...calculated,updatedAt:new Date().toISOString(),baseRevision:sharedRevision};
 if(publish)try {
  const payload=JSON.stringify(snapshot);localStorage.setItem('riptideScenario',payload);localStorage.setItem('riptidePendingScenario',payload);
  $('scenarioSync').textContent=syncConflict?'● CONFLICT: SHARED SCENARIO CHANGED':'● SYNC PENDING';
  clearTimeout(window.scenarioSaveTimer);window.scenarioSaveTimer=setTimeout(syncScenario,400);
 } catch(e) { $('scenarioSync').textContent='● STORAGE UNAVAILABLE';console.warn('Scenario could not be saved locally',e); }

}
let scenarioSyncInFlight=false, syncConflict=false;
function applyShared(s){
 if(!s)return;
 for(const [key] of controls)state[key]=s[key];state.pumps=s.pumps;state.sandbags=s.sandbags;state.manualReroute=!!s.manualReroute;state.siren=!!s.siren;state.broadcast=!!s.broadcast;
 sharedRevision=s.revision||0;localStorage.setItem('riptideScenario',JSON.stringify(s));
 update(false);$('scenarioSync').textContent='● SYNCED';$('reloadShared').hidden=true;syncConflict=false;
 document.querySelectorAll('.preset').forEach(b=>b.classList.remove('selected'));
}
async function syncScenario(){
 if(scenarioSyncInFlight||syncConflict)return;scenarioSyncInFlight=true;
 try{while(true){const payload=localStorage.getItem('riptidePendingScenario');if(!payload)break;
  const response=await fetch('/api/scenario',{method:'POST',headers:{'Content-Type':'application/json'},body:payload});
  if(response.status===409){if(!localStorage.getItem('riptidePendingScenario')){syncConflict=false;break}syncConflict=true;$('scenarioSync').textContent='● CONFLICT: SHARED SCENARIO CHANGED';$('reloadShared').hidden=false;break}
  if(!response.ok)throw Error('Scenario sync failed: '+response.status);
  const result=await response.json();sharedRevision=result.scenario.revision;
  if(localStorage.getItem('riptidePendingScenario')===payload){localStorage.removeItem('riptidePendingScenario');localStorage.setItem('riptideScenario',JSON.stringify(result.scenario));$('scenarioSync').textContent='● SYNCED';break}
  // A newer local edit occurred while the previous save was in flight.
  const next=JSON.parse(localStorage.getItem('riptidePendingScenario'));next.baseRevision=sharedRevision;localStorage.setItem('riptidePendingScenario',JSON.stringify(next));
 }}catch(e){$('scenarioSync').textContent='● SYNC PENDING'}finally{scenarioSyncInFlight=false}
}
async function pollShared(){
 if(scenarioSyncInFlight||localStorage.getItem('riptidePendingScenario'))return;
 try{const response=await fetch('/api/scenario',{cache:'no-store'});if(!response.ok)throw Error();const data=await response.json();if(data&&(data.revision||0)!==sharedRevision)applyShared(data)}catch(e){$('scenarioSync').textContent='● OFFLINE · LAST SHARED STATE'}
}
$('reloadShared').addEventListener('click',async()=>{if(!confirm('Discard your pending local changes and load the shared scenario?'))return;try{const r=await fetch('/api/scenario',{cache:'no-store'});if(!r.ok)throw Error();const data=await r.json();if(!data)throw Error();localStorage.removeItem('riptidePendingScenario');applyShared(data)}catch(e){$('scenarioSync').textContent='● UNABLE TO LOAD SHARED SCENARIO'}});
window.addEventListener('online',()=>{syncScenario();pollShared()});setInterval(()=>{syncScenario();pollShared()},2000);
function applyPreset(name){Object.assign(state,presets[name]);state.manualReroute=false;state.siren=false;state.broadcast=false;$('sirenValue').textContent='Simulate visual alert';$('banner').innerHTML='System ready for scenario testing. <span>SYS-OK</span>';document.querySelectorAll('.preset').forEach(b=>b.classList.toggle('selected',b.dataset.preset===name));update();log('SCENARIO',`Loaded ${name} scenario.`)}
document.querySelectorAll('.preset').forEach(b=>b.addEventListener('click',()=>applyPreset(b.dataset.preset)));
$('reset').addEventListener('click',()=>applyPreset('normal'));
$('pumps').addEventListener('click',()=>{state.pumps=(state.pumps+1)%5;update();log('PUMPS',`${state.pumps} of 4 simulated pumps running.`)});
$('sandbags').addEventListener('click',()=>{state.sandbags=!state.sandbags;update();log('LEVEE',state.sandbags?'Temporary levees deployed.':'Temporary levees removed.')});
$('reroute').addEventListener('click',()=>{state.manualReroute=!state.manualReroute;update();$('banner').textContent=state.manualReroute?'Simulated manual traffic diversion activated.':'Manual diversion deactivated.';log('ACTION',$('banner').textContent)});
$('broadcast').addEventListener('click',()=>{state.broadcast=true;update();$('banner').textContent='Simulated warning broadcast. No messages were sent.';log('BROADCAST','Simulated citizen warning; no messages sent.')});
$('clearDrain').addEventListener('click',()=>{state.blockage=Math.max(0,state.blockage-40);update();$('banner').textContent='Simulated drainage clearing completed.';log('DISPATCH','Drainage blockage reduced by up to 40 percentage points.')});
$('siren').addEventListener('click',()=>{state.siren=!state.siren;$('sirenValue').textContent=state.siren?'Simulated siren active':'Simulate visual alert';update();$('banner').textContent=state.siren?'Simulated evacuation siren active.':'Simulated evacuation siren stopped.';log('SIREN',$('banner').textContent)});
$('clearLog').addEventListener('click',()=>{$('log').replaceChildren()});
[['vectors','Flow'],['labels','Labels'],['rain','Rain']].forEach(([key,label])=>$(key).addEventListener('click',()=>{state[key]=!state[key];$(key).textContent=`${label}: ${state[key]?'ON':'OFF'}`;$(key).classList.toggle('active',state[key])}));
$('explain').addEventListener('click',()=>$('dialog').showModal());$('closeDialog').addEventListener('click',()=>$('dialog').close());$('doneDialog').addEventListener('click',()=>$('dialog').close());
const canvas=$('map'), ctx=canvas.getContext('2d');
// Orthographic 3D projection. All positions below are in simulated world units;
// this is a visual model, not georeferenced terrain or a hydraulic calculation.
let cameraAngle = Math.PI / 4;
let projectedAssets = [];
function project(x,y,z=0){
 const c=Math.cos(cameraAngle),s=Math.sin(cameraAngle);
 const rx=x*c-y*s, ry=x*s+y*c;
 return {x:400+rx*57,y:215+ry*28-z*48, depth:ry};
}
function polygon(points,fill,stroke='#08131f',width=1){
 ctx.beginPath();points.forEach((p,i)=>{const q=project(...p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.closePath();ctx.fillStyle=fill;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=width;ctx.stroke()}
}
function line3(points,color,width=1,dash=[]){ctx.beginPath();points.forEach((p,i)=>{const q=project(...p);i?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y)});ctx.strokeStyle=color;ctx.lineWidth=width;ctx.setLineDash(dash);ctx.stroke();ctx.setLineDash([])}
function rect3(x1,y1,x2,y2,z,fill,stroke=null){polygon([[x1,y1,z],[x2,y1,z],[x2,y2,z],[x1,y2,z]],fill,stroke)}
function block(x,y,w,d,h,colors){
 const x0=x-w/2,x1=x+w/2,y0=y-d/2,y1=y+d/2;
 // Painter-sort the four vertical faces for the active camera orientation.
 const faces=[
  {p:[[x0,y0,0],[x1,y0,0],[x1,y0,h],[x0,y0,h]],c:colors[1]},
  {p:[[x1,y0,0],[x1,y1,0],[x1,y1,h],[x1,y0,h]],c:colors[2]},
  {p:[[x1,y1,0],[x0,y1,0],[x0,y1,h],[x1,y1,h]],c:colors[1]},
  {p:[[x0,y1,0],[x0,y0,0],[x0,y0,h],[x0,y1,h]],c:colors[2]}
 ];
 faces.sort((a,b)=>a.p.reduce((sum,p)=>sum+project(...p).depth,0)-b.p.reduce((sum,p)=>sum+project(...p).depth,0));
 faces.forEach(face=>polygon(face.p,face.c,'#0a1b2a',1.5));
 rect3(x0,y0,x1,y1,h,colors[0],'#0a1b2a');
}
// Explicit world-space placements keep the facilities separate and align them
// with the illustrative road, track, and canal, independent of screen rotation.
const assetPositions = {
 underpass:{x:-3.08,y:.61}, road:{x:1.0,y:.61}, rail:{x:-3.08,y:-1.55},
 station:{x:-3.08,y:2.65}, canal:{x:1.72,y:2.85},
 power:{x:3.5,y:-1.05}, hospital:{x:4.0,y:2.8}
};
function world(a){return assetPositions[a.id]}
function disk(x,y,r,z,color){const points=[];for(let i=0;i<20;i++){const angle=i*Math.PI/10;points.push([x+Math.cos(angle)*r,y+Math.sin(angle)*r,z])}polygon(points,color,null)}
function render(){
 const rect=canvas.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2), w=Math.max(1,Math.round(rect.width*dpr)), h=Math.max(1,Math.round(rect.height*dpr));
 if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h}ctx.setTransform(w/800,0,0,h/440,0,0);
 ctx.fillStyle='#07111f';ctx.fillRect(0,0,800,440);
 // Floating terrain slab, with real depth and grid drawn in world coordinates.
 const corners=[[-5,-4],[5,-4],[5,4],[-5,4]];
 const sides=corners.map((p,i)=>{const q=corners[(i+1)%4];return {points:[[...p,0],[...q,0],[...q,-.42],[...p,-.42]],depth:(project(...p).depth+project(...q).depth)/2}});
 sides.sort((a,b)=>a.depth-b.depth).forEach((side,i)=>polygon(side.points,i%2?'#102b40':'#153850','#071522',2));
 rect3(-5,-4,5,4,0,'#1b3b42','#326077');
 for(let x=-5;x<=5;x++)line3([[x,-4,.01],[x,4,.01]],'#365960',.7);
 for(let y=-4;y<=4;y++)line3([[-5,y,.01],[5,y,.01]],'#365960',.7);
 // Parks and fields provide visual context without implying real-world geography.
 rect3(-4.75,1.35,-3.7,2.15,.012,'#28504d',null);
 rect3(-.5,-.9,.65,-.05,.012,'#28504d',null);
 rect3(2.45,1.5,3.35,2.3,.012,'#28504d',null);
 // A permanent river channel plus an expanding floodplain. The visual extent
 // follows the same effective stage as the dashboard; it is not a GIS forecast.
 const riverBank=-2.4;
 const floodExtent=Math.min(3.6,riverBank+Math.max(0,state.stage-1)*.72);
 rect3(-5,-3.4,5,riverBank,.025,'#1379ae','#247ca4');
 rect3(-5,-3.18,5,-2.62,.03,'#239ed0',null);
 // Road, railway and drainage corridors.
 rect3(-5,.45,5,.78,.035,'#63727c',null);
 line3([[-5,.61,.045],[5,.61,.045]],'#d9dbc7',1.8,[7,7]);
 rect3(-3.2,-4,-2.95,4,.04,'#56636e',null);
 line3([[-3.08,-4,.05],[-3.08,4,.05]],'#d7dee0',1.4,[3,5]);
 rect3(1.6,-3,1.84,4,.045,'#2789a6',null);
 // Translucent overflow sits above roads, so rising water visibly covers them.
 if(floodExtent>riverBank){
  rect3(-5,riverBank,5,floodExtent,.055,'#36a9d985',null);
  line3([[-5,floodExtent,.06],[5,floodExtent,.06]],'#87ddf9',1.5,[5,5]);
 }
 if(state.sandbags)line3([[-4,-1.8,.12],[3,-1.8,.12]],'#e9b35f',4,[6,3]);
 if(state.vectors){for(let i=0;i<28;i++){
  const x=-4.8+((i*.73+animation*.015*state.velocity)%9.6);
  const y=-3.28+(i%5)*(Math.max(1,floodExtent+3.28)/5);
  line3([[x,y,.08],[x+.19,y,.08]],'#b0edff',2);
 }}
 // Inundation footprints derive from the same depths as the dashboard.
 assets.forEach(a=>{if(a.depth>.01){const p=world(a),radius=Math.min(1.0,.22+a.depth*.18);disk(p.x,p.y,radius,.07,a.status==='BLOCKED'?'#d65b6580':'#37b6e780')}});
 const colors={underpass:['#b8c8ca','#647e8e','#425e71'],road:['#cedde3','#7895a4','#496778'],rail:['#cad5da','#8098a1','#556c7c'],station:['#d4e9f5','#6da2c3','#416b8f'],canal:['#7bd3df','#358ca6','#24627c'],power:['#fee2a2','#b58b54','#765b3a'],hospital:['#eaf4fb','#7cb8dd','#416e9a']};
 const heights={underpass:.32,road:.27,rail:.30,station:.95,canal:.38,power:.75,hospital:1.2};
 const sorted=assets.slice().sort((a,b)=>{const p=world(a),q=world(b);return project(p.x,p.y).depth-project(q.x,q.y).depth});
 projectedAssets=[];
 sorted.forEach(a=>{
  const p=world(a),height=heights[a.id];
  const size=a.id==='hospital'?[.8,.75]:a.id==='station'?[.8,.65]:[.55,.52];
  block(p.x,p.y,size[0],size[1],height,colors[a.id]);
  if(a.id==='hospital'){line3([[p.x-.2,p.y,height+.03],[p.x+.2,p.y,height+.03]],'#ee6c77',4);line3([[p.x,p.y-.17,height+.03],[p.x,p.y+.17,height+.03]],'#ee6c77',4)}
  const pt=project(p.x,p.y,height),color=a.status==='BLOCKED'?'#ff6875':a.status==='CAUTION'?'#ffc268':'#75e6b6';
  projectedAssets.push({asset:a,x:pt.x,y:pt.y,color});
 });
 // Markers are drawn above the geometry; collision-aware labels stay legible
 // when the map is rotated. The asset list remains a keyboard-accessible option.
 const occupied=[];
 projectedAssets.forEach(({asset:a,x,y,color})=>{
  ctx.fillStyle='#07131e';ctx.fillRect(x-6,y-18,12,12);ctx.fillStyle=color;ctx.fillRect(x-4,y-16,8,8);
  if(!state.labels)return;
  ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.textBaseline='middle';
  const name=a.name.toUpperCase(),tw=ctx.measureText(name).width, width=tw+8;
  const offsets=[-38,-53,4,-68,19];
  const candidates=offsets.map(offset=>({x:Math.max(2,Math.min(798-width,x-width/2)),y:Math.max(2,Math.min(425,y+offset)),w:width,h:14}));
  const box=candidates.find(candidate=>!occupied.some(other=>candidate.x<other.x+other.w&&candidate.x+candidate.w>other.x&&candidate.y<other.y+other.h&&candidate.y+candidate.h>other.y))||candidates[0];
  occupied.push(box);ctx.fillStyle='#07131eee';ctx.fillRect(box.x,box.y,box.w,box.h);ctx.fillStyle='#eaf8ff';ctx.fillText(name,box.x+box.w/2,box.y+7);
 });
 if(state.rain&&state.rainfall>0){ctx.strokeStyle='#a8d9e355';ctx.lineWidth=1;for(let i=0;i<Math.min(100,state.rainfall);i++){const x=(i*83+animation*.5)%800,y=(i*53+animation*(2+state.rainfall/30))%440;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-3,y+8);ctx.stroke()}}
 animation++;requestAnimationFrame(render);
}
function assetAt(e){const r=canvas.getBoundingClientRect(),x=(e.clientX-r.left)*800/r.width,y=(e.clientY-r.top)*440/r.height;let closest=null,best=27;for(const item of projectedAssets){const distance=Math.hypot(x-item.x,y-(item.y-8));if(distance<best){best=distance;closest=item.asset}}return closest}
let drag=null;
canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,startX:e.clientX,startY:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener('pointermove',e=>{if(drag){const delta=e.clientX-drag.x;drag.x=e.clientX;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>4)drag.moved=true;if(drag.moved)cameraAngle+=delta*.008}else{const a=assetAt(e);if(a)inspect(a)}});
canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved){const a=assetAt(e);if(a)inspect(a)}drag=null});
canvas.addEventListener('pointercancel',()=>{drag=null});
$('rotateLeft').addEventListener('click',()=>{cameraAngle-=Math.PI/8});$('rotateRight').addEventListener('click',()=>{cameraAngle+=Math.PI/8});
async function boot(){
 let pending=null,remote=null,cached=null;
 try{pending=JSON.parse(localStorage.getItem('riptidePendingScenario'));cached=JSON.parse(localStorage.getItem('riptideScenario'))}catch(e){}
 try{const r=await fetch('/api/scenario',{cache:'no-store'});if(r.ok)remote=await r.json()}catch(e){}
 if(pending){for(const [key] of controls)state[key]=pending[key];state.pumps=pending.pumps;state.sandbags=pending.sandbags;state.manualReroute=!!pending.manualReroute;state.siren=!!pending.siren;state.broadcast=!!pending.broadcast;sharedRevision=pending.baseRevision??null;update(false);$('scenarioSync').textContent='● SYNC PENDING';syncScenario()}
 else if(remote){applyShared(remote)}
 else if(cached){applyShared(cached);$('scenarioSync').textContent='● OFFLINE · LAST SHARED STATE'}
 else{update();}
 log('INIT','Virtual environment initialized. All data is simulated.');requestAnimationFrame(render);
}
boot();
