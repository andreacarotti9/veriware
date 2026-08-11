// Verify a certificate with no network access at all.
//
// The payload is one of the committed conformance fixtures, so this script is
// deterministic and is what `just smoke` runs against a freshly installed
// tarball.
//
//   node verify-fixture.mjs

import { readFile } from 'node:fs/promises';
import { fromHex, init, networks, verifyFinalized } from 'veriware';

await init();

const url = new URL('../../fixtures/vectors.json', import.meta.url);
const { vectors } = JSON.parse(await readFile(url, 'utf8'));
const fixture = vectors.find((vector) => vector.name === 'finalized/valid');

const result = verifyFinalized(fromHex(fixture.payload), networks.altoDevnet);
if (!result.ok) {
  console.error('rejected:', result.error.code, '-', result.error.message);
  process.exit(1);
}

const { proof, block } = result.decoded;
console.log(`verified finalization for view ${proof.view}`);
console.log(`  height    ${block.height}`);
console.log(`  digest    ${Buffer.from(block.digest).toString('hex')}`);
console.log(`  proposer  ${Buffer.from(block.context.leader).toString('hex').slice(0, 16)}...`);

// And a forgery, so the exit code above means something.
const forged = vectors.find((vector) => vector.name === 'finalized/tampered-block');
const rejected = verifyFinalized(fromHex(forged.payload), networks.altoDevnet);
console.log(`tampered fixture rejected: ${rejected.ok ? 'NO' : rejected.error.code}`);
if (rejected.ok) process.exit(1);
