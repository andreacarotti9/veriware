import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AltoIndexerClient,
  decodeBlock,
  fromHex,
  init,
  toHex,
  type FetchLike,
  type WebSocketLike,
} from '../src/index.js';
import { bundle, networkFor, vector } from './fixtures.js';

beforeAll(async () => {
  await init();
});

afterEach(() => {
  vi.useRealTimers();
});

const url = 'https://indexer.example';

/** Answers every request with the same bytes, and records what was asked. */
function serving(payload: Uint8Array, status = 200): { fetch: FetchLike; paths: string[] } {
  const paths: string[] = [];
  return {
    paths,
    fetch: (input) => {
      paths.push(new URL(input).pathname);
      return Promise.resolve(
        new Response(status === 200 ? (payload as BufferSource) : null, { status }),
      );
    },
  };
}

function client(fetchLike: FetchLike, options: Partial<{ maxResponseBytes: number }> = {}) {
  return new AltoIndexerClient({
    url,
    network: networkFor('devnet'),
    fetch: fetchLike,
    ...options,
  });
}

describe('http', () => {
  it('verifies the finalized head', async () => {
    const payload = fromHex(vector('finalized/valid').payload);
    const { fetch, paths } = serving(payload);

    const result = await client(fetch).latest();

    expect(paths).toEqual(['/block/latest']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decoded.block.height).toBe(2n);
  });

  it('asks for an index as a big-endian u64 in hex', async () => {
    const { fetch, paths } = serving(fromHex(vector('finalized/valid').payload));

    await client(fetch).finalization(9n);

    expect(paths).toEqual(['/finalization/0000000000000009']);
  });

  it('rejects a forged response instead of returning it', async () => {
    const { fetch } = serving(fromHex(vector('finalized/tampered-block').payload));

    const result = await client(fetch).latest();

    expect(result).toStrictEqual({
      ok: false,
      error: { code: 'inconsistent', message: expect.any(String) },
    });
  });

  it('rejects a genuine certificate that answers a different view', async () => {
    const { fetch } = serving(fromHex(vector('finalized/valid').payload));

    // The fixture certifies view 9; ask for view 10.
    const result = await client(fetch).finalization(10n);

    expect(result).toStrictEqual({
      ok: false,
      error: { code: 'unexpected_response', message: expect.stringContaining('10') },
    });
  });

  it('rejects a genuine certificate that answers a different height', async () => {
    const { fetch } = serving(fromHex(vector('finalized/valid').payload));

    const result = await client(fetch).blockAtHeight(99n);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unexpected_response');
  });

  it('reports an error status as unavailable', async () => {
    const { fetch } = serving(new Uint8Array(), 503);

    const result = await client(fetch).latest();

    expect(result).toStrictEqual({
      ok: false,
      error: { code: 'unavailable', message: expect.stringContaining('503') },
    });
  });

  it('reports a transport failure as unavailable', async () => {
    const result = await client(() => Promise.reject(new Error('DNS'))).latest();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('unavailable');
  });

  it('refuses a response larger than the cap', async () => {
    const { fetch } = serving(new Uint8Array(8192));

    const result = await client(fetch, { maxResponseBytes: 4096 }).latest();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_large');
  });

  it('refuses a response whose declared length is over the cap', async () => {
    const fetchLike: FetchLike = () =>
      Promise.resolve(
        new Response(new Uint8Array(16), { headers: { 'content-length': '1000000' } }),
      );

    const result = await client(fetchLike).latest();

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('too_large');
  });

  it('surfaces garbage as a decode failure, not as data', async () => {
    const { fetch } = serving(Uint8Array.from({ length: 64 }, (_, index) => index));

    const result = await client(fetch).latest();

    expect(result.ok).toBe(false);
  });

  it('rehashes a block fetched by digest and rejects a substitution', async () => {
    const served = fromHex(vector('block/valid').payload);
    const decoded = decodeBlock(served);
    if (!decoded.ok) throw new Error('the block fixture must decode');
    const instance = client(serving(served).fetch);

    const asked = await instance.blockByDigest(decoded.decoded.digest, { unverified: true });
    expect(asked.ok).toBe(true);

    // Same response, different question: the indexer answered about a block
    // nobody asked for.
    const substituted = await instance.blockByDigest(new Uint8Array(32), { unverified: true });
    expect(substituted.ok).toBe(false);
    if (!substituted.ok) expect(substituted.error.code).toBe('unexpected_response');
  });

  it('asks for a block by digest as hex', async () => {
    const { fetch, paths } = serving(fromHex(vector('block/valid').payload));
    const digest = new Uint8Array(32).fill(0xab);

    await client(fetch).blockByDigest(digest, { unverified: true });

    expect(paths).toEqual([`/block/${toHex(digest)}`]);
  });
});

/** A WebSocket that a test drives by hand. */
class FakeSocket implements WebSocketLike {
  static opened: FakeSocket[] = [];

  binaryType = '';
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSocket.opened.push(this);
  }

  close(): void {
    this.closed = true;
  }

  deliver(frame: Uint8Array): void {
    const buffer = new ArrayBuffer(frame.length);
    new Uint8Array(buffer).set(frame);
    this.onmessage?.({ data: buffer });
  }

  drop(): void {
    this.onclose?.({});
  }
}

function subscribing() {
  FakeSocket.opened = [];
  const instance = new AltoIndexerClient({
    url,
    network: networkFor('devnet'),
    fetch: () => Promise.reject(new Error('unused')),
    webSocket: (target) => new FakeSocket(target),
    backoff: { initialMs: 100, maxMs: 100 },
  });
  return instance;
}

function frame(name: string): Uint8Array {
  const found = bundle.frames.find((candidate) => candidate.name === name);
  if (found === undefined) throw new Error(`no frame fixture named ${name}`);
  return fromHex(found.frame);
}

describe('websocket', () => {
  it('connects to the consensus endpoint over wss', () => {
    const stop = subscribing().subscribe(() => {});

    expect(FakeSocket.opened[0]?.url).toBe('wss://indexer.example/consensus/ws');
    expect(FakeSocket.opened[0]?.binaryType).toBe('arraybuffer');
    stop();
  });

  it('surfaces each verified frame to its own callback', () => {
    const seen: string[] = [];
    const stop = subscribing().subscribe({
      onSeed: () => seen.push('seed'),
      onNotarized: () => seen.push('notarized'),
      onFinalized: () => seen.push('finalized'),
      onError: (error) => seen.push(`error:${error.code}`),
    });

    const socket = FakeSocket.opened[0]!;
    socket.deliver(frame('frame/seed'));
    socket.deliver(frame('frame/notarization'));
    socket.deliver(frame('frame/finalization'));

    expect(seen).toEqual(['seed', 'notarized', 'finalized']);
    stop();
  });

  it('drops every bad frame the fixtures describe', () => {
    const surfaced: unknown[] = [];
    const errors: string[] = [];
    const stop = subscribing().subscribe({
      onSeed: (value) => surfaced.push(value),
      onNotarized: (value) => surfaced.push(value),
      onFinalized: (value) => surfaced.push(value),
      onError: (error) => errors.push(error.code),
    });

    const socket = FakeSocket.opened[0]!;
    for (const bad of bundle.frames.filter((entry) => entry.kind === null)) {
      socket.deliver(fromHex(bad.frame));
    }

    expect(surfaced).toEqual([]);
    expect(errors).toEqual(
      bundle.frames.filter((entry) => entry.kind === null).map((entry) => entry.expect),
    );
    stop();
  });

  it('rejects a non-binary frame', () => {
    const errors: string[] = [];
    const stop = subscribing().subscribe({ onError: (error) => errors.push(error.code) });

    FakeSocket.opened[0]!.onmessage?.({ data: 'hello' });

    expect(errors).toEqual(['malformed']);
    stop();
  });

  it('reconnects after a drop, with backoff', () => {
    vi.useFakeTimers();
    const statuses: string[] = [];
    const stop = subscribing().subscribe({ onStatus: (status) => statuses.push(status) });

    FakeSocket.opened[0]!.onopen?.({});
    FakeSocket.opened[0]!.drop();
    expect(FakeSocket.opened).toHaveLength(1);

    vi.advanceTimersByTime(200);

    expect(FakeSocket.opened).toHaveLength(2);
    expect(statuses).toEqual(['open', 'closed', 'reconnecting']);
    stop();
  });

  it('stops reconnecting once unsubscribed', () => {
    vi.useFakeTimers();
    const stop = subscribing().subscribe(() => {});

    stop();
    FakeSocket.opened[0]!.drop();
    vi.advanceTimersByTime(10_000);

    expect(FakeSocket.opened).toHaveLength(1);
    expect(FakeSocket.opened[0]!.closed).toBe(true);
  });
});

describe('health', () => {
  it('is true only for a 2xx', async () => {
    expect(await client(() => Promise.resolve(new Response(null, { status: 200 }))).health()).toBe(
      true,
    );
    expect(await client(() => Promise.resolve(new Response(null, { status: 500 }))).health()).toBe(
      false,
    );
    expect(await client(() => Promise.reject(new Error('offline'))).health()).toBe(false);
  });
});
