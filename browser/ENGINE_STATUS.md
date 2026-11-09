# Actual PhysX engine integration: experimental

The browser-compatible bootstrap now accepts the factory supplied by physx-js-webidl. Dependency pinned to 2.9.1, inspected upstream as PhysX 5.12.0. This is NOT proof of the engine version embedded in Evolution's Unity build or of behavioral equivalence. No solver replacement is provided.

Implemented: foundation/physics/scene creation, source-default gravity -50, fixed 0.02-second stepping, actual dynamic box probes, finite pose reads and resource shutdown. A box free-fall probe is an ENGINE TEST, not a substitute creature model. Probe friction/material defaults are explicitly not original-game materials. No browser page, creature solver integration or deployment is included in this commit.

Local validation: node --check passed for both new modules. The WASM dependency was NOT downloaded/executed in the local development environment. GitHub Actions is configured to install the pinned npm dependency and execute both the 17 earlier module tests and the actual-engine test. A committed test is not a passing test: inspect the Actions run before claiming startup success. Missing package versions, binding mismatches or native shutdown errors must fail the job. Workflow has read-only contents permission, no publication/deployment, and a five-minute job timeout. Normal account runner billing/availability applies.

Upstream references: fabmax/physx-js-webidl dist/helloworld.html (blob 54177926b7492439af1d308b9326a753d59a4b33) for initialization API; dist/package.json (blob d0c5e5bc82e07e81ed6ff2ef57d8a9a94dae45f3) for dependency version. The adapter remains status experimental, so core.requireValidatedPhysics rejects it.

Next gates: verify actual WASM startup; browser/iPhone loading; map constraints and local anchors; reproduce colliders/materials/filtering and source solver settings; add hinge/spring/contact tests; build complete creature; port genetic learning and add PPO separately. Nothing here establishes Unity-reference parity or phone performance.
