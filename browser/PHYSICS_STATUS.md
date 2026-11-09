# Creature physics integration: experimental

The browser-compatible bootstrap accepts the factory supplied by physx-js-webidl. Dependency pinned to 2.9.1, inspected upstream as PhysX 5.12.0. This does not establish the PhysX version embedded in Evolution's Unity build or behavioral equivalence. No substitute solver is provided.

Implemented: foundation/physics/scene creation, source-default gravity -50, fixed 0.02-second stepping, dynamic box probes, finite pose reads and resource shutdown. The free-fall probe checks basic physics startup; it is not a substitute creature model. Probe material values are not original-game materials. No browser page, complete creature simulation or deployment is included.

Validation recorded at implementation: JavaScript syntax checks passed for the bootstrap and startup test. The WASM dependency was not downloaded or executed in the local development environment. GitHub Actions is configured to install the pinned dependency and run the 17 control-rule tests plus the actual PhysX startup test. The current Actions result must be checked before claiming successful execution. Missing packages, binding mismatches or native shutdown errors must fail the job. Workflow permissions are read-only, with no publication/deployment and a five-minute job timeout. Normal account runner billing/availability applies.

Upstream references: fabmax/physx-js-webidl dist/helloworld.html (blob 54177926b7492439af1d308b9326a753d59a4b33) for initialization API; dist/package.json (blob d0c5e5bc82e07e81ed6ff2ef57d8a9a94dae45f3) for dependency version. The adapter remains experimental and core.requireValidatedPhysics rejects it.

Next gates: verify WASM startup and iPhone browser loading; map constraints and anchors; reproduce colliders, materials, filtering and original solver settings; test hinges, springs and contact; construct complete creatures; port original genetic learning and add PPO separately. Unity-reference parity and phone performance remain unverified.
