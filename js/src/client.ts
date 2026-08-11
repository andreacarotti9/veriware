/**
 * A browser client for the alto indexer.
 *
 * Everything it hands back has been verified against the configured network. A
 * response that does not verify is an error rather than a value: the indexer is
 * a transport, not an authority.
 *
 * @packageDocumentation
 */

import type { Network } from './networks.js';
import type { Block, CertifiedBlock, Seed, Verified, VerifyError } from './types.js';
import { decodeBlock, verifyFinalized, verifyNotarized, verifySeed } from './verify.js';

/** The subset of `fetch` this client uses. Injectable for tests. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** The subset of `WebSocket` this client uses. Injectable for tests. */
export interface WebSocketLike {
  binaryType: string;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  close(): void;
}

/** Constructs a WebSocket. Injectable for tests. */
export type WebSocketFactory = (url: string) => WebSocketLike;

/** How the client is wired up. */
export interface IndexerOptions {
  /** Base URL, e.g. `https://global.alto.exoware.xyz`. */
  url: string;
  /** The network every response is verified against. */
  network: Network;
  /** Request timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
  /**
   * Largest response body the client will read, in bytes. Default 4096.
   *
   * A certificate is a few hundred bytes. The cap exists so a hostile or broken
   * indexer cannot make a browser tab buffer a gigabyte before the verifier
   * ever sees it.
   */
  maxResponseBytes?: number;
  /** Reconnect backoff for {@link AltoIndexerClient.subscribe}. */
  backoff?: { initialMs?: number; maxMs?: number };
  /** Override `fetch`. Defaults to the global. */
  fetch?: FetchLike;
  /** Override the WebSocket constructor. Defaults to the global. */
  webSocket?: WebSocketFactory;
}

/** What a frame cost and what it carried, alongside the decoded value. */
export interface FrameInfo {
  /** The raw payload, kind byte removed. */
  readonly payload: Uint8Array;
  /**
   * How long verifying it took, in milliseconds. Measured around the
   * verification call alone: no network, no frame header decoding.
   */
  readonly verifiedInMs: number;
}

/** Callbacks for {@link AltoIndexerClient.subscribe}. */
export interface Subscription {
  /** A verified finalization arrived: this block is irreversibly in the chain. */
  onFinalized?: (block: CertifiedBlock, info: FrameInfo) => void;
  /** A verified notarization arrived. Not finality. */
  onNotarized?: (block: CertifiedBlock, info: FrameInfo) => void;
  /** A verified seed arrived. */
  onSeed?: (seed: Seed, info: FrameInfo) => void;
  /**
   * A frame was dropped. Every rejection lands here - a forgery, a truncated
   * frame, an unknown kind - and nothing that lands here is ever surfaced to
   * the other callbacks.
   */
  onError?: (error: VerifyError) => void;
  /** Connection state changed. */
  onStatus?: (status: 'open' | 'closed' | 'reconnecting') => void;
}

const KIND_SEED = 0;
const KIND_NOTARIZATION = 1;
const KIND_FINALIZATION = 2;

function failure<T>(code: VerifyError['code'], message: string): Verified<T> {
  return { ok: false, error: { code, message } };
}

/**
 * Talks to an alto indexer over HTTP and WebSocket, verifying as it goes.
 *
 * @example
 * ```ts
 * await init();
 * const client = new AltoIndexerClient({
 *   url: 'https://global.alto.exoware.xyz',
 *   network: networks.alto,
 * });
 *
 * const head = await client.latest();
 * if (head.ok) console.log('final at height', head.decoded.block.height);
 *
 * const stop = client.subscribe((block) => console.log(block.block.height));
 * ```
 *
 * @remarks
 * Zero dependencies: `fetch` and `WebSocket` are platform features. Both are
 * injectable, which is how the tests feed it malformed responses.
 *
 * The public indexers rate-limit WebSocket connections per IP and close a
 * too-eager reconnect within a second of opening. The default backoff starts at
 * one second and doubles to thirty; do not tighten it.
 */
export class AltoIndexerClient {
  readonly #base: string;
  readonly #wsBase: string;
  readonly #network: Network;
  readonly #timeoutMs: number;
  readonly #maxResponseBytes: number;
  readonly #initialBackoffMs: number;
  readonly #maxBackoffMs: number;
  readonly #fetch: FetchLike;
  readonly #webSocket: WebSocketFactory;

  constructor(options: IndexerOptions) {
    this.#base = options.url.replace(/\/+$/, '');
    this.#wsBase = this.#base.replace(/^http/, 'ws');
    this.#network = options.network;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 4096;
    this.#initialBackoffMs = options.backoff?.initialMs ?? 1_000;
    this.#maxBackoffMs = options.backoff?.maxMs ?? 30_000;
    this.#fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.#webSocket =
      options.webSocket ?? ((url) => new globalThis.WebSocket(url) as unknown as WebSocketLike);
  }

  /** The network responses are verified against. */
  get network(): Network {
    return this.#network;
  }

  /**
   * Whether the indexer answers at all.
   *
   * Says nothing about the chain - an indexer can be healthy and lying. Use it
   * to pick an endpoint, never to trust one.
   */
  async health(): Promise<boolean> {
    try {
      const response = await this.#fetch(`${this.#base}/health`, {
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** The most recent finalized block. */
  latest(): Promise<Verified<CertifiedBlock>> {
    return this.#certifiedBlock('block', 'latest', verifyFinalized);
  }

  /**
   * The seed for a view, or the newest one.
   *
   * The seed is a threshold signature over the round alone: unpredictable
   * before the view, fixed after it. That makes it usable as public randomness.
   */
  async seed(view?: bigint): Promise<Verified<Seed>> {
    const result = await this.#get('seed', index(view), (bytes) =>
      verifySeed(bytes, this.#network),
    );
    if (result.ok && view !== undefined && result.decoded.view !== view) {
      return mismatch(view, result.decoded.view);
    }
    return result;
  }

  /** The notarization for a view, or the newest one, with its block. */
  notarization(view?: bigint): Promise<Verified<CertifiedBlock>> {
    return this.#certifiedBlock('notarization', index(view), verifyNotarized, view);
  }

  /** The finalization for a view, or the newest one, with its block. */
  finalization(view?: bigint): Promise<Verified<CertifiedBlock>> {
    return this.#certifiedBlock('finalization', index(view), verifyFinalized, view);
  }

  /** The finalized block at a height. */
  async blockAtHeight(height: bigint): Promise<Verified<CertifiedBlock>> {
    const result = await this.#certifiedBlock('block', index(height), verifyFinalized);
    if (result.ok && result.decoded.block.height !== height) {
      return mismatch(height, result.decoded.block.height);
    }
    return result;
  }

  /**
   * The block with a given digest.
   *
   * **Unverified**, which is why saying so is mandatory. The indexer serves a
   * bare block here, with no certificate, so nothing proves this block is in
   * the chain - only that it is the block you named. The response is rehashed
   * and rejected if its digest is not the one requested, so the indexer cannot
   * answer a different question than it was asked; that is all this can offer.
   *
   * To learn whether a block is in the chain, verify a finalization that
   * attests to it.
   *
   * @param options.unverified - Must be `true`. It is here to make the caller
   * write the word.
   */
  async blockByDigest(digest: Uint8Array, options: { unverified: true }): Promise<Verified<Block>> {
    if (options.unverified !== true) {
      return failure('unexpected_response', 'blockByDigest requires { unverified: true }');
    }

    const result = await this.#get('block', hex(digest), decodeBlock);
    if (result.ok && hex(result.decoded.digest) !== hex(digest)) {
      return failure(
        'unexpected_response',
        `asked for block ${hex(digest)}, got ${hex(result.decoded.digest)}`,
      );
    }
    return result;
  }

  /**
   * Streams consensus messages, verifying every frame before surfacing it.
   *
   * Reconnects with exponential backoff and full jitter until the returned
   * function is called. A frame that fails verification goes to `onError` and
   * no further: nothing unverified reaches the other callbacks.
   *
   * @param handler - A function to receive finalizations, or a
   * {@link Subscription} for the rest. Every callback also receives a
   * {@link FrameInfo} with the raw payload and how long verifying it took.
   * @returns A function that closes the connection and stops reconnecting.
   */
  subscribe(
    handler: ((block: CertifiedBlock, info: FrameInfo) => void) | Subscription,
  ): () => void {
    const handlers: Subscription =
      typeof handler === 'function' ? { onFinalized: handler } : handler;

    let socket: WebSocketLike | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let stopped = false;

    const connect = (): void => {
      if (stopped) return;

      const current = this.#webSocket(`${this.#wsBase}/consensus/ws`);
      socket = current;
      current.binaryType = 'arraybuffer';

      current.onopen = () => {
        attempt = 0;
        handlers.onStatus?.('open');
      };

      current.onmessage = (event) => {
        this.#dispatch(event.data, handlers);
      };

      const reconnect = (): void => {
        if (stopped || socket !== current) return;
        socket = null;
        handlers.onStatus?.('closed');

        // Full jitter, so open tabs do not reconnect in lockstep and trip the
        // per-IP rate limit.
        const ceiling = Math.min(this.#maxBackoffMs, this.#initialBackoffMs * 2 ** attempt);
        attempt += 1;
        handlers.onStatus?.('reconnecting');
        timer = setTimeout(connect, Math.random() * ceiling);
      };

      current.onclose = reconnect;
      current.onerror = () => {
        // A socket that errors always closes too; closing here would double the
        // backoff for one failure.
      };
    };

    connect();

    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      const open = socket;
      socket = null;
      open?.close();
    };
  }

  /** Verifies one WebSocket frame and routes it, or reports why it was dropped. */
  #dispatch(data: unknown, handlers: Subscription): void {
    if (!(data instanceof ArrayBuffer)) {
      handlers.onError?.({ code: 'malformed', message: 'expected a binary frame' });
      return;
    }
    const frame = new Uint8Array(data);
    const kind = frame[0];
    if (kind === undefined) {
      handlers.onError?.({ code: 'truncated', message: 'frame carries no kind byte' });
      return;
    }

    const payload = frame.subarray(1);
    const started = performance.now();
    switch (kind) {
      case KIND_SEED: {
        const result = verifySeed(payload, this.#network);
        const info = { payload, verifiedInMs: performance.now() - started };
        if (result.ok) handlers.onSeed?.(result.decoded, info);
        else handlers.onError?.(result.error);
        return;
      }
      case KIND_NOTARIZATION: {
        const result = verifyNotarized(payload, this.#network);
        const info = { payload, verifiedInMs: performance.now() - started };
        if (result.ok) handlers.onNotarized?.(result.decoded, info);
        else handlers.onError?.(result.error);
        return;
      }
      case KIND_FINALIZATION: {
        const result = verifyFinalized(payload, this.#network);
        const info = { payload, verifiedInMs: performance.now() - started };
        if (result.ok) handlers.onFinalized?.(result.decoded, info);
        else handlers.onError?.(result.error);
        return;
      }
      default:
        handlers.onError?.({ code: 'unknown_kind', message: `unknown certificate kind ${kind}` });
    }
  }

  /** Fetches a certificate-plus-block and checks it answers the view asked for. */
  async #certifiedBlock(
    path: string,
    query: string,
    verify: (bytes: Uint8Array, network: Network) => Verified<CertifiedBlock>,
    view?: bigint,
  ): Promise<Verified<CertifiedBlock>> {
    const result = await this.#get(path, query, (bytes) => verify(bytes, this.#network));
    if (result.ok && view !== undefined && result.decoded.proof.view !== view) {
      return mismatch(view, result.decoded.proof.view);
    }
    return result;
  }

  /** One GET, length-capped, handed straight to a verifier. */
  async #get<T>(
    path: string,
    query: string,
    verify: (bytes: Uint8Array) => Verified<T>,
  ): Promise<Verified<T>> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#base}/${path}/${query}`, {
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      return failure('unavailable', `request failed: ${String(cause)}`);
    }

    if (!response.ok) {
      return failure('unavailable', `indexer returned ${response.status}`);
    }

    // Trust the declared length only far enough to refuse early; the real check
    // is on what actually arrived.
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > this.#maxResponseBytes) {
      return failure('too_large', `response declares ${declared} bytes`);
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await response.arrayBuffer());
    } catch (cause) {
      return failure('unavailable', `could not read response: ${String(cause)}`);
    }
    if (bytes.length > this.#maxResponseBytes) {
      return failure('too_large', `response is ${bytes.length} bytes`);
    }

    return verify(bytes);
  }
}

/** Serializes an index the way the indexer expects: big-endian u64 in hex. */
function index(value?: bigint): string {
  if (value === undefined) return 'latest';

  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, BigInt.asUintN(64, value));
  return hex(bytes);
}

function hex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function mismatch<T>(asked: bigint, got: bigint): Verified<T> {
  return failure('unexpected_response', `asked for ${asked}, got ${got}`);
}
