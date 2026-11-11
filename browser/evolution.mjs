// Evolution loop derived from Assets/Scripts/Controllers/Evolution.cs and
// Assets/Scripts/Data/SimulationSettings.cs. Derived-source restrictions apply.
//
// Faithful points:
//   - Defaults from SimulationSettings.Default: population 10, simulation
//     time 10 s, keep best creatures, batch simulation (batch size 10).
//   - SimulateGeneration: every chromosome is applied to a creature built
//     from the same design, simulated for the whole episode, then the
//     generation is sorted by UNCLAMPED fitness (Evolution.cs
//     SortGenerationByFitness) and new chromosomes are created with
//     keep-best-two, pairwise recombination and per-child mutation
//     (CreateNewChromosomes + Mutated: chance = mutationRate * 100 percent).
//   - Creatures are simulated in batches (Evolution.cs SimulateInBatches):
//     every creature of a batch runs simultaneously, each in its own scene on
//     a single shared PhysX foundation. Creatures in different scenes never
//     collide, exactly like the original, so batching does not change any
//     creature's result. The worlds are created once and reused for every
//     batch and generation (reset re-poses the same bodies).
import { createCreatureWorld, createSharedPhysics, evaluateGenome } from './creature-world.mjs';
import { CreaturePopulation } from './controller.mjs';

const DEFAULTS = {
  populationSize: 10, // SimulationSettings.Default.PopulationSize
  seconds: 10,         // SimulationSettings.Default.SimulationTime
  keepBest: true,      // SimulationSettings.Default.KeepBestCreatures
  batchSize: 10,       // SimulationSettings.Default.BatchSize
};

function median(sortedValues) {
  const mid = sortedValues.length >> 1;
  return sortedValues.length % 2 ? sortedValues[mid]
    : (sortedValues[mid - 1] + sortedValues[mid]) / 2;
}

export class CreatureTrainer {
  constructor({
    factory, design,
    populationSize = DEFAULTS.populationSize,
    seconds = DEFAULTS.seconds,
    intermediateLayers,
    seed = 1,
    selection = 0, crossover = 0, mutation = 0,
    mutationRate = 0.05, keepBest = DEFAULTS.keepBest,
    batchSize = DEFAULTS.batchSize,
  } = {}) {
    if (typeof factory !== 'function') throw new TypeError('PhysX module factory required');
    if (!design) throw new TypeError('creature design required');
    if (!Number.isInteger(populationSize) || populationSize < 2 || populationSize > 1000) {
      throw new RangeError('invalid population size');
    }
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 120) {
      throw new RangeError('invalid episode length');
    }
    if (![0, 1, 2, 3].includes(selection) || ![0, 1, 2].includes(crossover) || ![0, 1, 2].includes(mutation)) {
      throw new RangeError('invalid evolution algorithm selection');
    }
    if (!Number.isFinite(mutationRate) || mutationRate < 0 || mutationRate > 1) {
      throw new RangeError('invalid mutation rate');
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1000) {
      throw new RangeError('invalid batch size');
    }
    this.factory = factory;
    this.design = design;
    this.populationSize = populationSize;
    this.seconds = seconds;
    this.intermediateLayers = intermediateLayers;
    this.batchSize = Math.min(batchSize, populationSize);
    this.populationSettings = { seed, selection, crossover, mutation, mutationRate, keepBest };
    this.sharedPhysics = null;
    this.worlds = null; // reusable batch of worlds on the shared foundation
    this.population = null;
    this.history = []; // one report per completed generation
  }

  get generation() { return this.population ? this.population.generation : 0; }
  // Compatibility for callers that evaluate a single genome (playback etc.).
  get world() { return this.worlds ? this.worlds[0] : null; }

  // Creates one shared PhysX foundation, the reusable batch of worlds and the
  // initial random population.
  async init() {
    if (this.worlds) return this;
    this.sharedPhysics = await createSharedPhysics(this.factory);
    try {
      this.worlds = [];
      for (let i = 0; i < this.batchSize; i++) {
        this.worlds.push(await createCreatureWorld(this.factory, this.design, {
          seconds: this.seconds,
          intermediateLayers: this.intermediateLayers,
          physics: this.sharedPhysics,
        }));
      }
    } catch (error) {
      this.close();
      throw error;
    }
    // All worlds compute the same network shape from the same design.
    this.population = new CreaturePopulation({
      layers: this.worlds[0].layers,
      size: this.populationSize,
      ...this.populationSettings,
    });
    return this;
  }

  // Simulates every creature of the current generation once and creates the
  // next generation. Returns the generation report.
  async runGeneration() {
    if (!this.worlds) throw new Error('Trainer not initialized');
    const fitness = new Float32Array(this.populationSize);
    const stats = [];
    const batches = Math.ceil(this.populationSize / this.batchSize);
    for (let batch = 0; batch < batches; batch++) {
      const start = batch * this.batchSize;
      const count = Math.min(this.batchSize, this.populationSize - start);
      // Apply this batch's chromosomes to the reusable worlds.
      for (let i = 0; i < count; i++) {
        this.worlds[i].reset(this.population.networks[start + i].weights);
      }
      // Step the whole batch simultaneously until every episode ends.
      let running = true;
      while (running) {
        running = false;
        for (let i = 0; i < count; i++) {
          if (this.worlds[i].step()) running = true;
        }
      }
      for (let i = 0; i < count; i++) {
        const result = this.worlds[i].statistics();
        stats.push(result);
        // CreaturePopulation.advance requires nonnegative fitness; the
        // world already clamps to [0, 1] as RunningObjectiveTracker does.
        fitness[start + i] = result.fitness;
      }
    }
    this.population.advance(fitness);
    const ranked = stats
      .map((s, i) => ({ index: i, stats: s }))
      .sort((a, b) => b.stats.unclampedFitness - a.stats.unclampedFitness);
    const sortedFitness = [...fitness].sort((a, b) => a - b);
    const report = {
      generation: this.generation - 1, // the generation that was just simulated
      fitness: [...fitness],
      ranking: ranked.map(r => r.index), // indices sorted by unclamped fitness
      best: ranked[0],
      worst: ranked[ranked.length - 1],
      average: fitness.reduce((n, x) => n + x, 0) / this.populationSize,
      median: median(sortedFitness),
    };
    this.history.push(report);
    return report;
  }

  // Runs n generations; onProgress(generationReport) is awaited after each.
  async run(generations, onProgress) {
    if (!Number.isInteger(generations) || generations < 1 || generations > 10000) {
      throw new RangeError('invalid generation count');
    }
    await this.init();
    let last;
    for (let g = 0; g < generations; g++) {
      last = await this.runGeneration();
      if (onProgress) await onProgress(last);
    }
    return last;
  }

  close() {
    if (this.worlds) { for (const world of this.worlds) world.close(); this.worlds = null; }
    if (this.sharedPhysics) { this.sharedPhysics.close(); this.sharedPhysics = null; }
    this.population = null;
  }
}

// Run one full episode of a single world. Kept for callers that evaluate one
// genome at a time (playback); the trainer itself uses batched worlds.
export { evaluateGenome };
