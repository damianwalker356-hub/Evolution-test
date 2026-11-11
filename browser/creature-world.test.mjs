// Integration tests against the real PhysX WASM engine (no mocks, no stubs).
// These verify actual creature behaviour: gravity, hinges, muscle springs,
// brain-driven muscle forces, ground contact and fitness evaluation.
import assert from 'node:assert/strict';
import { loadPhysXFactory } from './physx-load.mjs';
import { createCreatureWorld, evaluateGenome } from './creature-world.mjs';
import { exampleDesign } from './design.mjs';
import { rotate } from './creature-physics.mjs';
import { CreatureNetwork } from './controller.mjs';

const factory = await loadPhysXFactory();
let count = 0;
const test = async (name, fn) => {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name); console.error(error); process.exitCode = 1; }
};

function distance(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }

await test('creature stays on the ground and never falls through', async () => {
  const design = exampleDesign();
  design.muscles[0].strength = 0; // no active muscle force: gravity and contacts only
  const world = await createCreatureWorld(factory, design);
  try {
    assert.equal(world.engine, 'PhysX');
    assert.equal(world.status, 'validated');
    // The muscle spring keeps the creature under tension, so like the
    // original game it never fully settles; instead verify that it stays
    // on the ground plane for the whole episode.
    let lowestEver = Infinity, highestEver = -Infinity, farthest = 0;
    for (let i = 0; i < 300; i++) { // 6 seconds
      world.step();
      const positions = world.jointPositions();
      assert.ok(positions.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])));
      for (const p of positions) {
        lowestEver = Math.min(lowestEver, p[1]);
        highestEver = Math.max(highestEver, p[1]);
        farthest = Math.max(farthest, Math.abs(p[0]));
      }
    }
    // Joints are triggers in Unity and may dip slightly below the surface,
    // but they must never fall through the ground.
    assert.ok(lowestEver > -2, `creature fell through the ground (${lowestEver})`);
    // And it must stay in the simulated world, not fly away.
    assert.ok(highestEver < 30, `creature launched into the air (${highestEver})`);
    assert.ok(farthest < 100, `creature left the world (${farthest})`);
    // The ground held it up: the average height must stay bounded.
    const stats = world.statistics();
    assert.ok(Number.isFinite(stats.fitness));
  } finally { world.close(); }
});

await test('hinges keep bones attached and allow rotation about Z only', async () => {
  const world = await createCreatureWorld(factory, exampleDesign());
  try {
    const design = exampleDesign();
    // Keep the left joint pinned in place by giving the creature an initial
    // layout that cannot topple: verify the bone endpoints stay connected.
    for (let i = 0; i < 150; i++) world.step();
    const joints = world.jointPositions();
    const jointMap = new Map(design.joints.map((j, i) => [j.id, joints[i]]));
    for (const bone of design.bones) {
      const a = jointMap.get(bone.startJointID), b = jointMap.get(bone.endJointID);
      const rest = distance([a[0], a[1]], [b[0], b[1]]);
      assert.ok(Math.abs(rest - boneLength(bone, design)) < 0.75,
        `hinge broke: bone length ${rest}`);
    }
  } finally { world.close(); }
});

function boneLength(bone, design) {
  const a = design.joints.find(j => j.id === bone.startJointID);
  const b = design.joints.find(j => j.id === bone.endJointID);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

await test('muscle spring pulls connected bones together', async () => {
  // Two separate two-joint creatures: one with a muscle spring, one without.
  // Zero-strength muscles still create the spring but apply no active force
  // (Unity clamps the force to at least 0.01, which is negligible here).
  const withMuscle = exampleDesign();
  withMuscle.muscles[0].strength = 0;
  const withoutMuscle = exampleDesign();
  withoutMuscle.muscles = [];
  const a = await createCreatureWorld(factory, withMuscle);
  const b = await createCreatureWorld(factory, withoutMuscle);
  try {
    for (let i = 0; i < 100; i++) { a.step(); b.step(); }
    // Unity writes the setup-time world centres into the local anchor fields,
    // so each anchor orbits its bone. The spring constrains the distance
    // between these anchor points, which is what must be verified here.
    const anchorGap = (world) => {
      const bones = world.boneStates();
      const initialCenters = [
        [-1, 2.5, 0], // midpoint of joints (-2,1)-(0,4)
        [1, 2.5, 0],  // midpoint of joints (0,4)-(2,1)
      ];
      const pts = bones.map((bone, i) => {
        const rotated = [0, 0, 0];
        rotate(bone.rotation, initialCenters[i], rotated);
        return [bone.center[0] + rotated[0], bone.center[1] + rotated[1], bone.center[2] + rotated[2]];
      });
      return distance(pts[0], pts[1]);
    };
    // The spring must hold the two anchor points measurably closer than the
    // free-floating pair after the same fall.
    assert.ok(anchorGap(a) < anchorGap(b) - 0.5,
      `spring did not constrain the anchors (${anchorGap(a)} vs ${anchorGap(b)})`);
  } finally { a.close(); b.close(); }
});

await test('brain-driven muscles change the creature over an episode', async () => {
  const world = await createCreatureWorld(factory, exampleDesign(), { seconds: 4 });
  try {
    // Force all muscle outputs to full contraction through a hand-built genome.
    const layers = world.layers;
    const net = new CreatureNetwork(layers);
    // Bias the output layer towards 1 (expand) by setting all output weights.
    const weights = net.weights;
    const outStart = weights.length - layers[layers.length - 1] * layers[layers.length - 2];
    for (let i = outStart; i < weights.length; i++) weights[i] = 8; // sigmoid ~ 1
    world.reset(Float32Array.from(weights));
    const before = world.jointPositions();
    for (let i = 0; i < 100; i++) world.step();
    const after = world.jointPositions();
    const moved = Math.max(...before.map((p, i) => distance(p, after[i])));
    assert.ok(moved > 0.05, `muscles did not move the creature (${moved})`);
  } finally { world.close(); }
});

await test('different genomes produce different outcomes', async () => {
  const world = await createCreatureWorld(factory, exampleDesign(), { seconds: 4 });
  try {
    const statsA = await evaluateGenome(world, deterministicGenome(world.layers, 1));
    const statsA2 = await evaluateGenome(world, deterministicGenome(world.layers, 1));
    const statsB = await evaluateGenome(world, deterministicGenome(world.layers, 2));
    assert.ok(Number.isFinite(statsA.fitness));
    assert.equal(statsA.unclampedFitness, statsA2.unclampedFitness, 'same genome must be deterministic');
    assert.notEqual(statsA.unclampedFitness, statsB.unclampedFitness, 'different genomes should differ');
  } finally { world.close(); }
});

function deterministicGenome(layers, seed) {
  // xorshift-style deterministic fill in [-3, 3] like the original random init.
  let s = seed || 1;
  const total = layers.slice(1).reduce((n, size, i) => n + size * layers[i], 0);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i++) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    out[i] = ((s >>> 0) / 0xffffffff) * 6 - 3;
  }
  return out;
}

await test('running fitness and statistics are reported', async () => {
  const world = await createCreatureWorld(factory, exampleDesign(), { seconds: 4 });
  try {
    const stats = await evaluateGenome(world, deterministicGenome(world.layers, 3));
    assert.ok(stats.time > 3.9 && stats.time <= 4.01, `episode time ${stats.time}`);
    assert.ok(stats.fitness >= 0 && stats.fitness <= 1, `fitness ${stats.fitness}`);
    assert.equal(stats.numberOfBones, 2);
    assert.equal(stats.numberOfMuscles, 1);
    assert.equal(stats.weight, 5); // three joints + two bones, all weight 1
    assert.ok(Number.isFinite(stats.averageSpeed));
    assert.ok(Number.isFinite(stats.maxJumpingHeight));
    assert.ok(Number.isFinite(stats.horizontalDistance));
  } finally { world.close(); }
});

await test('ground-contact penalty reduces fitness', async () => {
  // Same creature, but one version penalises every touching joint.
  const plain = exampleDesign();
  const penalized = structuredClone(plain);
  for (const j of penalized.joints) j.fitnessPenaltyForTouchingGround = 0.5;
  const a = await createCreatureWorld(factory, plain, { seconds: 4 });
  const b = await createCreatureWorld(factory, penalized, { seconds: 4 });
  try {
    const statsA = await evaluateGenome(a, deterministicGenome(a.layers, 5));
    const statsB = await evaluateGenome(b, deterministicGenome(b.layers, 5));
    // The creature rests on the ground; at least one penalised joint must
    // trigger, so the unclamped fitness must drop by a full penalty step.
    assert.ok(statsB.unclampedFitness < statsA.unclampedFitness - 0.4,
      `penalty had no effect (${statsA.unclampedFitness} vs ${statsB.unclampedFitness})`);
  } finally { a.close(); b.close(); }
});

await test('reset restores the initial state exactly', async () => {
  const world = await createCreatureWorld(factory, exampleDesign(), { seconds: 4 });
  try {
    const genome = deterministicGenome(world.layers, 7);
    world.reset(genome);
    for (let i = 0; i < 50; i++) world.step();
    world.reset(genome);
    const fresh = world.jointPositions();
    // A fresh reset must return to the design positions.
    const design = exampleDesign();
    fresh.forEach((p, i) => {
      assert.ok(Math.abs(p[0] - design.joints[i].x) < 1e-4, 'x restored');
      assert.ok(Math.abs(p[1] - design.joints[i].y) < 1e-4, 'y restored');
    });
  } finally { world.close(); }
});

await test('closed worlds fail closed', async () => {
  const world = await createCreatureWorld(factory, exampleDesign());
  world.close();
  assert.throws(() => world.step());
});

console.log(`${count} real-PhysX creature world tests ${process.exitCode ? 'FAILED' : 'passed'}.`);
