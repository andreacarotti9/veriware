import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeBlock,
  decodeFinalization,
  decodeFinalized,
  decodeNotarization,
  decodeNotarized,
  decodeSeed,
  defineNetwork,
  fromHex,
  init,
  networks,
  verifyFinalization,
  verifyFinalized,
  verifyNotarization,
  verifyNotarized,
  verifySeed,
  type Network,
  type Verified,
} from '../src/index.js';
import { bundle, networkFor, vector } from './fixtures.js';

beforeAll(async () => {
  await init();
});

/** Renders an outcome the way a vector states it: `"ok"` or an error code. */
function code(result: Verified<unknown>): string {
  return result.ok ? 'ok' : result.error.code;
}

function verify(kind: string, payload: Uint8Array, network: Network): string | null {
  switch (kind) {
    case 'seed':
      return code(verifySeed(payload, network));
    case 'notarization':
      return code(verifyNotarization(payload, network));
    case 'finalization':
      return code(verifyFinalization(payload, network));
    case 'notarized':
      return code(verifyNotarized(payload, network));
    case 'finalized':
      return code(verifyFinalized(payload, network));
    // A bare block carries no certificate, so there is nothing to verify.
    case 'block':
      return null;
    default:
      throw new Error(`unknown vector kind ${kind}`);
  }
}

function decode(kind: string, payload: Uint8Array): string {
  switch (kind) {
    case 'seed':
      return code(decodeSeed(payload));
    case 'notarization':
      return code(decodeNotarization(payload));
    case 'finalization':
      return code(decodeFinalization(payload));
    case 'notarized':
      return code(decodeNotarized(payload));
    case 'finalized':
      return code(decodeFinalized(payload));
    case 'block':
      return code(decodeBlock(payload));
    default:
      throw new Error(`unknown vector kind ${kind}`);
  }
}

describe('conformance', () => {
  it('has fixtures to run', () => {
    expect(bundle.vectors.length).toBeGreaterThan(0);
  });

  // One case per vector, so a failure names the certificate that broke.
  it.each(bundle.vectors.map((entry) => [entry.name, entry] as const))('%s', (_name, entry) => {
    const payload = fromHex(entry.payload);
    expect(verify(entry.kind, payload, networkFor(entry.network)), entry.about).toBe(entry.verify);
    expect(decode(entry.kind, payload), entry.about).toBe(entry.decode);
  });
});

describe('decoded values', () => {
  it('exposes the certified block', () => {
    const result = verifyFinalized(
      fromHex(vector('finalized/valid').payload),
      networkFor('devnet'),
    );
    if (!result.ok) throw new Error(`expected success, got ${result.error.code}`);

    const { proof, block } = result.decoded;
    expect(block.digest).toEqual(proof.payload);
    expect(block.height).toBe(2n);
    expect(proof.epoch).toBe(0n);
    expect(proof.view).toBe(9n);
    expect(block.context.view).toBe(9n);
  });

  it('returns bytes as Uint8Array and counters as bigint', () => {
    const result = verifySeed(fromHex(vector('seed/valid').payload), networkFor('devnet'));
    if (!result.ok) throw new Error(`expected success, got ${result.error.code}`);

    expect(result.decoded.signature).toBeInstanceOf(Uint8Array);
    expect(result.decoded.signature).toHaveLength(48);
    expect(typeof result.decoded.view).toBe('bigint');
  });

  it('reads a rejected payload without believing it', () => {
    const forged = fromHex(vector('seed/foreign-signature').payload);
    expect(verifySeed(forged, networkFor('devnet')).ok).toBe(false);

    const claimed = decodeSeed(forged);
    if (!claimed.ok) throw new Error('a forgery should still decode');
    expect(claimed.decoded.view).toBe(9n);
  });
});

describe('networks', () => {
  it('ships the devnet identity the fixtures were generated with', () => {
    expect(networks.altoDevnet.identity).toEqual(fromHex(bundle.networks.devnet!.identity));
  });

  it('pins alto identities to 96-byte threshold keys', () => {
    for (const network of [networks.alto, networks.altoUsa, networks.altoDevnet]) {
      expect(network.identity).toHaveLength(96);
      expect(new TextDecoder().decode(network.namespace)).toBe('_ALTO');
    }
  });

  it('rejects an identity that is not a public key, without throwing', () => {
    const bogus = defineNetwork({ namespace: '_ALTO', identity: new Uint8Array(96) });
    const result = verifySeed(fromHex(vector('seed/valid').payload), bogus);
    expect(result).toStrictEqual({
      ok: false,
      error: { code: 'invalid_identity', message: expect.any(String) },
    });
  });

  it('verifies a non-alto network defined at runtime', () => {
    const alt = bundle.networks.alt!;
    const mine = defineNetwork({
      name: 'mine',
      namespace: fromHex(alt.namespace),
      identity: fromHex(alt.identity),
    });
    const payload = fromHex(vector('seed/valid-on-alt-network').payload);

    expect(verifySeed(payload, mine).ok).toBe(true);
    expect(verifySeed(payload, networks.altoDevnet).ok).toBe(false);
  });
});

describe('adversarial input', () => {
  it('never throws, whatever the bytes', () => {
    // A deterministic byte stream: reproducible failures beat lucky ones.
    let state = 0x2545f491;
    const next = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state & 0xff;
    };

    for (const length of [0, 1, 47, 96, 145, 331, bundle.maxPayloadLen, bundle.maxPayloadLen + 1]) {
      const payload = Uint8Array.from({ length }, next);
      for (const kind of ['seed', 'notarization', 'finalization', 'notarized', 'finalized']) {
        expect(verify(kind, payload, networks.altoDevnet)).not.toBe('ok');
        expect(() => decode(kind, payload)).not.toThrow();
      }
      expect(() => decodeBlock(payload)).not.toThrow();
    }
  });

  it('rejects every prefix of a valid certificate', () => {
    const payload = fromHex(vector('finalized/valid').payload);
    for (let length = 0; length < payload.length; length += 1) {
      expect(verifyFinalized(payload.subarray(0, length), networkFor('devnet')).ok).toBe(false);
    }
    expect(verifyFinalized(payload, networkFor('devnet')).ok).toBe(true);
  });
});
