// Evolution loop derived from Assets/Scripts/Controllers/Evolution.cs and
// Assets/Scripts/Data/SimulationSettings.cs. Derived-source restrictions apply.
//
// Faithful points:
//   - Defaults from SimulationSettings.Default: population 10, simulation
//     time 10 s, keep best creatures, batch simulation.
//   - SimulateGeneration: every chromosome is applied to a creature built
//     from the same design, simulated for the whole episode, then the
//     generation is sorted by UNCLAMPED fitness (Evolution.cs
//     SortGenerationByFitness) and new chromosomes are created with
//     keep-best-two, pairwise recombination and per-child mutation
//     (CreateNewChromosomes + Mutated: chance = mutationRate * 100 percent).
//   - Creatures in a generation never interact (each runs in its own batch),
//     so evaluating them sequentially in one world is physically identical
//     to Unity's batched simulation and keeps a single PhysX foundation.
import { createCreatureWorld, evaluateGenome } from './creature-world.mjs';
import { CreaturePopulation } from './controller.mjs';

const DEFAULTS = {
  populationSize: 10, // SimulationSettings.Default.PopulationSize
  seconds: 10,         // SimulationSettings.Default.SimulationTime
  keepBest: true,      // SimulationSettings.Default.KeepBestCreatures
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
    this.factory = factory;
    this.design = design;
    this.populationSize = populationSize;
    this.seconds = seconds;
    this.intermediateLayers = intermediateLayers;
    this.populationSettings = { seed, selection, crossover, mutation, mutationRate, keepBest };
    this.world = null;
    this.population = null;
    this.history = []; // one report per completed generation
  }

  get generation() { return this.population ? this.population.generation : 0; }

  // Creates the PhysX world (one foundation for the whole run) and the
  // initial random population.
  async init() {
    if (this.world) return this;
    this.world = await createCreatureWorld(this.factory, this.design, {
      seconds: this.seconds,
      intermediateLayers: this.intermediateLayers,
    });
    // The world computes the network shape from the design; the population
    // must build chromosomes of exactly that size.
    this.population = new CreaturePopulation({
      layers: this.world.layers,
      size: this.populationSize,
      ...this.populationSettings,
    });
    return this;
  }

  // Simulates every creature of the current generation once and creates the
  // next generation. Returns the generation report.
  async runGeneration() {
    if (!this.world) throw new Error('Trainer not initialized');
    const fitness = new Float32Array(this.populationSize);
    const stats = [];
    for (let i = 0; i < this.populationSize; i++) {
      // Sequential evaluation: batch of one, like Unity with batches of 1.
      const result = await evaluateGenome(this.world, this.population.networks[i].weights);
      stats.push(result);
      // CreaturePopulation.advance requires nonnegative fitness; the world
      // already clamps to [0, 1] exactly as RunningObjectiveTracker does.
      fitness[i] = result.fitness;
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
    if (this.world) { this.world.close(); this.world = null; }
    this.population = null;
  }
}
