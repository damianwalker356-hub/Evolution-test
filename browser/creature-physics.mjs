// Creature physics construction math; no substitute dynamics solver.
// Derived-source restrictions from Evolution-test remain applicable.
const finite=x=>typeof x==='number'&&Number.isFinite(x);
function vec(v,n){if(!v||v.length!==n)throw new TypeError('Invalid vector size');for(let i=0;i<n;i++)if(!finite(v[i]))throw new TypeError('Invalid finite vector');}
function positive(x){if(!finite(x)||x<=0)throw new RangeError('Positive finite value required');}
export function rotate(q,v,out){
 vec(q,4);vec(v,3);if(!out||out.length!==3)throw new TypeError('Output vector required');
 const [x,y,z]=v,[qx,qy,qz,qw]=q,tx=2*(qy*z-qz*y),ty=2*(qz*x-qx*z),tz=2*(qx*y-qy*x);
 out[0]=x+qw*tx+qy*tz-qz*ty;out[1]=y+qw*ty+qz*tx-qx*tz;out[2]=z+qw*tz+qx*ty-qy*tx;return out;
}
export function multiply(a,b){
 const [x,y,z,w]=a,[u,v,t,s]=b;
 return [w*u+x*s+y*t-z*v,w*v-x*t+y*s+z*u,w*t+x*v-y*u+z*s,w*s-x*u-y*v-z*t];
}
export function capsuleMassProperties(radius,halfHeight,mass){
 positive(radius);positive(mass);if(!finite(halfHeight)||halfHeight<0)throw new RangeError('Invalid capsule half-height');
 const r=radius,h=halfHeight,length=2*h,vc=Math.PI*r*r*length,vs=4*Math.PI*r*r*r/3,mc=mass*vc/(vc+vs),ms=mass-mc;
 const axial=.5*mc*r*r+.4*ms*r*r;
 const transverse=mc*(r*r/4+length*length/12)+ms*(.4*r*r+h*h+.75*h*r);
 return {mass,volume:vc+vs,axial,transverse};
}
export function boneGeometry(start,end,width=.5){
 vec(start,3);vec(end,3);positive(width);if(start[2]!==0||end[2]!==0)throw new RangeError('Original bone placement flattens Z; explicit planar points required');
 const dx=end[0]-start[0],dy=end[1]-start[1],length=Math.hypot(dx,dy);if(length<.0001)throw new RangeError('Collapsed bone');
 const angle=Math.atan2(dy,dx)-Math.PI/2,radius=.5*width;
 return {position:[(start[0]+end[0])/2,(start[1]+end[1])/2,0],rotation:[0,0,Math.sin(angle/2),Math.cos(angle/2)],length,angle,
  scale:[width,length/2,width],shape:{type:'capsule',radius,halfHeight:Math.max(0,length/2-radius),rotation:[0,0,Math.SQRT1_2,Math.SQRT1_2]},
  linearDamping:0,angularDamping:.05,locks:{linearZ:true,angularX:true,angularY:true},unityConstraints:56,
  materialGuid:'a402a6659fbf74b8b9c0739649b7384b',unityColliderParity:'UNVERIFIED'};
}
export function hingeFrames(worldPoint,body0,body1){
 vec(worldPoint,3);const frameQ=[0,-Math.SQRT1_2,0,Math.SQRT1_2];
 function local(body){vec(body.position,3);vec(body.rotation,4);if(Math.abs(body.rotation.reduce((n,x)=>n+x*x,0)-1)>1e-6)throw new RangeError('Unit quaternion required');
  const inv=[-body.rotation[0],-body.rotation[1],-body.rotation[2],body.rotation[3]],delta=worldPoint.map((x,i)=>x-body.position[i]),position=[0,0,0];
  rotate(inv,delta,position);return {position,rotation:multiply(inv,frameQ)};
 }
 return {local0:local(body0),local1:local(body1),worldAxis:[0,0,1],collisionEnabled:false,preprocessingEnabled:true,motorEnabled:false,limitsEnabled:false};
}
export function wingForce(velocity,angle,boneLength,inverted,out){
 vec(velocity,3);if(!finite(angle)||!finite(boneLength)||boneLength<=0||typeof inverted!=='boolean'||!out||out.length!==3)throw new TypeError('Invalid wing state');
 const c=Math.cos(angle),s=Math.sin(angle),vx=c*velocity[0]+s*velocity[1],vy=-s*velocity[0]+c*velocity[1],speed=Math.hypot(vx,vy,velocity[2]);
 const degrees=Math.atan2(vx,vy)*180/Math.PI;
 let force=0;
 if(speed>=1&&inverted===(degrees<0))force=speed*-Math.sign(degrees)*15*boneLength*(1-Math.abs(Math.abs(degrees)-90)/90);
 out[0]=c*force;out[1]=s*force;out[2]=0;return out;
}
export function compileBodyCandidate(design){
 // Caller supplies a design already checked by design.mjs; safety checks remain here.
 if(!design||!Array.isArray(design.joints)||!Array.isArray(design.bones)||!Array.isArray(design.muscles))throw new TypeError('Design required');
 const actors=[],hinges=[],fixed=[],springSources=[],jointMap=new Map(),boneMap=new Map();
 for(const j of design.joints){positive(j.weight);if(jointMap.has(j.id))throw new Error('Duplicate joint');const a={key:`joint:${j.id}`,position:[j.x,j.y,0],rotation:[0,0,0,1],mass:j.weight,linearDamping:0,angularDamping:0,shape:{type:'sphere',radius:.5,trigger:true},locks:{linearZ:true,angularX:true,angularY:true,angularZ:true},unityConstraints:120,inertiaPolicy:'trigger-only-unverified'};vec(a.position,3);jointMap.set(j.id,a);actors.push(a);}
 for(const b of design.bones){positive(b.weight);if(boneMap.has(b.id))throw new Error('Duplicate bone');const a=jointMap.get(b.startJointID),z=jointMap.get(b.endJointID);if(!a||!z||a===z)throw new Error('Invalid bone endpoints');
  const g=boneGeometry(a.position,z.position),mass=b.legacy?2*b.weight-1:b.weight;positive(mass);
  const bone={...g,key:`bone:${b.id}`,mass,wing:b.wing===true,inverted:b.inverted===true,inertiaCandidate:capsuleMassProperties(g.shape.radius,g.shape.halfHeight,mass)};actors.push(bone);
  for(const j of [a,z])hinges.push({actor0:j.key,actor1:bone.key,...hingeFrames(j.position,j,bone)});
  let centerBody=bone;
  if(b.legacy){centerBody={key:`legacy:${b.id}`,position:bone.position.slice(),rotation:bone.rotation.slice(),mass:1,linearDamping:0,angularDamping:.05,shape:null,locks:{linearZ:true},inertiaPolicy:'no-collider-unverified'};actors.push(centerBody);fixed.push({actor0:centerBody.key,actor1:bone.key,preprocessingEnabled:false,collisionEnabled:false,relativePose:'identity'});}
  boneMap.set(b.id,{bone,centerBody});
 }
 for(const m of design.muscles){const a=boneMap.get(m.startBoneID),b=boneMap.get(m.endBoneID);if(!a||!b||a===b)throw new Error('Invalid muscle endpoints');
  springSources.push({id:m.id,actor0:a.centerBody.key,actor1:b.centerBody.key,forceActor0:a.bone.key,forceActor1:b.bone.key,
   stiffness:1000,damping:50,minDistance:0,maxDistance:0,collisionEnabled:false,preprocessingEnabled:true,
   anchorAssignment:a.centerBody.position.slice(),connectedAnchorAssignment:b.centerBody.position.slice(),
   anchorPolicy:'UNRESOLVED: Unity local anchor, scale and autoConfigureConnectedAnchor ordering must be verified',strength:m.strength,canExpand:m.canExpand,userId:m.userID??''});
 }
 return {status:'construction-candidate-not-simulated',actors,hinges,fixed,springSources,
  blockers:['Unity capsule scaling/inertia reference validation','Joint trigger-only and legacy colliderless inertia','Muscle anchor setter/auto-configuration order','Physics material and collision-layer mapping','Real PhysX WASM execution and integration tests']};
}
