// Integration tests for the evolution loop against the real PhysX engine.
// Small population and short episodes keep the runtime bounded while still
// executing every real simulation step.
import assert from 'node:assert/strict';
import { loadPhysXFactory } from './physx-load.mjs';
import { CreatureTrainer } from './evolution.mjs';
import { createSharedPhysics, createCreatureWorld, evaluateGenome } from './creature-world.mjs';
import { CreatureNetwork } from './controller.mjs';
import { exampleDesign } from './design.mjs';

const factory = await loadPhysXFactory();
let count = 0;
const test = async (name, fn) => {
  try { await fn(); count++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name); console.error(error); process.exitCode = 1; }
};

await test('trainer rejects invalid settings without touching PhysX', async () => {
  assert.throws(() => new CreatureTrainer({ factory, design: exampleDesign(), populationSize: 1 }), RangeError);
  assert.throws(() => new CreatureTrainer({ factory, design: exampleDesign(), seconds: 0 }), RangeError);
  assert.throws(() => new CreatureTrainer({ factory, design: exampleDesign(), populationSize: 10.5 }), RangeError);
  assert.throws(() => new CreatureTrainer({ factory }), TypeError);
  assert.throws(() => new CreatureTrainer({ factory, design: exampleDesign(), mutationRate: 2 }), RangeError);
});

await test('two generations run on the real engine with real fitness', async () => {
  const trainer = new CreatureTrainer({
    factory, design: exampleDesign(),
    populationSize: 4, seconds: 1, seed: 7,
  });
  try {
    await trainer.init();
    assert.equal(trainer.generation, 1);
    const chromosomesBefore = trainer.population.networks.map(n => n.weights);
    const first = await trainer.runGeneration();
    assert.equal(first.generation, 1);
    assert.equal(first.fitness.length, 4);
    for (const value of first.fitness) {
      assert.ok(Number.isFinite(value));
      assert.ok(value >= 0 && value <= 1, `fitness out of range: ${value}`);
    }
    assert.ok(Number.isFinite(first.average));
    assert.ok(Number.isFinite(first.median));
    assert.ok(first.best.stats.unclampedFitness >= first.worst.stats.unclampedFitness);
    assert.equal(trainer.generation, 2);
    // Evolution.cs CreateNewChromosomes with keepBest: the next generation's
    // first two chromosomes are exact copies of the two best creatures.
    assert.deepEqual(trainer.population.networks[0].weights, chromosomesBefore[first.ranking[0]]);
    assert.deepEqual(trainer.population.networks[1].weights, chromosomesBefore[first.ranking[1]]);
    const second = await trainer.runGeneration();
    assert.equal(second.generation, 2);
    assert.equal(trainer.history.length, 2);
    const stats = second.best.stats;
    assert.ok(Number.isFinite(stats.fitness) && Number.isFinite(stats.horizontalDistance));
  } finally { trainer.close(); }
});

await test('same seed reproduces the same fitness sequence deterministically', async () => {
  const run = async () => {
    const trainer = new CreatureTrainer({
      factory, design: exampleDesign(),
      populationSize: 3, seconds: 1, seed: 42,
    });
    try {
      const a = await trainer.run(1);
      const b = await trainer.run(1);
      return [a.fitness, b.fitness];
    } finally { trainer.close(); }
  };
  const left = await run();
  const right = await run();
  assert.deepEqual(left, right);
});

await test('run(n, onProgress) reports each generation and closes cleanly', async () => {
  const trainer = new CreatureTrainer({
    factory, design: exampleDesign(),
    populationSize: 3, seconds: 1, seed: 3,
  });
  const seen = [];
  const last = await trainer.run(2, report => { seen.push(report.generation); });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen, [1, 2]);
  assert.equal(last.generation, 2);
  assert.equal(trainer.generation, 3);
  trainer.close();
  assert.equal(trainer.world, null);
  await assert.rejects(() => trainer.runGeneration(), /initialized/);
});

await test('the best chromosome re-evaluates to the same fitness on the real engine', async () => {
  const trainer = new CreatureTrainer({
    factory, design: exampleDesign(),
    populationSize: 3, seconds: 1, seed: 11,
  });
  try {
    const report = await trainer.run(1);
    // With keepBest, population member 0 is a verbatim copy of the best
    // chromosome. Deterministic single-threaded stepping means re-evaluating
    // that exact genome must reproduce the generation-best statistics.
    trainer.world.reset(trainer.population.networks[0].weights);
    while (trainer.world.step()) {}
    const replay = trainer.world.statistics();
    assert.ok(Math.abs(replay.unclampedFitness - report.best.stats.unclampedFitness) < 1e-4,
      `replayed ${replay.unclampedFitness} vs generation best ${report.best.stats.unclampedFitness}`);
    assert.ok(Math.abs(replay.horizontalDistance - report.best.stats.horizontalDistance) < 1e-4);
  } finally { trainer.close(); }
});

await test('batched worlds on one shared foundation match solo evaluation exactly', async () => {
  const design = exampleDesign();
  const shared = await createSharedPhysics(factory);
  try {
    const worldA = await createCreatureWorld(factory, design, { seconds: 1, physics: shared });
    const worldB = await createCreatureWorld(factory, design, { seconds: 1, physics: shared });
    const alone = await createCreatureWorld(factory, design, { seconds: 1, physics: shared });
    try {
      const layers = worldA.layers;
      const rng = (await import('./genetics.mjs')).createRandom;
      const genomeA = new CreatureNetwork(layers, undefined, rng(101)).weights;
      const genomeB = new CreatureNetwork(layers, undefined, rng(202)).weights;
      // Run both worlds simultaneously, each with its own genome.
      worldA.reset(genomeA); worldB.reset(genomeB);
      let liveA = true, liveB = true;
      while (liveA || liveB) {
        if (liveA) liveA = worldA.step();
        if (liveB) liveB = worldB.step();
      }
      const batchedA = worldA.statistics(), batchedB = worldB.statistics();
      // Now run genome A entirely alone: batching must not change physics.
      const soloStats = await evaluateGenome(alone, genomeA);
      assert.ok(Math.abs(soloStats.unclampedFitness - batchedA.unclampedFitness) < 1e-4,
        `solo ${soloStats.unclampedFitness} vs batched ${batchedA.unclampedFitness}`);
      assert.ok(Math.abs(soloStats.horizontalDistance - batchedA.horizontalDistance) < 1e-4);
      assert.notDeepEqual([...genomeA], [...genomeB]);
    } finally { worldA.close(); worldB.close(); alone.close(); }
  } finally { shared.close(); }
});

console.log(`${count} evolution tests passed; real PhysX execution, Unity parity unverified`);
