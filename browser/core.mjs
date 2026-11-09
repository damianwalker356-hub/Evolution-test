// Ported from Evolution Brain.cs, UniversalBrain.cs and Muscle.cs.
// Upstream copyright and personal/educational-use restrictions still apply.
// No physics solver is implemented or substituted in this module.
const f = Math.fround;
export const SOURCE_COMMIT = '093102e3a1fbed01edc317cb9848d5b8f11d836f';
export const FIXED_DT = 0.02;
export const EPISODE_STEPS = 1000;
export const SCENE_DEFAULTS = Object.freeze({gravityY:-50,bounceThreshold:2,sleepThreshold:0.005,contactOffset:0.01,solverPositionIterations:7,solverVelocityIterations:10,queriesHitBackfaces:false,queriesHitTriggers:true});
export const MUSCLE_SPRING = Object.freeze({stiffness:1000,damping:50,minDistance:0,maxDistance:0,enableCollision:false,enablePreprocessing:true});
function finite(x,name) { if (!Number.isFinite(x)) throw new TypeError(`${name} must be finite`); return x; }
function vector(v,name) { if (!v || v.length!==3) throw new TypeError(`${name} must have three components`); for(const x of v) finite(x,name); }
export function uniqueMuscles(muscles) {
  const ids=new Map(); const indices=new Int32Array(muscles.length); let count=0;
  muscles.forEach((m,i)=>{
    if(typeof m.userId!=='string') throw new TypeError('userId must be an explicit string');
    if(m.userId==='') indices[i]=count++;
    else {if(!ids.has(m.userId)) ids.set(m.userId,count++); indices[i]=ids.get(m.userId);}
  });
  return {count,indices};
}
// Brain output in [0,1]; NaN is replaced with zero, as in Brain.ApplyOutputs.
export function decodeBrainOutput(output,strength,canExpand=true,living=true) {
  finite(strength,'strength'); if(strength<0) throw new RangeError('negative strength');
  if(Number.isNaN(output)) output=0;
  finite(output,'output'); if(output<0 || output>1) throw new RangeError('expected sigmoid output in [0,1]');
  const percent=f(f(2*f(output))-1);
  const action=percent<0?'contract':'expand';
  const force=f(Math.max(f(0.01),Math.min(f(strength),f(Math.abs(percent)*f(strength)))));
  return {action,force,active:living && (action==='contract'||canExpand)};
}
// Explicit RL adapter to the SAME action convention, not an unlabelled replacement.
export function rlToBrainOutput(action) {finite(action,'action'); if(action< -1||action>1) throw new RangeError('action outside [-1,1]'); return f(f(f(action)+1)*0.5);}
// Caller owns two persistent three-component output buffers: no per-step allocation.
// Unity uses (midpoint - endpoint).normalized, including its near-zero threshold.
export function muscleForces(start,end,state,outStart,outEnd) {
  vector(start,'start'); vector(end,'end');
  if(!outStart || outStart.length!==3 || !outEnd || outEnd.length!==3 || outStart===outEnd || outStart===start || outStart===end || outEnd===start || outEnd===end) throw new TypeError('distinct output buffers required');
  if(state.action!=='contract'&&state.action!=='expand') throw new TypeError('unknown muscle action');
  finite(state.force,'force'); if(state.force<0) throw new RangeError('negative force');
  const sign=state.action==='contract'?1:-1;
  for(let side=0;side<2;side++) {
    const p=side===0?start:end, out=side===0?outStart:outEnd;
    let sum=f(0);
    for(let k=0;k<3;k++){const mid=f(f(start[k]+end[k])/2);out[k]=f(mid-p[k]);sum=f(sum+f(out[k]*out[k]));}
    const length=f(Math.sqrt(sum));
    for(let k=0;k<3;k++) out[k]=state.active && length>f(1e-5)?f(f(out[k]/length)*f(sign*state.force)):0;
  }
}
export function nextRayAngle(previous,output) {finite(previous,'previous');finite(output,'output');if(output<0||output>1) throw new RangeError('invalid ray output');const target=f(f(f(output)*2)*f(Math.PI));return f(f(f(0.1)*target)+f(f(0.9)*f(previous)));}
// Intentionally fails closed until the real solver adapter has passed its integration gates.
export function requireValidatedPhysics(backend) {
  if(!backend || backend.status!=='validated' || backend.engine!=='PhysX' || typeof backend.step!=='function') throw new Error('PhysX integration is not validated. Simulation and learning are disabled.');
  return backend;
}
