import assert from 'node:assert/strict';
import PhysX from 'physx-js-webidl';
import {openPhysX} from './physx-kernel.mjs';
import {FIXED_DT,requireValidatedPhysics} from './core.mjs';
// Executes the actual WASM engine; errors are not converted into a mock pass.
const world=await openPhysX(PhysX);
const out=new Float32Array(3);
try {
  assert.equal(world.engine,'PhysX');
  assert.equal(world.status,'experimental');
  assert.throws(()=>requireValidatedPhysics(world));
  const a=world.createProbeBody(0,10,0),b=world.createProbeBody(5,10,0);
  world.readPosition(a,out);assert.ok(Math.abs(out[1]-10)<1e-5);
  for(let i=0;i<10;i++)world.step();
  assert.equal(world.ticks,10);
  // Loose sanity bound includes continuous y=9 and semi-implicit y=8.9 at t=0.2, g=-50.
  world.readPosition(a,out);const first=out[1];
  assert.ok(first>8.7&&first<9.1,`Unexpected free-fall height ${first}`);
  assert.ok(Math.abs(out[0])<1e-4&&Math.abs(out[2])<1e-4);
  world.readPosition(b,out);assert.ok(Math.abs(out[1]-first)<1e-4);
  console.log(JSON.stringify({test:'actual PhysX WASM free fall',engineVersion:world.version,steps:world.ticks,simulatedSeconds:world.ticks*FIXED_DT,height:first,status:'passed',unityParity:'UNVERIFIED'}));
} finally {world.close();world.close();}
assert.throws(()=>world.step());
