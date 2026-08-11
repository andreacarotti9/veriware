/**
 * The shapes that cross the WebAssembly boundary, and the result type every
 * entry point returns.
 *
 * @remarks
 * Byte fields are always `Uint8Array` and consensus counters are always
 * `bigint`. Views, heights and timestamps are attacker-controlled `u64`s that
 * pass `Number.MAX_SAFE_INTEGER` long before they exhaust `u64`.
 *
 * @packageDocumentation
 */

/**
 * Why a payload was rejected.
 *
 * These strings are stable API - branch on them. The accompanying message is
 * human-readable and is not stable.
 *
 * - `too_large` - longer than the payload cap, rejected before decoding.
 * - `namespace_too_large` - the network's namespace exceeds the cap.
 * - `invalid_identity` - the network's identity is not a valid threshold public key.
 * - `truncated` - the payload ended mid-field.
 * - `trailing_bytes` - the payload decoded, but bytes were left over.
 * - `malformed` - not a well-formed value of the requested kind.
 * - `inconsistent` - a certificate stapled to a block it does not attest to.
 * - `invalid_certificate` - signature bytes that are not points on the curve.
 * - `invalid_signature` - well-formed, but not signed by this network.
 * - `unknown_kind` - a framed message with an unrecognized kind byte.
 * - `not_initialized` - {@link init} has not resolved yet.
 */
export type VerifyErrorCode =
  | 'too_large'
  | 'namespace_too_large'
  | 'invalid_identity'
  | 'truncated'
  | 'trailing_bytes'
  | 'malformed'
  | 'inconsistent'
  | 'invalid_certificate'
  | 'invalid_signature'
  | 'unknown_kind'
  | 'not_initialized';

/** A typed rejection. Never thrown, always returned. */
export interface VerifyError {
  /** Stable, machine-readable reason. */
  readonly code: VerifyErrorCode;
  /** Human-readable detail. Not stable; do not parse. */
  readonly message: string;
}

/**
 * The outcome of a verify or decode call.
 *
 * Nothing in this package throws for bad input, so narrowing on `ok` is the
 * only control flow you need.
 *
 * @example
 * ```ts
 * const result = verifyFinalized(bytes, networks.alto);
 * if (!result.ok) return console.warn(result.error.code);
 * console.log(result.decoded.block.height);
 * ```
 */
export type Verified<T> =
  { readonly ok: true; readonly decoded: T } | { readonly ok: false; readonly error: VerifyError };

/**
 * A per-view randomness beacon: a threshold signature over the round alone,
 * unpredictable before the view and deterministic after it.
 */
export interface Seed {
  /** Epoch of the round. Always `0n` on alto, which has no resharing. */
  readonly epoch: bigint;
  /** View of the round. */
  readonly view: bigint;
  /** The threshold signature, which is itself the randomness. */
  readonly signature: Uint8Array;
}

/** A notarization or finalization certificate, without any block. */
export interface Certificate {
  /** Epoch of the certified round. */
  readonly epoch: bigint;
  /** View of the certified round. */
  readonly view: bigint;
  /** View of the proposal this one builds on. */
  readonly parent: bigint;
  /** What was certified: the digest of the proposed block. */
  readonly payload: Uint8Array;
  /** Recovered threshold signature over the vote. */
  readonly voteSignature: Uint8Array;
  /** Recovered threshold signature over the round - the seed for this view. */
  readonly seedSignature: Uint8Array;
}

/** The consensus context a block was proposed in. */
export interface BlockContext {
  /** Epoch of the proposing round. */
  readonly epoch: bigint;
  /** View of the proposing round. */
  readonly view: bigint;
  /** Identity key of the validator that proposed the block. */
  readonly leader: Uint8Array;
  /** View of the proposal this block builds on. */
  readonly parentView: bigint;
  /** Payload digest of the proposal this block builds on. */
  readonly parentPayload: Uint8Array;
}

/** A decoded alto block. */
export interface Block {
  /** SHA-256 digest of the block. This is what certificates attest to. */
  readonly digest: Uint8Array;
  /** Digest of the parent block. */
  readonly parent: Uint8Array;
  /** Height in the chain. */
  readonly height: bigint;
  /**
   * The proposer's clock at proposal time, in milliseconds since the Unix
   * epoch. Validator-supplied: a hint, not a timestamp.
   */
  readonly timestamp: bigint;
  /** The consensus context the block was proposed in. */
  readonly context: BlockContext;
}

/** A certificate together with the block it certifies. */
export interface CertifiedBlock {
  /** The certificate. */
  readonly proof: Certificate;
  /** The block it attests to. `block.digest` equals `proof.payload`. */
  readonly block: Block;
}
