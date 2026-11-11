// Real PhysX execution of the Evolution creature model.
// Physics mapped from the Unity source (Joint.prefab, Bone.prefab, Muscle.cs,
// Joint.cs, Bone.cs, UniversalBrain.cs, Creature.cs, RunningObjectiveTracker.cs):
//   - gravity (0, -50, 0) from ProjectSettings/DynamicsManager.asset
//   - joints: trigger spheres (radius 0.5, mass = weight, all rotation locked,
//     Z position locked) -> no physical collision, ground contact by overlap
//   - bones: capsule colliders (radius 0.5*width, length along Y), mass = weight
//     (legacy bones: 2*weight - 1 plus a 1 kg fixed extra body), angular damping
//     0.05, rotation locked to the Z axis, Z position locked
//   - joint<->bone hinges: rotation about world Z only, no limits
//   - muscles: soft spring (stiffness 1000, damping 50, min/max distance 0)
//     plus explicit contraction/expansion forces at the bone centres
//   - brain: 11 inputs, one output per unique muscle + one ray-angle output
// Derived-source restrictions from Evolution-test remain applicable.
import { compileBodyCandidate, wingForce, rotate, multiply } from './creature-physics.mjs';
import { FIXED_DT, uniqueMuscles, decodeBrainOutput, muscleForces, nextRayAngle } from './core.mjs';
import { CreatureNetwork } from './controller.mjs';

const MAX_RAYCAST_DISTANCE = 20; // UniversalBrain
const MAX_DISTANCE = 55;         // RunningObjectiveTracker
export const DEFAULT_INTERMEDIATE_LAYERS = [10]; // NeuralNetworkSettings.Default

const scratch = {
  vec3: () => [0, 0, 0],
  forceA: [0, 0, 0],
  forceB: [0, 0, 0],
  wing: [0, 0, 0],
};

function quatConjugate(q) { return [-q[0], -q[1], -q[2], q[3]]; }

// World-frame transform of a body-relative point.
function localToWorld(body, local) {
  const out = scratch.vec3();
  const pose = body.getGlobalPose();
  const p = pose.get_p(), q = pose.get_q();
  const rotation = [q.get_x(), q.get_y(), q.get_z(), q.get_w()];
  const delta = [local[0], local[1], local[2]];
  // rotate() writes into out; delta must be a distinct buffer from out.
  const rotated = [0, 0, 0];
  rotate(rotation, delta, rotated);
  out[0] = p.get_x() + rotated[0];
  out[1] = p.get_y() + rotated[1];
  out[2] = p.get_z() + rotated[2];
  return out;
}

export async function createCreatureWorld(factory, design, options = {}) {
  if (!design || !Array.isArray(design.joints) || design.joints.length === 0) {
    throw new TypeError('A design with at least one joint is required');
  }
  const candidate = compileBodyCandidate(design);
  // The design stores the original game's "userID" field; the brain grouping
  // (Brain.CalculateUniqueMusclesContext) reads it as "userId".
  const unique = uniqueMuscles(design.muscles.map(m => ({ userId: m.userID ?? '' })));
  const outputCount = unique.count + 1; // one per unique muscle + ray angle
  const layers = [11, ...(options.intermediateLayers ?? DEFAULT_INTERMEDIATE_LAYERS), outputCount];
  const seconds = options.seconds ?? 20;
  if (!(Number.isFinite(seconds) && seconds > 0 && seconds <= 120)) throw new RangeError('Invalid episode length');
  const maxSteps = Math.round(seconds / FIXED_DT);

  const P = await factory();
  const owned = [];
  const keep = (value) => { owned.push(value); return value; };
  const jointsD6 = [], distanceJoints = [], fixedJoints = [];
  let closed = false;
  let foundation, physics, scene, dispatcher, groundMaterial;

  function close() {
    if (closed) return; closed = true;
    for (const joint of jointsD6) try { joint.release(); } catch (e) {}
    for (const joint of distanceJoints) try { joint.release(); } catch (e) {}
    for (const joint of fixedJoints) try { joint.release(); } catch (e) {}
    if (scene) try { scene.release(); } catch (e) {}
    if (groundMaterial) try { groundMaterial.release(); } catch (e) {}
    if (dispatcher) try { dispatcher.release(); } catch (e) {}
    if (physics) try { physics.release(); } catch (e) {}
    if (foundation) try { foundation.release(); } catch (e) {}
    for (let i = owned.length - 1; i >= 0; i--) try { P.destroy(owned[i]); } catch (e) {}
  }

  try {
    const allocator = keep(new P.PxDefaultAllocator());
    const errors = keep(new P.PxDefaultErrorCallback());
    foundation = P.CreateFoundation(P.PHYSICS_VERSION, allocator, errors);
    if (!foundation) throw new Error('PhysX foundation creation failed');
    const scale = keep(new P.PxTolerancesScale());
    physics = P.CreatePhysics(P.PHYSICS_VERSION, foundation, scale);
    if (!physics) throw new Error('PhysX creation failed');
    const desc = keep(new P.PxSceneDesc(scale));
    const gravity = keep(new P.PxVec3(0, -50, 0));
    dispatcher = P.DefaultCpuDispatcherCreate(0); // deterministic single-threaded stepping
    desc.set_gravity(gravity);
    desc.set_cpuDispatcher(dispatcher);
    desc.set_filterShader(P.DefaultFilterShader());
    scene = physics.createScene(desc);
    if (!scene) throw new Error('PhysX scene creation failed');

    // Ground: the Unity ground is a box collider tagged "Ground" whose top
    // surface sits at y = 0, with the high-friction material (friction 1,
    // restitution 0). A box is used instead of PhysX's plane (the plane shape
    // does not collide in this WASM build; a box matches the original setup).
    groundMaterial = physics.createMaterial(1, 1, 0);
    const groundPose = keep(new P.PxTransform(
      keep(new P.PxVec3(0, -4.78, 0)),
      keep(new P.PxQuat(0, 0, 0, 1))
    ));
    const groundGeom = keep(new P.PxBoxGeometry(10000, 4.78, 100));
    const groundShapeFlags = keep(new P.PxShapeFlags(P.PxShapeFlagEnum.eSCENE_QUERY_SHAPE | P.PxShapeFlagEnum.eSIMULATION_SHAPE));
    const groundShape = physics.createShape(groundGeom, groundMaterial, true, groundShapeFlags);
    const groundFilter = keep(new P.PxFilterData(1, 1, 0, 0));
    groundShape.setSimulationFilterData(groundFilter);
    const ground = physics.createRigidStatic(groundPose);
    ground.attachShape(groundShape);
    scene.addActor(ground);
    groundShape.release();

    const E = P.PxRigidDynamicLockFlagEnum, A = P.PxD6AxisEnum, M = P.PxD6MotionEnum;

    function makeBody(actorDef) {
      const pose = keep(new P.PxTransform(
        keep(new P.PxVec3(actorDef.position[0], actorDef.position[1], actorDef.position[2])),
        keep(new P.PxQuat(actorDef.rotation[0], actorDef.rotation[1], actorDef.rotation[2], actorDef.rotation[3]))
      ));
      const body = physics.createRigidDynamic(pose);
      if (!body) throw new Error('Rigid body creation failed');
      if (actorDef.shape && actorDef.shape.type === 'capsule') {
        const geom = keep(new P.PxCapsuleGeometry(actorDef.shape.radius, actorDef.shape.halfHeight));
        const shapeFlags = keep(new P.PxShapeFlags(P.PxShapeFlagEnum.eSCENE_QUERY_SHAPE | P.PxShapeFlagEnum.eSIMULATION_SHAPE));
        const shape = physics.createShape(geom, groundMaterial, true, shapeFlags);
        const filter = keep(new P.PxFilterData(1, 1, 0, 0));
        shape.setSimulationFilterData(filter);
        body.attachShape(shape);
        shape.release();
      }
      // Joint spheres are triggers in Unity: they never physically collide.
      // Mass: setMassAndUpdateInertia derives inertia from attached shapes;
      // trigger-only bodies keep a sphere inertia matching Unity's fallback.
      if (actorDef.shape && actorDef.shape.type === 'capsule') {
        P.PxRigidBodyExt.prototype.setMassAndUpdateInertia(body, actorDef.mass);
      } else {
        body.setMass(actorDef.mass);
        const r = actorDef.shape && actorDef.shape.type === 'sphere' ? actorDef.shape.radius : 0.5;
        const i = 0.4 * actorDef.mass * r * r;
        const inertia = keep(new P.PxVec3(i, i, i));
        body.setMassSpaceInertiaTensor(inertia);
      }
      body.setLinearDamping(actorDef.linearDamping ?? 0);
      body.setAngularDamping(actorDef.angularDamping ?? 0);
      body.setMaxAngularVelocity(7); // Unity Rigidbody default
      body.setSolverIterationCounts(7, 10);
      for (const [flag, on] of Object.entries(actorDef.locks)) {
        body.setRigidDynamicLockFlag(E[flag], on);
      }
      scene.addActor(body);
      return body;
    }

    function localFrame(worldPoint, body) {
      const pose = body.getGlobalPose();
      const p = pose.get_p(), q = pose.get_q();
      const inv = quatConjugate([q.get_x(), q.get_y(), q.get_z(), q.get_w()]);
      const local = [0, 0, 0];
      rotate(inv, [worldPoint[0] - p.get_x(), worldPoint[1] - p.get_y(), worldPoint[2] - p.get_z()], local);
      return local;
    }

    // ---- Build the compiled body graph -----------------------------------
    const bodies = new Map(); // key -> { body, def }
    for (const actorDef of candidate.actors) {
      bodies.set(actorDef.key, { body: makeBody(actorDef), def: actorDef });
    }

    const world = {
      bodies, candidate, design, unique, layers, seconds, maxSteps,
    };

    // Hinges: Unity HingeJoint on the joint body, axis (0,0,1), anchor at the
    // joint centre, connected to the bone, collisions between the pair off.
    for (const hinge of candidate.hinges) {
      const a = bodies.get(hinge.actor0), b = bodies.get(hinge.actor1);
      const anchor = a.def.position; // joint body centre in world
      const frame0 = keep(new P.PxTransform(
        keep(new P.PxVec3(0, 0, 0)),
        keep(new P.PxQuat(0, 0, 0, 1))
      ));
      const local1 = localFrame(anchor, b.body);
      const invRot = quatConjugate(b.def.rotation);
      const frame1 = keep(new P.PxTransform(
        keep(new P.PxVec3(local1[0], local1[1], local1[2])),
        keep(new P.PxQuat(invRot[0], invRot[1], invRot[2], invRot[3]))
      ));
      const joint = P.D6JointCreate(physics, a.body, frame0, b.body, frame1);
      joint.setMotion(A.eX, M.eLOCKED);
      joint.setMotion(A.eY, M.eLOCKED);
      joint.setMotion(A.eZ, M.eLOCKED);
      joint.setMotion(A.eTWIST, M.eLOCKED);
      joint.setMotion(A.eSWING1, M.eLOCKED);
      joint.setMotion(A.eSWING2, M.eFREE); // rotation about world Z only
      joint.setConstraintFlag(P.PxConstraintFlagEnum.eCOLLISION_ENABLED, false);
      jointsD6.push(joint);
    }

    // Legacy extra bodies: fixed joint to the bone, preprocessing disabled.
    for (const fixed of candidate.fixed) {
      const a = bodies.get(fixed.actor0), b = bodies.get(fixed.actor1);
      const frame = keep(new P.PxTransform(P.PxIDENTITYEnum.PxIdentity));
      const joint = P.FixedJointCreate(physics, a.body, frame, b.body, frame);
      joint.setConstraintFlag(P.PxConstraintFlagEnum.eCOLLISION_ENABLED, false);
      joint.setConstraintFlag(P.PxConstraintFlagEnum.ePREPROCESSING, false);
      fixedJoints.push(joint);
    }

    // Muscle springs. Unity SpringJoint quirk preserved: the world-space bone
    // centres at setup are written into the local anchor fields, so each
    // anchor sits at those coordinates relative to its body's frame.
    const muscles = [];
    for (const spring of candidate.springSources) {
      const a = bodies.get(spring.actor0), b = bodies.get(spring.actor1);
      const frame0 = keep(new P.PxTransform(
        keep(new P.PxVec3(a.def.position[0], a.def.position[1], a.def.position[2])),
        keep(new P.PxQuat(0, 0, 0, 1))
      ));
      const frame1 = keep(new P.PxTransform(
        keep(new P.PxVec3(b.def.position[0], b.def.position[1], b.def.position[2])),
        keep(new P.PxQuat(0, 0, 0, 1))
      ));
      const joint = P.DistanceJointCreate(physics, a.body, frame0, b.body, frame1);
      joint.setMinDistance(spring.minDistance);
      joint.setMaxDistance(spring.maxDistance);
      joint.setStiffness(spring.stiffness);
      joint.setDamping(spring.damping);
      joint.setDistanceJointFlag(P.PxDistanceJointFlagEnum.eSPRING_ENABLED, true);
      joint.setConstraintFlag(P.PxConstraintFlagEnum.eCOLLISION_ENABLED, false);
      distanceJoints.push(joint);
      muscles.push({
        joint, spring,
        forceBody0: bodies.get(spring.forceActor0),
        forceBody1: bodies.get(spring.forceActor1),
        outputIndex: -1, state: null,
      });
    }
    // Map brain outputs to muscles through the unique-muscle id grouping.
    design.muscles.forEach((muscle, i) => { muscles[i].outputIndex = unique.indices[i]; });

    // ---- Runtime state ---------------------------------------------------
    const jointDefs = candidate.actors.filter(a => a.key.startsWith('joint:'));
    const boneDefs = candidate.actors.filter(a => a.key.startsWith('bone:'));
    const wingBones = boneDefs.filter(a => a.wing);
    const penaltyJoints = jointDefs.filter(a => design.joints.some(j => `joint:${j.id}` === a.key && j.fitnessPenaltyForTouchingGround > 0));

    function bodyCenter(entry) {
      const p = entry.body.getGlobalPose().get_p();
      return [p.get_x(), p.get_y(), p.get_z()];
    }
    function velocityOf(entry) {
      const v = entry.body.getLinearVelocity();
      return [v.get_x(), v.get_y(), v.get_z()];
    }
    function angularVelocityOf(entry) {
      const v = entry.body.getAngularVelocity();
      return [v.get_x(), v.get_y(), v.get_z()];
    }

    const initial = { centers: new Map() };
    for (const [key, entry] of bodies) initial.centers.set(key, bodyCenter(entry));

    let network = null;
    let steps = 0;
    let customRaycastAngle = 0;
    let maxJumpingHeight = 0;
    let initialLowestY = 0;
    let initialCenterX = 0;
    let penalizedJointIds = new Set();
    const observations = new Float32Array(11);
    const outputs = new Float32Array(outputCount);

    function jointPositions() {
      const out = [];
      for (const def of jointDefs) {
        const p = bodies.get(def.key).body.getGlobalPose().get_p();
        out.push([p.get_x(), p.get_y()]);
      }
      return out;
    }

    // Brain inputs, UniversalBrain.UpdateInputs order.
    // Raycasts target the flat ground analytically (see limitations below).
    function computeInputs() {
      const positions = jointPositions();
      let minY = Infinity, maxY = -Infinity, velX = 0, velY = 0, touching = 0;
      const centers = new Map();
      jointDefs.forEach((def, i) => {
        const entry = bodies.get(def.key);
        const v = velocityOf(entry);
        velX += v[0]; velY += v[1];
        const y = positions[i][1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        // Unity trigger: ground contact while the sphere overlaps y < 0.5.
        if (y < 0.5) touching++;
        centers.set(def.key, [positions[i][0], positions[i][1]]);
      });
      velX /= jointDefs.length; velY /= jointDefs.length;
      let avgX = 0, avgY = 0;
      for (const p of positions) { avgX += p[0]; avgY += p[1]; }
      avgX /= positions.length; avgY /= positions.length;
      let angularZ = 0, rotation = 0;
      for (const def of boneDefs) {
        const entry = bodies.get(def.key);
        angularZ += angularVelocityOf(entry)[2];
        const q = entry.body.getGlobalPose().get_q();
        // Unity: (eulerAngles.z - 180) * 0.002778, euler z normalised to [0, 360).
        let angle = Math.atan2(2 * (q.get_w() * q.get_z() + q.get_x() * q.get_y()), 1 - 2 * (q.get_y() * q.get_y() + q.get_z() * q.get_z())) * 180 / Math.PI;
        if (angle < 0) angle += 360;
        rotation += (angle - 180) * 0.002778;
      }
      angularZ /= boneDefs.length; rotation /= boneDefs.length;

      const ray = (dx, dy) => {
        // Unity RaycastDistance returns hit distance or 0 when nothing is hit
        // within MAX_RAYCAST_DISTANCE. Against flat ground at y = 0:
        const len = Math.hypot(dx, dy);
        const ndx = dx / len, ndy = dy / len;
        if (ndy >= -1e-9) return 0; // horizontal or upward: never hits
        const t = -avgY / ndy;
        return t <= MAX_RAYCAST_DISTANCE ? t : 0;
      };
      observations[0] = minY;               // DistanceFromGround (lowest joint)
      observations[1] = ray(1, 0);         // forward
      observations[2] = ray(1, -1);       // down-forward
      observations[3] = ray(-1, -1);       // down-back
      observations[4] = ray(-1, 0);        // back
      const customDir = [Math.cos(customRaycastAngle), Math.sin(customRaycastAngle)];
      observations[5] = ray(customDir[0], customDir[1]);
      observations[6] = velX;
      observations[7] = velY;
      observations[8] = angularZ;
      observations[9] = touching;
      observations[10] = rotation;
      return { avgX, minY };
    }

    function applyMuscleForces() {
      const centers = new Map();
      for (const m of muscles) {
        const c0 = bodyCenter(m.forceBody0), c1 = bodyCenter(m.forceBody1);
        const start = m.spring.actor0 === m.forceBody0.key ? c0 : c1;
        const end = m.spring.actor0 === m.forceBody0.key ? c1 : c0;
        m.state = decodeBrainOutput(outputs[m.outputIndex], m.spring.strength, m.spring.canExpand, true);
        muscleForces(start, end, m.state, scratch.forceA, scratch.forceB);
        // Unity Muscle.ApplyForces: force on each bone at its centre.
        applyForceAtCenter(m.forceBody0, scratch.forceA, c0);
        applyForceAtCenter(m.forceBody1, scratch.forceB, c1);
      }
    }

    function applyForceAtCenter(entry, force, center) {
      if (force[0] === 0 && force[1] === 0 && force[2] === 0) return;
      const f = keep(new P.PxVec3(force[0], force[1], force[2]));
      const pos = keep(new P.PxVec3(center[0], center[1], center[2]));
      P.PxRigidBodyExt.prototype.addForceAtPos(entry.body, f, pos, P.PxForceModeEnum.eFORCE, true);
    }

    function applyWingForces() {
      for (const def of wingBones) {
        const entry = bodies.get(def.key);
        const pose = entry.body.getGlobalPose();
        const q = pose.get_q();
        const rotation = [q.get_x(), q.get_y(), q.get_z(), q.get_w()];
        const inv = quatConjugate(rotation);
        const worldVel = velocityOf(entry);
        const localVel = [0, 0, 0];
        rotate(inv, worldVel, localVel);
        const angle = 2 * Math.atan2(q.get_z(), q.get_w());
        const length = def.scale[1] * 2;
        wingForce(localVel, angle, length, def.inverted, scratch.wing);
        if (scratch.wing[0] === 0 && scratch.wing[1] === 0) continue;
        const f = keep(new P.PxVec3(scratch.wing[0], scratch.wing[1], 0));
        entry.body.addForce(f, P.PxForceModeEnum.eFORCE, true);
      }
    }

    function reset(genome) {
      if (genome !== undefined) {
        network = new CreatureNetwork(layers, genome);
      } else if (!network) {
        network = new CreatureNetwork(layers);
      } else {
        network.reset();
      }
      steps = 0; customRaycastAngle = 0; maxJumpingHeight = 0;
      penalizedJointIds = new Set();
      // Restore the initial poses and clear all velocities.
      for (const [key, entry] of bodies) {
        const def = entry.def;
        const pose = keep(new P.PxTransform(
          keep(new P.PxVec3(def.position[0], def.position[1], def.position[2])),
          keep(new P.PxQuat(def.rotation[0], def.rotation[1], def.rotation[2], def.rotation[3]))
        ));
        entry.body.setGlobalPose(pose);
        const zero = keep(new P.PxVec3(0, 0, 0));
        entry.body.setLinearVelocity(zero);
        entry.body.setAngularVelocity(zero);
      }
      const positions = jointPositions();
      initialLowestY = Math.min(...positions.map(p => p[1]));
      initialCenterX = positions.reduce((n, p) => n + p[0], 0) / positions.length;
    }

    function step() {
      if (closed) throw new Error('Creature world closed');
      if (steps >= maxSteps) return false;
      const { avgX, minY } = computeInputs();
      // Unity FixedUpdate order: brain update, muscle forces, wing forces.
      outputs.set(network.evaluate(observations));
      const last = outputs[outputCount - 1];
      customRaycastAngle = nextRayAngle(customRaycastAngle, last);
      applyMuscleForces();
      applyWingForces();
      scene.simulate(FIXED_DT);
      scene.fetchResults(true);
      steps++;
      // Bookkeeping after the step, as in Creature.Update.
      maxJumpingHeight = Math.max(maxJumpingHeight, Math.min(...jointPositions().map(p => p[1])) - initialLowestY);
      for (const def of penaltyJoints) {
        const joint = design.joints.find(j => `joint:${j.id}` === def.key);
        if (jointPositions()[jointDefs.indexOf(def)][1] < 0.5) penalizedJointIds.add(joint.id);
      }
      return true;
    }

    function statistics() {
      const positions = jointPositions();
      const x = positions.reduce((n, p) => n + p[0], 0) / positions.length;
      const y = positions.reduce((n, p) => n + p[1], 0) / positions.length;
      const time = steps * FIXED_DT;
      const weight = design.joints.reduce((n, j) => n + j.weight, 0)
        + design.bones.reduce((n, b) => n + (b.legacy ? 2 * b.weight : b.weight), 0);
      let fitness = time > 0 ? (x - initialCenterX) / (MAX_DISTANCE * time) : 0;
      for (const id of penalizedJointIds) {
        const joint = design.joints.find(j => j.id === id);
        fitness -= joint.fitnessPenaltyForTouchingGround;
      }
      return {
        steps, time,
        fitness: Math.max(0, Math.min(1, fitness)),
        unclampedFitness: fitness,
        horizontalDistance: x - initialCenterX,
        verticalDistance: y,
        averageSpeed: time > 0 ? Math.hypot((x - initialCenterX) / time, y / time) : 0,
        maxJumpingHeight,
        numberOfBones: design.bones.length,
        numberOfMuscles: design.muscles.length,
        weight,
      };
    }

    const world2 = { ...world };
    reset();
    return {
      status: 'validated',
      engine: 'PhysX',
      version: P.PHYSICS_VERSION,
      layers, seconds, maxSteps,
      get steps() { return steps; },
      jointPositions,
      boneStates() {
        return boneDefs.map(def => {
          const entry = bodies.get(def.key);
          const pose = entry.body.getGlobalPose();
          const p = pose.get_p(), q = pose.get_q();
          const v = entry.body.getLinearVelocity();
          return {
            key: def.key,
            center: [p.get_x(), p.get_y(), p.get_z()],
            rotation: [q.get_x(), q.get_y(), q.get_z(), q.get_w()],
            velocity: [v.get_x(), v.get_y(), v.get_z()],
            isWing: def.wing === true,
            inverted: def.inverted === true,
          };
        });
      },
      reset, step, statistics, close,
    };
  } catch (error) {
    close();
    throw error;
  }
}

// Run one full episode and return its statistics. Used by the evolution
// runner; the world is reset with the given genome beforehand.
export async function evaluateGenome(world, genome) {
  world.reset(genome);
  while (world.step()) { /* run to the configured episode length */ }
  return world.statistics();
}
