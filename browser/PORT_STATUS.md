# Browser port: first implementation

Target: iPhone 12 Pro Max, Chrome on current supported stable iOS. Source baseline: 093102e3a1fbed01edc317cb9848d5b8f11d836f. Original Unity source stays intact. No public deployment is included.

Implemented: muscle force calculation with caller-owned buffers; original sigmoid-to-muscle direction and minimum force; linked-muscle output mapping in source order; custom sensor-angle smoothing; explicit RL action adapter; source scene defaults; 20-second fixed-step horizon. Seventeen Node tests executed successfully in the development environment. Run `node browser/core.test.mjs`. These are module tests, not Unity comparisons. Float32 rounding is used, but bitwise engine parity is NOT established.

Source audit evidence:
- Assets/Scripts/Creature/Brains/Brain.cs: linked IDs, sigmoid output mapping, NaN fallback. Low output contracts, high output expands.
- Assets/Scripts/Creature/Brains/UniversalBrain.cs: 11 inputs, one additional custom-ray output, ray length 20, angle smoothing 0.1. Full input collection remains to port.
- Assets/Scripts/Creature/Body/Muscle.cs: spring stiffness 1000, damping 50, zero min/max distances; opposing force at bone centers; nonexpanding and nonliving behavior. Spring anchor local/world mapping requires investigation.
- Assets/Resources/Prefabs/Joint.prefab: sphere radius 0.5, TRIGGER, constraints 120; do not substitute solid foot spheres.
- Assets/Resources/Prefabs/Bone.prefab: enabled capsule radius 0.5, height 2, Y axis, nonuniform transform scale; disabled box collider; damping 0/0.05, constraints 56, auto COM and inertia. Collider scaling and inertia mapping remain unverified.
- Assets/Scripts/Creature/Body/Bone.cs: legacy extra rigidbody/fixed joint and wing-force behavior exist and must not be silently discarded.
- ProjectSettings/TimeManager.asset: fixed timestep 0.02.
- Assets/Scripts/Scenes/ScenePhysicsConfiguration.cs: defaults captured in core.mjs; actual scene overrides still must be loaded.

Physics progress (see PHYSICS_STATUS.md): the real PhysX 5.12.4 WASM engine now runs in Node tests and in the GitHub Pages browser build through the vendored browser/vendor engine files. Body construction, D6 hinges, muscle springs with the original anchors, wing forces, the 11-input brain loop and the running objective are implemented and tested against the real solver (109 tests, all passing locally and in Actions at commit cf8cd44). No fallback solver, fake learned gait or kinematic animation is supplied; `requireValidatedPhysics` is a programming guard, not proof of physical equivalence.

Remaining blockers before a complete simulator: Unity parity of numbers is unverified; the population/evolution loop (evaluation of all creatures per generation, selection, crossover, mutation) is not yet wired into the UI; the simulation screen (playback, population view with ghosts, neural-network settings) and save/load persistence are not built; browser loading on a phone and per-frame performance are untested; obstacles and non-flat scenes are not implemented.

Acceptance: source feature coverage plus numerical and integration tests; Unity reference trajectories are unavailable and exact equivalence is unverified. Do not claim the complete physics or learning system is implemented. Preserve original notices and restrictions on all derived source.
