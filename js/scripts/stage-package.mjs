// Assembles everything the tarball ships that `tsc` does not produce.
//
// Two kinds of file: the WASM asset and its generated glue, which have to sit
// at dist/wasm/ for the relative import in dist/init.js to resolve; and the
// README and legal files, which live at the repository root so there is one
// copy of each rather than one that drifts.

import { copyFile, cp, mkdir, readdir } from 'node:fs/promises';

const wasmFrom = new URL('../src/wasm/', import.meta.url);
const wasmTo = new URL('../dist/wasm/', import.meta.url);

const built = await readdir(wasmFrom).catch(() => []);
if (!built.includes('veriware_bg.wasm')) {
  console.error('src/wasm is missing or incomplete - run `just wasm` first');
  process.exit(1);
}

await mkdir(wasmTo, { recursive: true });
await cp(wasmFrom, wasmTo, { recursive: true });

const staged = ['README.md', 'LICENSE-APACHE', 'LICENSE-MIT', 'NOTICE'];
for (const name of staged) {
  await copyFile(new URL(`../../${name}`, import.meta.url), new URL(`../${name}`, import.meta.url));
}

console.log(`staged ${built.length} wasm files and ${staged.length} documents`);
