using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.SceneManagement;
using Unity.MLAgents;
using Keiwando.Evolution.Scenes;

namespace Keiwando.Evolution.RL {
    // Explicit opt-in: EVOLUTION_RL=1, or player argument --evo-rl.
    // Hooking sceneLoaded disables Evolution before its Start launches the genetic coroutine.
    public sealed class SprintTrainingSession : MonoBehaviour {
        readonly List<SceneController.SimulationSceneLoadContext> arenas = new List<SceneController.SimulationSceneLoadContext>();
        readonly List<SprintAgent> agents = new List<SprintAgent>();
        bool ready, ownsAcademy;
        bool previousAutomaticStepping;
        SimulationMode previousSimulationMode;
        public int parallelArenas = 8;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.BeforeSceneLoad)]
        static void Install() {
            SceneManager.sceneLoaded -= SceneLoaded;
            if (Environment.GetEnvironmentVariable("EVOLUTION_RL") == "1"
                || Array.IndexOf(Environment.GetCommandLineArgs(), "--evo-rl") >= 0)
                SceneManager.sceneLoaded += SceneLoaded;
        }

        static void SceneLoaded(Scene scene, LoadSceneMode mode) {
            foreach (var root in scene.GetRootGameObjects()) {
                foreach (var evolution in root.GetComponentsInChildren<Evolution>(true)) {
                    if (evolution.GetComponent<SprintTrainingSession>() != null) continue;
                    evolution.enabled = false;
                    evolution.gameObject.AddComponent<SprintTrainingSession>();
                }
            }
        }

        IEnumerator Start() {
            var container = FindAnyObjectByType<SimulationConfigContainer>();
            if (container == null || container.Config == null) {
                Debug.LogError("RL needs a configured simulation. Start a RUNNING simulation from the creature editor.");
                yield break;
            }
            var data = container.Config.SimulationData;
            if (data.Settings.Objective != Objective.Running) {
                Debug.LogError("RL sprint training supports Running only. Restart play mode with a Running design.");
                yield break;
            }
            var academy = Academy.Instance;
            previousAutomaticStepping = academy.AutomaticSteppingEnabled;
            academy.AutomaticSteppingEnabled = false;
            previousSimulationMode = Physics.simulationMode;
            Physics.simulationMode = SimulationMode.Script;
            ownsAcademy = true;
            if (!academy.IsCommunicatorOn)
                Debug.LogWarning("No Python trainer connected. Default policies will not learn; start mlagents-learn before Play.");
            for (int i = 0; i < Mathf.Clamp(parallelArenas, 1, 64); i++) {
                var context = new SceneController.SimulationSceneLoadContext();
                yield return SceneController.LoadSimulationScene(data.CreatureDesign, 1, data.SceneDescription,
                    SceneController.SimulationSceneType.Simulation, new LegacySimulationOptions(), context, new TrainingContext());
                arenas.Add(context);
                var creature = context.Creatures[0];
                creature.RemoveMuscleColliders();
                creature.recorder = null; creature.recordingPlayer = null;
                creature.Alive = true;
                // Let Joint.Start/Bone.Start finish mass and body initialization before Agent.Initialize.
                yield return null;
                agents.Add(SprintAgent.Attach(creature));
            }
            ready = true;
            Debug.Log("RL ready: " + agents.Count + " isolated arenas; 20-second episodes; behavior CheetahSprinter. Genetic save/UI controls are inactive in this mode.");
        }

        void FixedUpdate() {
            if (!ready) return;
            foreach (var agent in agents) agent.RequestStep();
            Academy.Instance.EnvironmentStep();
            foreach (var agent in agents) agent.ApplyForces();
            foreach (var arena in arenas) arena.PhysicsScene.Simulate(Time.fixedDeltaTime);
            foreach (var agent in agents) agent.AfterPhysics();
        }

        void OnDestroy() {
            ready = false;
            if (ownsAcademy && Academy.IsInitialized) {
                Academy.Instance.AutomaticSteppingEnabled = previousAutomaticStepping;
                Physics.simulationMode = previousSimulationMode;
            }
            foreach (var arena in arenas)
                if (arena.Scene.IsValid() && arena.Scene.isLoaded) SceneManager.UnloadSceneAsync(arena.Scene);
        }

        sealed class TrainingContext : ISceneContext {
            public LayerMask GetBackgroundLayer() => LayerMask.NameToLayer("SimulationBackground");
            public LayerMask GetStaticForegroundLayer() => LayerMask.NameToLayer("StaticForeground");
            public LayerMask GetDynamicForegroundLayer() => LayerMask.NameToLayer("DynamicForeground");
            public CreatureStats GetStatsForBestOfGeneration(int generation) => null;
            public float GetDistanceOfBest() => float.NaN;
        }
    }
}
