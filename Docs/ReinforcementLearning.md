# PPO sprint training (experimental, requires Unity validation)

This is an opt-in training lifecycle for the existing game, not a replacement for genetic evolution in normal play. It has NOT been compiled or run in Unity as part of this change. Do not interpret its presence as demonstrated running performance.

## Versions

Project editor: Unity 6000.2.6f2. Unity ML-Agents dependency: 4.0.0. Use Python 3.10.12 and `python -m pip install mlagents==1.1.0` in a clean virtual environment (ML-Agents Release 23 compatible pair). Let Unity resolve and regenerate Packages/packages-lock.json; it is not hand-edited here.

## Start training

1. Open the Unity project and let packages resolve. Fix any Console compile errors before continuing.
2. Start a trainer from the repository root: `mlagents-learn config/sprinter.yaml --run-id=sprinter-v1`.
3. Enable the explicit training switch before launching Unity: environment variable `EVOLUTION_RL=1`, or pass `--evo-rl` to a built player. The variable must be inherited by the Editor/player process. On Windows PowerShell: `$env:EVOLUTION_RL='1'`, then launch the Unity executable from that shell with `-projectPath` pointing to this repository. Unity Hub already running elsewhere may not inherit the variable.
4. Enter Play from the game's normal editor entry scene, load/build ONE creature design, choose Running and a flat/static running arena, then start the simulation as usual. The genetic Evolution component is disabled before Start; the RL session reads the existing SimulationConfigContainer.
5. Look for `RL ready` and a Python trainer connection. Eight identical creatures run in separate local 3D physics scenes, without creature-to-creature collisions. No scene scanning by class-name suffix or brain races are used.
6. Stop Play to stop training. Unset EVOLUTION_RL/remove --evo-rl and restart Play for normal gameplay. Do not use genetic generation, playback, pause, or save controls during an RL session; their UI is not adapted to RL.

## Design and limitations

The session owns Academy stepping and manually simulates each arena exactly once per fixed tick, after policy commands and muscle forces. Muscle MonoBehaviour updates are disabled to prevent duplicate force application; line positions are refreshed explicitly. There is no DecisionRequester. Decisions occur every five physics steps and actions are held between decisions.

Each episode lasts round(20/fixedDeltaTime) physics steps, with a terminal transition after the final step. At dt=0.02 this is exactly 20 seconds. Reward is 0.1 times signed COM displacement, measured after physics; cumulative undiscounted reward equals 0.1 times net displacement. PPO gamma 0.999 mildly favors earlier progress; this is not a mathematically undiscounted optimizer. No time/laziness/energy shaping or fall termination is imposed by default, avoiding an incentive to end runs early. Tumbling/crawling are allowed by this distance-only objective; add validated torso-contact constraints only if actual running, rather than maximum travel, is a hard requirement.

Observations: COM planar velocity, relative COM height, elapsed fraction, seven values per dynamic body (relative position/velocity, sin/cos angle, angular speed), joint contact flags, and previous commands. Ordering follows serialized component IDs. Use a new run ID after changing morphology, IDs, action dimensions or observation schema. Non-expanding muscles map [-1,1] onto [0,maxForce]. Exact zero force bypasses the game's SetContractionForce minimum clamp. Numerical nonfinite states receive -10 and reset.

Supported: one fixed non-legacy creature morphology, static flat running scene. Moving obstacles/platforms and environment randomization are not reset per episode. Existing joint trigger booleans are masked on the first reset sample but otherwise retain the game's existing contact implementation. Warm-starts, domain randomization, ONNX inference UI/model loading, genetic-save conversion, and RL playback are not implemented. PPO checkpoints/models are produced by the Python trainer, not .evol saves. No automatic attachment occurs in normal play.

## Required validation before a long run

- Compile in Unity 6000.2.6f2 and confirm package/namespace/API compatibility.
- Confirm `RL ready`, expected observation/action counts, no genetic batch coroutine, no old TimeDecaySprinter/SprinterTrainingBootstrap components or duplicate Agent scripts.
- At dt=0.02, confirm each terminal episode is 1000 actual scene simulations and no MaxStep auto-reset occurs.
- Verify single positive and negative muscle commands contract/expand the intended IDs and contract-only muscles never expand.
- Verify resets restore all body poses/velocities without explosive joint impulses; inspect stale collision flags after teleport.
- Check static arena structures and isolated physics scenes survive repeated resets. Test at least 100 episodes without NaNs or deleted creatures.
- Compare Sprint/DistanceUnits with 10 times cumulative undiscounted reward for finite runs; compare training seeds against the existing genetic baseline under identical body, physics and 20-second duration.
- Watch TensorBoard: `tensorboard --logdir results`. Use new run IDs for distinct designs; use `--resume` only for unchanged behavior schemas.

This configuration is a baseline, not a claim of the best possible network or guaranteed convergence.
