import {validateDesign,parseDesign,emptyDesign,nextID,removeComponent,exampleDesign} from './design.mjs';
const $=id=>document.getElementById(id),canvas=$('view'),ctx=canvas.getContext('2d');
const clone=x=>JSON.parse(JSON.stringify(x));
let design=exampleDesign(),tool='select',selected=null,pending=null,drag=null,history=[],future=[],camera={x:0,y:2,scale:50};
const say=s=>$('message').textContent=s;
function commit(d){d=validateDesign(d);history.push(clone(design));if(history.length>100)history.shift();future=[];design=d;refresh();}
const current=()=>selected?design[selected.kind].find(x=>x.id===selected.id):null;
function center(b){const a=design.joints.find(x=>x.id===b.startJointID),z=design.joints.find(x=>x.id===b.endJointID);return{x:(a.x+z.x)/2,y:(a.y+z.y)/2};}
function screen(p){return{x:(p.x-camera.x)*camera.scale+canvas.clientWidth/2,y:(camera.y-p.y)*camera.scale+canvas.clientHeight/2};}
function world(e){const r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left-r.width/2)/camera.scale+camera.x,y:camera.y-(e.clientY-r.top-r.height/2)/camera.scale};}
function segmentDistance(p,a,b){const x=b.x-a.x,y=b.y-a.y,t=Math.max(0,Math.min(1,((p.x-a.x)*x+(p.y-a.y)*y)/(x*x+y*y||1)));return Math.hypot(p.x-a.x-t*x,p.y-a.y-t*y);}
function nearest(p,kind){let best=null,dist=22/camera.scale;for(const v of design[kind]){let d;if(kind==='joints')d=Math.hypot(p.x-v.x,p.y-v.y);else if(kind==='bones'){const a=design.joints.find(x=>x.id===v.startJointID),b=design.joints.find(x=>x.id===v.endJointID);d=tool==='muscle'?Math.hypot(p.x-center(v).x,p.y-center(v).y):segmentDistance(p,a,b);}else d=segmentDistance(p,center(design.bones.find(x=>x.id===v.startBoneID)),center(design.bones.find(x=>x.id===v.endBoneID)));if(d<dist){dist=d;best=v;}}return best;}
function refresh(){
 $('name').value=design.name;$('undo').disabled=!history.length;$('redo').disabled=!future.length;$('delete').disabled=!current();
 $('stats').textContent=`${design.joints.length} joints; ${design.bones.length} bones; ${design.muscles.length} muscles; ${design.decorations.length} retained decorations.`;
 const panel=$('properties');panel.replaceChildren();const v=current();if(!v){panel.textContent='Select a component.';draw();return;}
 const title=document.createElement('p');title.textContent=`${selected.kind} #${v.id}`;panel.append(title);
 const fields=selected.kind==='joints'?['weight','penalty']:selected.kind==='bones'?['weight','wing','inverted','legacy']:['strength','canExpand','userID'];
 for(const k of fields){const label=document.createElement('label'),input=document.createElement('input');label.append(document.createTextNode(k));input.setAttribute('aria-label',k);input.type=typeof v[k]==='boolean'?'checkbox':typeof v[k]==='number'?'number':'text';if(input.type==='checkbox')input.checked=v[k];else input.value=v[k];if(input.type==='number')input.step=k==='strength'?'1':'any';input.onchange=()=>{try{const d=clone(design);d[selected.kind].find(x=>x.id===selected.id)[k]=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;commit(d);say('Property updated.');}catch(e){say(e.message);refresh();}};label.append(input);panel.append(label);}draw();
}
function draw(){
 const ratio=Math.min(2,window.devicePixelRatio||1),w=canvas.clientWidth,h=canvas.clientHeight;if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);
 const ground=screen({x:0,y:0}).y;ctx.fillStyle='#263132';ctx.fillRect(0,Math.max(0,ground),w,h);ctx.strokeStyle='#2b4059';ctx.lineWidth=1;ctx.beginPath();const step=2**Math.ceil(Math.log2(35/camera.scale));
 for(let x=Math.floor((camera.x-w/camera.scale/2)/step)*step;x<=camera.x+w/camera.scale/2;x+=step){const px=screen({x,y:0}).x;ctx.moveTo(px,0);ctx.lineTo(px,h);}for(let y=Math.floor((camera.y-h/camera.scale/2)/step)*step;y<=camera.y+h/camera.scale/2;y+=step){const py=screen({x:0,y}).y;ctx.moveTo(0,py);ctx.lineTo(w,py);}ctx.stroke();
 const highlighted=(kind,id)=>selected?.kind===kind&&selected.id===id||pending?.kind===kind&&pending.id===id;
 function line(a,b,color,width){a=screen(a);b=screen(b);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();}
 for(const m of design.muscles)line(center(design.bones.find(b=>b.id===m.startBoneID)),center(design.bones.find(b=>b.id===m.endBoneID)),highlighted('muscles',m.id)?'#ffe88c':'#ec7d8d',4);
 for(const b of design.bones){line(design.joints.find(j=>j.id===b.startJointID),design.joints.find(j=>j.id===b.endJointID),highlighted('bones',b.id)?'#ffe88c':b.wing?'#7dbce7':'#bccddd',9);const c=screen(center(b));ctx.fillStyle=highlighted('bones',b.id)?'#ffe88c':'#4597bf';ctx.beginPath();ctx.arc(c.x,c.y,5,0,Math.PI*2);ctx.fill();}
 for(const j of design.joints){const c=screen(j);ctx.fillStyle='#142033';ctx.strokeStyle=highlighted('joints',j.id)?'#ffe88c':'#99ecea';ctx.lineWidth=3;ctx.beginPath();ctx.arc(c.x,c.y,9,0,Math.PI*2);ctx.fill();ctx.stroke();}
}
canvas.onpointerdown=e=>{
 if(!e.isPrimary)return;canvas.setPointerCapture(e.pointerId);const p=world(e);
 if(tool==='pan'){drag={id:e.pointerId,x:e.clientX,y:e.clientY,camera:{...camera}};return;}
 if(tool==='joint'){try{const d=clone(design);d.joints.push({id:nextID(d.joints),x:p.x,y:p.y,weight:1,penalty:0});commit(d);say('Joint added.');}catch(e){say(e.message);}return;}
 if(tool==='bone'||tool==='muscle'){const kind=tool==='bone'?'joints':'bones',hit=nearest(p,kind);if(!hit){say(`Tap ${tool==='bone'?'a joint':'a bone center'}.`);return;}if(!pending){pending={kind,id:hit.id};say('Tap the second endpoint.');draw();return;}try{const d=clone(design);if(tool==='bone')d.bones.push({id:nextID(d.bones),startJointID:pending.id,endJointID:hit.id,weight:1,legacy:false,wing:false,inverted:false});else d.muscles.push({id:nextID(d.muscles),startBoneID:pending.id,endBoneID:hit.id,strength:1500,canExpand:true,userID:''});commit(d);say('Connection added.');}catch(e){say(e.message);}pending=null;draw();return;}
 selected=null;for(const kind of ['joints','bones','muscles']){const hit=nearest(p,kind);if(hit){selected={kind,id:hit.id};break;}}if(selected?.kind==='joints')drag={id:e.pointerId,before:clone(design),jointID:selected.id,dx:current().x-p.x,dy:current().y-p.y};refresh();
};
canvas.onpointermove=e=>{if(!drag||drag.id!==e.pointerId)return;if(drag.camera){camera.x=drag.camera.x-(e.clientX-drag.x)/camera.scale;camera.y=drag.camera.y+(e.clientY-drag.y)/camera.scale;}else{const p=world(e),j=design.joints.find(j=>j.id===drag.jointID);j.x=p.x+drag.dx;j.y=p.y+drag.dy;}draw();};
function release(e,canceled=false){if(!drag||drag.id!==e.pointerId)return;const d=drag;drag=null;if(!d.before)return;try{if(canceled)throw new Error('Move canceled');const next=validateDesign(design);design=d.before;if(JSON.stringify(next)!==JSON.stringify(design))commit(next);else refresh();}catch(e){design=d.before;say(e.message);refresh();}}
canvas.onpointerup=e=>release(e);canvas.onpointercancel=e=>release(e,true);canvas.onlostpointercapture=e=>release(e,true);
document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;pending=null;document.querySelectorAll('[data-tool]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));say(`Tool: ${tool}`);draw();});
$('name').onchange=()=>{try{commit({...design,name:$('name').value});}catch(e){say(e.message);refresh();}};
$('undo').onclick=()=>{if(!history.length)return;future.push(clone(design));design=history.pop();selected=pending=null;refresh();};$('redo').onclick=()=>{if(!future.length)return;history.push(clone(design));design=future.pop();selected=pending=null;refresh();};
$('delete').onclick=()=>{if(!current())return;commit(removeComponent(design,selected.kind,selected.id));selected=pending=null;refresh();};
function fit(){if(!design.joints.length)camera={x:0,y:2,scale:50};else{const xs=design.joints.map(j=>j.x),ys=design.joints.map(j=>j.y);camera={x:(Math.min(...xs)+Math.max(...xs))/2,y:(Math.min(...ys)+Math.max(...ys))/2,scale:Math.max(.01,Math.min(150,canvas.clientWidth/(Math.max(...xs)-Math.min(...xs)+4),canvas.clientHeight/(Math.max(...ys)-Math.min(...ys)+4)))};}draw();}
$('fit').onclick=fit;$('zoomIn').onclick=()=>{camera.scale=Math.min(400,camera.scale*1.25);draw();};$('zoomOut').onclick=()=>{camera.scale=Math.max(.01,camera.scale/1.25);draw();};
$('new').onclick=()=>{commit(emptyDesign());selected=pending=null;refresh();fit();};$('example').onclick=()=>{commit(exampleDesign());selected=pending=null;refresh();fit();};
$('import').onchange=async()=>{const file=$('import').files[0];try{if(!file)return;if(file.size>2000000)throw new Error('File exceeds 2 MB');commit(parseDesign(await file.text()));selected=pending=null;refresh();fit();say('JSON imported. Decorations retained but not drawn.');}catch(e){say(`Import refused: ${e.message}`);}finally{$('import').value='';}};
$('export').onclick=()=>{try{const url=URL.createObjectURL(new Blob([JSON.stringify(validateDesign(design),null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='creature-design.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);say('Design JSON exported, not a binary simulation save.');}catch(e){say(e.message);}};
$('save').onclick=()=>{try{localStorage.setItem('creature-design-v1',JSON.stringify(validateDesign(design)));say('Design saved on this browser.');}catch(e){say(`Save failed: ${e.message}`);}};
$('restore').onclick=()=>{try{const s=localStorage.getItem('creature-design-v1');if(s===null)throw new Error('No local save');commit(parseDesign(s));selected=pending=null;refresh();fit();say('Local design restored.');}catch(e){say(`Restore failed: ${e.message}`);}};
new ResizeObserver(draw).observe(canvas);refresh();fit();say('Editor ready. Creature physics and learning are not implemented in this test build.');
