/**
 * Loading the WebAssembly module.
 *
 * @packageDocumentation
 */

import initWasm from './wasm/veriware.js';

/** Where the WASM module can be loaded from. */
export type WasmSource = string | URL | Request | Response | BufferSource;

let loading: Promise<void> | null = null;
let loaded = false;

/**
 * Loads the WebAssembly module. Call once before verifying anything.
 *
 * Idempotent: concurrent calls share one load, and later calls resolve
 * immediately. Loading is explicit rather than a top-level `await` so that
 * importing this package does not force your bundler into an async module
 * graph, and so that pages which never verify anything never fetch it.
 *
 * With no argument the module is fetched from `veriware_bg.wasm` next to the
 * package's own JavaScript, which is right for browsers and bundlers. Under
 * Node the same path resolves to a `file:` URL, which `fetch` refuses, so it is
 * read from disk instead. Pass a source explicitly to serve the asset from a
 * CDN, to inline it, or to reuse a module you already compiled.
 *
 * @example Browser or bundler
 * ```ts
 * await init();
 * ```
 *
 * @example Explicit URL
 * ```ts
 * await init('https://cdn.example.com/veriware_bg.wasm');
 * ```
 *
 * @throws Whatever the load failed with - a 404, a `WebAssembly.CompileError`,
 * a filesystem error. This is the one asynchronous, developer-facing operation
 * in the package; the verification API that follows never throws.
 */
export function init(source?: WasmSource): Promise<void> {
  loading ??= load(source).then(() => {
    loaded = true;
  });
  return loading;
}

/** Whether {@link init} has resolved. */
export function isInitialized(): boolean {
  return loaded;
}

async function load(source?: WasmSource): Promise<void> {
  await initWasm({ module_or_path: source ?? (await defaultSource()) });
}

async function defaultSource(): Promise<WasmSource> {
  const url = new URL('./wasm/veriware_bg.wasm', import.meta.url);
  if (url.protocol !== 'file:') {
    return url;
  }

  // Node has no `fetch` for `file:` URLs. The specifier is held in a variable so
  // that bundlers, which cannot see through it, leave the import alone: a
  // browser build never reaches this branch, because its URL is not `file:`.
  const specifier = 'node:fs/promises';
  const fs = (await import(/* @vite-ignore */ specifier)) as {
    readFile(path: URL): Promise<Uint8Array<ArrayBuffer>>;
  };
  return fs.readFile(url);
}
