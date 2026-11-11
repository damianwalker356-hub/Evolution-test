// Loads the real PhysX 5.12 WASM engine in the browser and in Node tests.
// Browser: the vendored engine next to this file (GitHub Pages serves the repo
// root, so node_modules is not available there).
// Node (tests/CI only): the browser build refuses Node at load time, so the
// test harness presents a minimal web environment and feeds the WASM bytes
// directly. This is a test-environment shim around an unmodified vendor build;
// it does not alter or replace any physics.
export async function loadPhysXFactory() {
  if (typeof window !== 'undefined' && typeof process === 'undefined') {
    const module = await import('./vendor/physx-js-webidl.mjs');
    return module.default; // the WASM is fetched relative to the vendored file
  }
  // Node test harness: make the browser-only runtime importable.
  // ENVIRONMENT_IS_WEB must be true and ENVIRONMENT_IS_NODE false, or the
  // unmodified emscripten glue aborts before main() runs.
  if (typeof globalThis.window === 'undefined') globalThis.window = {};
  if (typeof process !== 'undefined' && process.versions && 'node' in process.versions) {
    Object.defineProperty(process.versions, 'node', { value: undefined, configurable: true });
  }
  const module = await import('physx-js-webidl');
  const fs = await import('fs');
  const { pathToFileURL } = await import('url');
  const wasmUrl = new URL('physx-js-webidl.wasm', import.meta.resolve('physx-js-webidl'));
  const wasmBinary = fs.readFileSync(wasmUrl);
  return async () => module.default({ wasmBinary });
}
