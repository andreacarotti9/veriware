/**
 * Networks: the `(namespace, identity)` pair that says which chain a
 * certificate has to come from.
 *
 * @packageDocumentation
 */

import { fromHex } from './hex.js';

/**
 * A threshold-simplex network.
 *
 * Two values are all it takes: the namespace validators prefix to every signed
 * message, and the threshold public key their signatures recover to. Build one
 * with {@link defineNetwork}, or use a preset from {@link networks}.
 */
export interface Network {
  /** Label for logs and UIs. Not part of verification. */
  readonly name: string;
  /** Signing namespace, as bytes. Alto's is the ASCII of `_ALTO`. */
  readonly namespace: Uint8Array;
  /** Threshold public key: a 96-byte compressed BLS12-381 G2 element. */
  readonly identity: Uint8Array;
}

/**
 * Describes a network so its certificates can be verified.
 *
 * Never throws and never validates. An identity that is not a point on the
 * curve is reported by the first verify call as `invalid_identity`, alongside
 * every other rejection, rather than at a different time in a different shape.
 *
 * @param spec.namespace - The signing namespace. A string is encoded as UTF-8,
 * which is what protocol namespaces are; pass bytes if yours is not text.
 * @param spec.identity - The 96-byte threshold public key.
 * @param spec.name - Optional label. Defaults to `"custom"`.
 *
 * @example Any threshold-simplex chain
 * ```ts
 * const mine = defineNetwork({
 *   namespace: '_MYCHAIN',
 *   identity: fromHex('a6ad67a9...'),
 *   name: 'mychain',
 * });
 * verifyFinalization(bytes, mine);
 * ```
 */
export function defineNetwork(spec: {
  namespace: Uint8Array | string;
  identity: Uint8Array;
  name?: string;
}): Network {
  return Object.freeze({
    name: spec.name ?? 'custom',
    namespace:
      typeof spec.namespace === 'string'
        ? new TextEncoder().encode(spec.namespace)
        : spec.namespace,
    identity: spec.identity,
  });
}

/** Alto's signing namespace: the ASCII of `_ALTO`. */
export const ALTO_NAMESPACE = '_ALTO';

/**
 * Ready-made networks.
 *
 * The alto identities are the ones published in the alto repository at
 * `explorer/src/global_config.ts` and `explorer/src/usa_config.ts` - the same
 * constants the live explorer verifies against. Each is quoted below with the
 * source it was read from, so anyone can check it rather than trust it.
 *
 * Alto pins epoch 0 and has no resharing, so these identities do not rotate.
 * A network that does reshare needs identity rotation, which this package does
 * not do.
 */
export const networks = Object.freeze({
  /**
   * Alto's global cluster: 50 validators across 10 AWS regions, indexed at
   * `global.alto.exoware.xyz`.
   *
   * Source: https://github.com/commonwarexyz/alto/blob/main/explorer/src/global_config.ts
   * (commit b880582, read 2026-08-11).
   */
  alto: defineNetwork({
    name: 'alto',
    namespace: ALTO_NAMESPACE,
    identity: fromHex(
      'a6ad67a90af5cb7f04015f3df946c0f0f90f3bc3c536cadb3bedbc32eb35de552c2bfce575f696137' +
        '65b23aaa19524ed06122806decca7be10f1a5709bd77855fc24c20ecb6bdc88320a8526a1f18907044' +
        '25014a559c2920874f9592faa0c37',
    ),
  }),

  /**
   * Alto's USA cluster: 50 validators across 4 US regions, indexed at
   * `usa.alto.exoware.xyz`.
   *
   * Source: https://github.com/commonwarexyz/alto/blob/main/explorer/src/usa_config.ts
   * (commit b880582, read 2026-08-11).
   */
  altoUsa: defineNetwork({
    name: 'alto-usa',
    namespace: ALTO_NAMESPACE,
    identity: fromHex(
      'a156881f2d99ecd30cc7b9550d65765482cf04be7ec740b8ae64abb3ad8630a61619319c3d4abba4b1' +
        '791bf774424a7f096cf35654524187cafd338f7c89523c68676a80c941ed40c7de045869fb00326df1' +
        'eadb26b62eb2096318814ee9d080',
    ),
  }),

  /**
   * The deterministic devnet behind `fixtures/vectors.json`.
   *
   * Generated from a seeded RNG by `just fixtures`, so its certificates are
   * reproducible and its keys are worthless. For tests and for the demo's
   * offline mode. Never a live network.
   */
  altoDevnet: defineNetwork({
    name: 'alto-devnet',
    namespace: ALTO_NAMESPACE,
    identity: fromHex(
      '98c6e82fdf8990fa8b78df3788c45d4a36d83dd6c4e619b7b746abe12891427dd93ccd2d00596b8a87' +
        'a5b084578fd2cf0a1f3a02672f4b370b2601e6425f873eafeb10a62adaa093b503a8630b89994c5f14' +
        '01e62001896d2bd4f858be2cb941',
    ),
  }),
});
