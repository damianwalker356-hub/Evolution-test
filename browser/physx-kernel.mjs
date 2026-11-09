import { FIXED_DT, SCENE_DEFAULTS } from './core.mjs';
// A real PhysX bootstrap/probe, NOT a validated Evolution backend.
export async function openPhysX(factory) {
  if (typeof factory !== 'function') throw new TypeError('PhysX module factory required');
  const P = await factory();
  const owned = [], bodies = [];
  let foundation, physics, scene, dispatcher, material, closed = false;
  const keep = value => { owned.push(value); return value; };
  function close() {
    if (closed) return; closed = true;
    for (let i=bodies.length-1;i>=0;i--) bodies[i].release();
    if (scene) scene.release();
    if (material) material.release();
    if (dispatcher) dispatcher.release();
    if (physics) physics.release();
    if (foundation) foundation.release();
    for (let i=owned.length-1;i>=0;i--) P.destroy(owned[i]);
  }
  try {
    const allocator=keep(new P.PxDefaultAllocator());
    const errors=keep(new P.PxDefaultErrorCallback());
    foundation=P.CreateFoundation(P.PHYSICS_VERSION,allocator,errors);
    if (!foundation) throw new Error('PhysX foundation creation failed');
    const scale=keep(new P.PxTolerancesScale());
    physics=P.CreatePhysics(P.PHYSICS_VERSION,foundation,scale);
    if (!physics) throw new Error('PhysX creation failed');
    const desc=keep(new P.PxSceneDesc(scale));
    const gravity=keep(new P.PxVec3(0,SCENE_DEFAULTS.gravityY,0));
    dispatcher=P.DefaultCpuDispatcherCreate(0);
    desc.set_gravity(gravity); desc.set_cpuDispatcher(dispatcher);
    desc.set_filterShader(P.DefaultFilterShader());
    scene=physics.createScene(desc);
    if (!scene) throw new Error('PhysX scene creation failed');
    // Probe material only. Original creature materials are NOT mapped yet.
    material=physics.createMaterial(0.5,0.5,0);
    const filter=keep(new P.PxFilterData(1,1,0,0));
    const flags=keep(new P.PxShapeFlags(P.PxShapeFlagEnum.eSCENE_QUERY_SHAPE | P.PxShapeFlagEnum.eSIMULATION_SHAPE));
    const pose=keep(new P.PxTransform(P.PxIDENTITYEnum.PxIdentity));
    const vec=keep(new P.PxVec3(0,0,0));
    const box=keep(new P.PxBoxGeometry(0.5,0.5,0.5));
    let ticks=0;
    return {
      status:'experimental', engine:'PhysX', version:P.PHYSICS_VERSION,
      get ticks(){return ticks;},
      createProbeBody(x=0,y=10,z=0) {
        if (closed) throw new Error('PhysX world closed');
        if (![x,y,z].every(Number.isFinite)) throw new TypeError('Nonfinite spawn position');
        vec.set_x(x);vec.set_y(y);vec.set_z(z);pose.set_p(vec);
        const shape=physics.createShape(box,material,true,flags);
        let actor;
        try {
          shape.setSimulationFilterData(filter);
          actor=physics.createRigidDynamic(pose);
          actor.attachShape(shape);scene.addActor(actor);bodies.push(actor);
        } catch(e) {if(actor) actor.release();throw e;}
        finally {shape.release();}
        return bodies.length-1;
      },
      step() {
        if (closed) throw new Error('PhysX world closed');
        scene.simulate(FIXED_DT); scene.fetchResults(true);ticks++;
      },
      readPosition(index,out) {
        if (closed) throw new Error('PhysX world closed');
        if (!Number.isInteger(index)||!bodies[index]||!out||out.length!==3) throw new TypeError('Invalid body/buffer');
        const position=bodies[index].getGlobalPose().get_p();
        out[0]=position.get_x();out[1]=position.get_y();out[2]=position.get_z();
        if (![out[0],out[1],out[2]].every(Number.isFinite)) throw new Error('Nonfinite PhysX state');
        return out;
      },
      close
    };
  } catch (error) {close();throw error;}
}
