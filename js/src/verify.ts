/**
 * The verification and decoding entry points.
 *
 * @packageDocumentation
 */

import { isInitialized } from './init.js';
import type { Network } from './networks.js';
import type { Block, Certificate, CertifiedBlock, Seed, Verified } from './types.js';
import {
  decode_untrusted_block,
  decode_untrusted_finalization,
  decode_untrusted_finalized,
  decode_untrusted_notarization,
  decode_untrusted_notarized,
  decode_untrusted_seed,
  Network as WasmNetwork,
} from './wasm/veriware.js';

/**
 * One WASM handle per network, built on first use.
 *
 * Building it decodes the identity and precomputes the namespace derivations,
 * so caching it keeps that cost off the per-certificate path. Keyed weakly, so
 * a network that goes out of scope takes its handle with it.
 */
const handles = new WeakMap<Network, WasmNetwork>();

const NOT_INITIALIZED = Object.freeze({
  ok: false as const,
  error: Object.freeze({
    code: 'not_initialized' as const,
    message: 'call and await init() before verifying',
  }),
});

const INVALID_IDENTITY = Object.freeze({
  ok: false as const,
  error: Object.freeze({
    code: 'invalid_identity' as const,
    message: 'identity is not a valid threshold public key',
  }),
});

/**
 * Runs `call` against the network's handle, or reports why it could not.
 *
 * The two failures reachable here, not initialized and bad identity, are
 * returned in the same shape as every other rejection.
 */
function withNetwork<T>(network: Network, call: (handle: WasmNetwork) => unknown): Verified<T> {
  if (!isInitialized()) {
    return NOT_INITIALIZED;
  }

  let handle = handles.get(network);
  if (handle === undefined) {
    handle = WasmNetwork.create(network.namespace, network.identity);
    if (handle === undefined) {
      return INVALID_IDENTITY;
    }
    handles.set(network, handle);
  }
  return call(handle) as Verified<T>;
}

function decoded<T>(call: () => unknown): Verified<T> {
  if (!isInitialized()) {
    return NOT_INITIALIZED;
  }
  return call() as Verified<T>;
}

/**
 * Verifies a seed: the per-view randomness beacon.
 *
 * A seed is a threshold signature over the round and nothing else, which makes
 * it unpredictable until the view arrives and fixed forever after.
 */
export function verifySeed(payload: Uint8Array, network: Network): Verified<Seed> {
  return withNetwork(network, (handle) => handle.verify_seed(payload));
}

/**
 * Verifies a bare notarization certificate.
 *
 * A notarization means at least `2f+1` validators voted for the proposal. It is
 * not finality - a notarized view can still be skipped.
 */
export function verifyNotarization(payload: Uint8Array, network: Network): Verified<Certificate> {
  return withNetwork(network, (handle) => handle.verify_notarization(payload));
}

/**
 * Verifies a bare finalization certificate.
 *
 * A finalization is irreversible: the proposal it names is in the chain
 * forever, and so is every ancestor.
 */
export function verifyFinalization(payload: Uint8Array, network: Network): Verified<Certificate> {
  return withNetwork(network, (handle) => handle.verify_finalization(payload));
}

/**
 * Verifies a notarization together with the alto block it certifies.
 *
 * This is what alto's `/notarization/*` endpoint and WebSocket kind `1` carry.
 * Success binds the certificate to this exact block: a payload whose block does
 * not hash to the attested digest is rejected as `inconsistent`.
 */
export function verifyNotarized(payload: Uint8Array, network: Network): Verified<CertifiedBlock> {
  return withNetwork(network, (handle) => handle.verify_notarized(payload));
}

/**
 * Verifies a finalization together with the alto block it certifies.
 *
 * This is what alto's `/finalization/*`, `/block/latest` and WebSocket kind `2`
 * carry - the call to reach for when the question is "what is final?".
 */
export function verifyFinalized(payload: Uint8Array, network: Network): Verified<CertifiedBlock> {
  return withNetwork(network, (handle) => handle.verify_finalized(payload));
}

/**
 * Decodes a seed. **The signature is not checked.**
 *
 * @remarks
 * UNVERIFIED. The result is whatever the sender claimed, which on a public
 * network means whatever an attacker chose. For a seed you can trust, use
 * {@link verifySeed}.
 */
export function decodeSeed(payload: Uint8Array): Verified<Seed> {
  return decoded(() => decode_untrusted_seed(payload));
}

/**
 * Decodes a bare notarization certificate. **The signature is not checked.**
 *
 * @remarks
 * UNVERIFIED - see {@link decodeSeed}. Use {@link verifyNotarization}.
 */
export function decodeNotarization(payload: Uint8Array): Verified<Certificate> {
  return decoded(() => decode_untrusted_notarization(payload));
}

/**
 * Decodes a bare finalization certificate. **The signature is not checked.**
 *
 * @remarks
 * UNVERIFIED - see {@link decodeSeed}. Use {@link verifyFinalization}.
 */
export function decodeFinalization(payload: Uint8Array): Verified<Certificate> {
  return decoded(() => decode_untrusted_finalization(payload));
}

/**
 * Decodes a notarization and its block. **The signature is not checked.**
 *
 * @remarks
 * UNVERIFIED - see {@link decodeSeed}. Use {@link verifyNotarized}.
 */
export function decodeNotarized(payload: Uint8Array): Verified<CertifiedBlock> {
  return decoded(() => decode_untrusted_notarized(payload));
}

/**
 * Decodes a finalization and its block. **The signature is not checked.**
 *
 * @remarks
 * UNVERIFIED - see {@link decodeSeed}. Use {@link verifyFinalized}.
 */
export function decodeFinalized(payload: Uint8Array): Verified<CertifiedBlock> {
  return decoded(() => decode_untrusted_finalized(payload));
}

/**
 * Decodes an alto block.
 *
 * @remarks
 * A block carries no certificate, so there is no verified counterpart: a block
 * is only ever as trustworthy as the certificate it arrived with. Check that
 * `digest` matches a verified certificate's `payload` before believing any of
 * this.
 */
export function decodeBlock(payload: Uint8Array): Verified<Block> {
  return decoded(() => decode_untrusted_block(payload));
}
