# Creature genetic learning: operator port

This module preserves the original learning rules separately from future PPO. It is not yet a complete trainer: neural-network evaluation, observation collection, full population lifecycle, original fitness penalties and simulation integration remain unfinished.

Sources inspected: Assets/Scripts/Util/Mutation.cs (2d312ad3a8f1562e1349590961db8633197d5e50), Recombination.cs (0ee8179b4ef72d3f03d87f0266b70839d62bf032), Selection.cs (a058fd02f5711dfe1ef1734724a86930f1e6bbdd), RandomPicker.cs (17c4305b7293f7ec4bc05e93838d04f4d94f9603), GaussianPRNG.cs (2094f158d0399705e30988d16d17712e469cad07), RunningObjectiveTracker.cs (47acf7dbf6c6df2ede243ec16ed8c348b89636d0).

Ported: three mutation modes; three crossover modes; uniform, fitness-proportional, three-candidate tournament and rank selection; paired Box-Muller Gaussian offsets; raw running fitness based on joint-mean horizontal displacement divided by 55 times duration. This fitness is NOT COM-based and is separate from the future RL reward. Source statistics later apply penalties and lower-bound fitness; callers must supply nonnegative finalized fitness to selection.

Compatibility quirks retained: chunk mutation compares i to length rather than start+length and may do nothing; inversion excludes the last weight due to exclusive integer ranges; global mutation uses integer draw 1..99 >25; multipoint crossover partitions deterministically rather than choosing random cuts; lowest rank gets zero weight; zero total selection weight falls back to the last sorted item. These are not silently repaired.

Deliberate differences: browser-seeded generator is reproducible but does not match Unity's PRNG. Equal-fitness sorting uses JavaScript stable ordering, not a guarantee of Unity List.Sort tie order. Numeric rounding follows Float32 where implemented, without bitwise C# validation. Invalid/degenerate inputs are rejected rather than reproducing crashes. No claim of identical generations or trained behavior.

Twenty deterministic rule tests were executed locally and passed. CI will also run them through npm test. The real PhysX startup test and full-repository audit result remain separately unverified. No unrelated simulation features are introduced.
