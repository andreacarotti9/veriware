/**
 * Verify commonware threshold-simplex consensus certificates in the browser.
 *
 * A threshold-simplex network is identified by two values: the namespace its
 * validators prefix to every signed message, and the threshold public key their
 * signatures recover to. Hand veriware that pair and it will tell you whether a
 * seed, a notarization or a finalization really came from that network - with
 * no server to trust and no cryptography of its own.
 *
 * @example Verify alto finality
 * ```ts
 * import { init, networks, verifyFinalized } from 'veriware';
 *
 * await init();
 * const result = verifyFinalized(bytes, networks.alto);
 * if (result.ok) console.log('final at height', result.decoded.block.height);
 * ```
 *
 * @example Any other threshold-simplex chain
 * ```ts
 * const mine = defineNetwork({ namespace: '_MYCHAIN', identity: fromHex('...') });
 * verifyFinalization(bytes, mine);
 * ```
 *
 * # What this package is not
 *
 * It is not a light client: verifying a finalization proves the certificate is
 * real, not that it is the newest one and not that the chain is live. It does
 * not execute or check application state. It does not implement any
 * cryptography - verification is delegated to `alto-types` and
 * commonware-cryptography compiled to WebAssembly, which is what makes
 * conformance a property of the build rather than of a code review. And it
 * assumes a fixed validator identity: alto pins epoch 0 and never reshares, so
 * a network that does rotate its identity is out of scope.
 *
 * Nothing here throws for bad input. Every entry point returns
 * `{ ok: true, decoded } | { ok: false, error }`.
 *
 * @packageDocumentation
 */

export { init, isInitialized, type WasmSource } from './init.js';
export { fromHex, toHex } from './hex.js';
export { ALTO_NAMESPACE, defineNetwork, networks, type Network } from './networks.js';
export {
  decodeBlock,
  decodeFinalization,
  decodeFinalized,
  decodeNotarization,
  decodeNotarized,
  decodeSeed,
  verifyFinalization,
  verifyFinalized,
  verifyNotarization,
  verifyNotarized,
  verifySeed,
} from './verify.js';
export type {
  Block,
  BlockContext,
  Certificate,
  CertifiedBlock,
  Seed,
  Verified,
  VerifyError,
  VerifyErrorCode,
} from './types.js';
