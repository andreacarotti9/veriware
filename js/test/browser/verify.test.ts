/**
 * One fixture, end to end, in a real Chromium.
 *
 * The Node suite proves conformance; this proves the artifact actually loads
 * and runs where it is meant to. It catches what Node cannot: a broken
 * `--target web` loader, a wasm-bindgen ABI mismatch, missing browser entropy
 * for the batch-verification randomizers.
 */

import { expect, it } from 'vitest';
import { fromHex, init, verifyFinalized } from '../../src/index.js';
import vectors from '../../../fixtures/vectors.json' with { type: 'json' };

it('verifies a finalization in the browser', async () => {
  await init();

  const fixture = vectors.vectors.find((entry) => entry.name === 'finalized/valid')!;
  const network = {
    name: 'devnet',
    namespace: fromHex(vectors.networks.devnet.namespace),
    identity: fromHex(vectors.networks.devnet.identity),
  };

  const started = performance.now();
  const result = verifyFinalized(fromHex(fixture.payload), network);
  const elapsed = performance.now() - started;

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.decoded.block.height).toBe(2n);
  }
  // Not a benchmark - a tripwire for a build that fell back to something slow.
  expect(elapsed).toBeLessThan(1000);
});

it('rejects a forgery in the browser', async () => {
  await init();

  const fixture = vectors.vectors.find((entry) => entry.name === 'finalized/tampered-block')!;
  const network = {
    name: 'devnet',
    namespace: fromHex(vectors.networks.devnet.namespace),
    identity: fromHex(vectors.networks.devnet.identity),
  };

  const result = verifyFinalized(fromHex(fixture.payload), network);
  expect(result).toStrictEqual({
    ok: false,
    error: { code: fixture.verify, message: expect.any(String) },
  });
});
