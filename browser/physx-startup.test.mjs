// Startup check for the real PhysX WASM engine through the unified loader.
// The browser build and the Node test shim take the same factory path used
// by the creature world, so this proves the loader itself works everywhere.
import assert from 'node:assert/strict';
import { loadPhysXFactory } from './physx-load.mjs';
import { openPhysX } from './physx-kernel.mjs';
import { FIXED_DT, requireValidatedPhysics } from './core.mjs';

const factory = await loadPhysXFactory();
const world = await openPhysX(factory);
const out = new Float32Array(3);
try {
  assert.equal(world.engine, 'PhysX');
  assert.equal(world.status, 'experimental');
  assert.throws(() => requireValidatedPhysics(world));
  const a = world.createProbeBody(0, 10, 0), b = world.createProbeBody(5, 10, 0);
  world.readPosition(a, out); assert.ok(Math.abs(out[1] - 10) < 1e-5);
  for (let i = 0; i < 10; i++) world.step();
  assert.equal(world.ticks, 10);
  world.readPosition(a, out); const first = out[1];
  assert.ok(first > 8.7 && first < 9.1, `Unexpected free-fall height ${first}`);
  assert.ok(Math.abs(out[0]) < 1e-4 && Math.abs(out[2]) < 1e-4);
  world.readPosition(b, out); assert.ok(Math.abs(out[1] - first) < 1e-4);
  console.log(JSON.stringify({ test: 'actual PhysX WASM free fall', engineVersion: world.version, steps: world.ticks, simulatedSeconds: world.ticks * FIXED_DT, height: first, status: 'passed', unityParity: 'UNVERIFIED' }));
} finally { world.close(); world.close(); }
assert.throws(() => world.step());
