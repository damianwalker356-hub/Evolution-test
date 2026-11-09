// CreatureDesign JSON adapter. Original project notices and restrictions apply.
const fail=s=>{throw new Error(s);};
const number=(x,min,max)=>typeof x==='number'&&Number.isFinite(x)&&x>=min&&x<=max?x:fail('Number outside supported bounds');
const id=x=>Number.isInteger(number(x,0,2147483647))?x:fail('Integer ID required');
const bool=(x,d)=>x===undefined?d:typeof x==='boolean'?x:fail('Boolean required');
const text=(x,n)=>typeof x==='string'&&x.length<=n?x:fail('Invalid text');
const array=(a,n)=>Array.isArray(a)&&a.length<=n?a:fail('Invalid or oversized component list');
function keys(o,allowed){if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.includes(k)))fail('Unknown fields: import refused without discarding data');}
function unique(a){const m=new Map();for(const x of a){if(m.has(x.id))fail('Duplicate ID');m.set(x.id,x);}return m;}
export function validateDesign(d){
 keys(d,['name','joints','bones','muscles','decorations']);const name=text(d.name,128);
 const joints=array(d.joints,256).map(j=>{keys(j,['id','x','y','weight','penalty']);return{id:id(j.id),x:number(j.x,-10000,10000),y:number(j.y,-10000,10000),weight:number(j.weight,.0001,100000),penalty:number(j.penalty??0,0,1)};});
 const jm=unique(joints),pairs=new Set();
 const bones=array(d.bones,512).map(b=>{keys(b,['id','startJointID','endJointID','weight','legacy','wing','inverted']);const a=jm.get(id(b.startJointID)),z=jm.get(id(b.endJointID));if(!a||!z||a===z||Math.hypot(a.x-z.x,a.y-z.y)<.0001)fail('Invalid bone endpoints');const pair=[a.id,z.id].sort((x,y)=>x-y).join(':');if(pairs.has(pair))fail('Duplicate bone');pairs.add(pair);const legacy=bool(b.legacy,true),weight=number(b.weight,.0001,100000);if(legacy&&2*weight-1<=0)fail('Legacy rigid-body mass must be positive');return{id:id(b.id),startJointID:a.id,endJointID:z.id,weight,legacy,wing:bool(b.wing,false),inverted:bool(b.inverted,false)};});
 const bm=unique(bones),links=new Set();
 const muscles=array(d.muscles,1024).map(m=>{keys(m,['id','startBoneID','endBoneID','strength','canExpand','userID']);const a=id(m.startBoneID),b=id(m.endBoneID);if(a===b||!bm.has(a)||!bm.has(b))fail('Invalid muscle endpoints');const pair=[a,b].sort((x,y)=>x-y).join(':');if(links.has(pair))fail('Duplicate muscle');links.add(pair);const strength=number(m.strength,0,1000000);if(!Number.isInteger(strength))fail('Original JSON muscle strength must be an integer');return{id:id(m.id),startBoneID:a,endBoneID:b,strength,canExpand:bool(m.canExpand,true),userID:text(m.userID??'',128)};});unique(muscles);
 const decorations=array(d.decorations??[],1024).map(a=>{keys(a,['id','boneID','x','y','s','r','fX','fY','dT']);if(!bm.has(id(a.boneID)))fail('Decoration has missing bone');const dT=number(a.dT,0,41);if(!Number.isInteger(dT))fail('Invalid decoration type');return{id:id(a.id),boneID:a.boneID,x:number(a.x,-10000,10000),y:number(a.y,-10000,10000),s:number(a.s,.0001,100),r:number(a.r,-36000,36000),fX:bool(a.fX,false),fY:bool(a.fY,false),dT};});unique(decorations);
 return{name,joints,bones,muscles,decorations};
}
export function parseDesign(s){if(typeof s!=='string'||s.length>2000000)fail('Design exceeds 2 MB text limit');return validateDesign(JSON.parse(s));}
export const emptyDesign=()=>({name:'Unnamed creature',joints:[],bones:[],muscles:[],decorations:[]});
export const nextID=a=>id(a.reduce((n,x)=>Math.max(n,x.id),-1)+1);
export function removeComponent(d,kind,target){d=validateDesign(d);if(!['joints','bones','muscles','decorations'].includes(kind))fail('Unknown component');d[kind]=d[kind].filter(x=>x.id!==target);const js=new Set(d.joints.map(x=>x.id));d.bones=d.bones.filter(b=>js.has(b.startJointID)&&js.has(b.endJointID));const bs=new Set(d.bones.map(x=>x.id));d.muscles=d.muscles.filter(m=>bs.has(m.startBoneID)&&bs.has(m.endBoneID));d.decorations=d.decorations.filter(a=>bs.has(a.boneID));return validateDesign(d);}
export function exampleDesign(){return validateDesign({name:'Three-joint creature',joints:[{id:0,x:-2,y:1,weight:1},{id:1,x:0,y:4,weight:1},{id:2,x:2,y:1,weight:1}],bones:[{id:0,startJointID:0,endJointID:1,weight:1,legacy:false},{id:1,startJointID:1,endJointID:2,weight:1,legacy:false}],muscles:[{id:0,startBoneID:0,endBoneID:1,strength:1500,canExpand:true}],decorations:[]});}
