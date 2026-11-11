# Creature physics integration: real PhysX creature world, Unity parity unverified

The simulator now runs the actual PhysX 5.12.4 WASM engine (physx-js-webidl 2.9.1, engine version 84672512) in Node tests and in the GitHub Pages browser build. The engine is vendored into browser/vendor so no npm install is required at runtime. A unified loader (physx-load.mjs) takes the same factory path in the browser and in Node, shimming the browser-only build into Node for CI.

Implemented in creature-world.mjs, following the Unity source in Assets/Scripts/Creature:
- Joint bodies: trigger spheres, radius 0.5, constraints 120, sphere CCD off.
- Bones: capsule radius 0.5, length per the design, constraints 56, angular drag 0.05.
- D6 hinge joints about the world Z axis (the Unity hinge axis) with the original maxForce, replaced by distance joints (spring stiffness 1000, damping 50) when the muscle has zero offset, matching Muscle.cs.
- Muscle anchors in the Unity convention (0.2 past the bone tip when oriented, raw position otherwise), contract/expand explicit forces applied at the anchor.
- Wing forces, ray output and the 11-input universal brain loop with per-muscle outputs.
- Running objective: fitness = (average x - initial x) / (55 * time) with ground-contact penalties, clamped to [0,1], exactly as RunningObjectiveTracker.cs computes it.
- Ground contact approximated as joint y < 0.5 instead of Unity trigger events; rays are analytic against flat ground only. Wings exist as forces but obstacles and other scenes are not implemented.

Validation status: all 109 tests in npm test pass locally and in GitHub Actions (commit cf8cd44), including 9 real-PhysX creature-world tests: resting stability, hinge limits, muscle spring response, brain-driven muscle control, genome differences, fitness statistics, penalty application, reset and world teardown. The free-fall probe and full test suite execute the real solver; no substitute solver or fake fitness is used.

Still unverified: Unity behavioral parity (positions, forces and fitness numbers have not been compared against the original game), browser loading on a phone, and per-frame performance. The evaluation loop, selection and mutation are not yet wired into the UI; Run and Train buttons stay disabled until they are real.

Upstream references: fabmax/physx-js-webidl dist/helloworld.html (blob 54177926b7492439af1d308b9326a753d59a4b33) for initialization API; dist/package.json (blob d0c5e5bc82e07e81ed6ff2ef57d8a9a94dae45f3) for dependency version. Unity source of truth: Assets/Scripts/Creature/Creature.cs, Body/Joint.cs, Bone.cs, Muscle.cs, Brains/Brain.cs, UniversalBrain.cs, Util/RunningObjectiveTracker.cs.

Next gates: browser loading test on GitHub Pages, population evaluation with a shared foundation, then the evolution loop and simulation screen UI.
