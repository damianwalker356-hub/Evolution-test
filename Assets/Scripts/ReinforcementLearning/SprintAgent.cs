using System;
using System.Linq;
using UnityEngine;
using Unity.MLAgents;
using Unity.MLAgents.Actuators;
using Unity.MLAgents.Policies;
using Unity.MLAgents.Sensors;

namespace Keiwando.Evolution.RL {
    // Driven exclusively by SprintTrainingSession; no DecisionRequester or FixedUpdate.
    public sealed class SprintAgent : Agent {
        Creature creature;
        Rigidbody[] bodies;
        Muscle[] muscles;
        Joint[] joints;
        Vector3[] positions;
        Quaternion[] rotations;
        float[] commands;
        float mass, scale, initialX, initialY, previousX;
        int ticks, horizon;
        const float RewardPerUnit = 0.1f;
        const float VelocityScale = 20f;
        public int DecisionPeriod { get; set; } = 5;
        public float EpisodeSeconds { get; set; } = 20f;

        public static SprintAgent Attach(Creature c) {
            if (c.GetComponent<Agent>() != null)
                throw new InvalidOperationException("Creature already has an Agent. Remove previous RL scripts.");
            if (c.bones.Any(b => b.BoneData.legacy))
                throw new InvalidOperationException("RL currently requires non-legacy bones.");
            foreach (var brain in c.GetComponents<Brain>()) brain.enabled = false;
            var muscles = c.muscles.OrderBy(m => m.GetId()).ToArray();
            var bodies = c.GetComponentsInChildren<Rigidbody>().Where(b => !b.isKinematic).ToArray();
            if (muscles.Length == 0 || bodies.Length == 0)
                throw new InvalidOperationException("Training requires muscles and dynamic bodies.");
            var bp = c.gameObject.AddComponent<BehaviorParameters>();
            bp.BehaviorName = "CheetahSprinter";
            bp.BehaviorType = BehaviorType.Default;
            bp.BrainParameters.VectorObservationSize = 4 + 7 * bodies.Length + muscles.Length + c.joints.Count;
            bp.BrainParameters.ActionSpec = ActionSpec.MakeContinuous(muscles.Length);
            return c.gameObject.AddComponent<SprintAgent>();
        }

        public override void Initialize() {
            MaxStep = 0; // Explicit terminal transition after the final simulated step.
            creature = GetComponent<Creature>();
            joints = creature.joints.OrderBy(j => j.GetId()).ToArray();
            muscles = creature.muscles.OrderBy(m => m.GetId()).ToArray();
            bodies = joints.Select(j => j.GetComponent<Rigidbody>())
                .Concat(creature.bones.OrderBy(b => b.GetId()).Select(b => b.GetComponent<Rigidbody>()))
                .Distinct().Where(b => b != null && !b.isKinematic).ToArray();
            positions = bodies.Select(b => b.position).ToArray();
            rotations = bodies.Select(b => b.rotation).ToArray();
            commands = new float[muscles.Length];
            mass = bodies.Sum(b => b.mass);
            if (mass <= 0f) throw new InvalidOperationException("Invalid creature mass.");
            var com = Center(); initialX = previousX = com.x; initialY = com.y;
            scale = Mathf.Max(1f, bodies.Max(b => Vector3.Distance(b.position, com)));
            foreach (var m in muscles) {
                m.enabled = false; // Prevent Muscle.FixedUpdate applying a second force.
                m.currentForce = 0f;
            }
        }

        public override void OnEpisodeBegin() {
            for (int i = 0; i < bodies.Length; i++) {
                var b = bodies[i];
                b.position = positions[i]; b.rotation = rotations[i];
                b.linearVelocity = Vector3.zero; b.angularVelocity = Vector3.zero;
                b.WakeUp();
            }
            Physics.SyncTransforms();
            Array.Clear(commands, 0, commands.Length);
            foreach (var m in muscles) m.currentForce = 0f;
            previousX = initialX; ticks = 0;
            horizon = Mathf.Max(1, Mathf.RoundToInt(EpisodeSeconds / Time.fixedDeltaTime));
        }

        public override void CollectObservations(VectorSensor sensor) {
            var c = Center(); var v = Velocity();
            sensor.AddObservation(new Vector2(v.x, v.y) / VelocityScale);
            sensor.AddObservation((c.y - initialY) / scale);
            sensor.AddObservation(Mathf.Clamp01((float)ticks / horizon));
            foreach (var b in bodies) {
                sensor.AddObservation(new Vector2(b.position.x - c.x, b.position.y - c.y) / scale);
                sensor.AddObservation(new Vector2(b.linearVelocity.x - v.x, b.linearVelocity.y - v.y) / VelocityScale);
                float angle = b.rotation.eulerAngles.z * Mathf.Deg2Rad;
                sensor.AddObservation(Mathf.Sin(angle)); sensor.AddObservation(Mathf.Cos(angle));
                sensor.AddObservation(b.angularVelocity.z / 20f);
            }
            // Existing trigger flags can be stale immediately after a teleport; mask the first sample.
            foreach (var j in joints) sensor.AddObservation(ticks > 0 && j.isCollidingWithGround ? 1f : 0f);
            sensor.AddObservation(commands);
        }

        public override void OnActionReceived(ActionBuffers actions) {
            if (actions.ContinuousActions.Length != muscles.Length)
                throw new InvalidOperationException("Action count does not match muscle count.");
            for (int i = 0; i < commands.Length; i++) {
                float x = actions.ContinuousActions[i];
                if (float.IsNaN(x) || float.IsInfinity(x)) x = 0f;
                commands[i] = Mathf.Clamp(x, -1f, 1f);
            }
        }

        internal void RequestStep() {
            if (ticks % Mathf.Max(1, DecisionPeriod) == 0) RequestDecision();
            else RequestAction();
        }

        internal void ApplyForces() {
            for (int i = 0; i < muscles.Length; i++) {
                var m = muscles[i]; float x = commands[i];
                // Contract-only muscles use the entire action interval for [0, strength].
                bool expand = m.MuscleData.canExpand && x < 0f;
                float amount = m.MuscleData.canExpand ? Mathf.Abs(x) : (x + 1f) * 0.5f;
                m.muscleAction = expand ? Muscle.MuscleAction.EXPAND : Muscle.MuscleAction.CONTRACT;
                m.currentForce = amount * m.MuscleData.strength; // True zero, unlike SetContractionForce's 0.01 floor.
                if (expand) m.Expand(m.currentForce); else m.Contract(m.currentForce);
            }
        }

        internal void AfterPhysics() {
            var c = Center();
            if (bodies.Any(b => !Finite(b.position) || !Finite(b.linearVelocity) || !Finite(b.angularVelocity))) {
                AddReward(-10f); EndEpisode(); return;
            }
            AddReward((c.x - previousX) * RewardPerUnit);
            previousX = c.x; ticks++;
            foreach (var m in muscles) m.UpdateLinePoints();
            if (ticks >= horizon) {
                Academy.Instance.StatsRecorder.Add("Sprint/DistanceUnits", c.x - initialX);
                Academy.Instance.StatsRecorder.Add("Sprint/MeanSpeedUnitsPerSecond", (c.x - initialX) / (ticks * Time.fixedDeltaTime));
                EndEpisode();
            }
        }

        static bool Finite(Vector3 v) => !(float.IsNaN(v.x) || float.IsNaN(v.y) || float.IsNaN(v.z)
            || float.IsInfinity(v.x) || float.IsInfinity(v.y) || float.IsInfinity(v.z));
        Vector3 Center() { var s = Vector3.zero; foreach (var b in bodies) s += b.mass * b.worldCenterOfMass; return s / mass; }
        Vector3 Velocity() { var s = Vector3.zero; foreach (var b in bodies) s += b.mass * b.linearVelocity; return s / mass; }
    }
}
