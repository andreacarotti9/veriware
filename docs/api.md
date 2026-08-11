# API

What to reach for and why. The TSDoc on each symbol covers the details.

## Getting started

```ts
import { init, networks, verifyFinalized } from 'veriware';

await init();

const result = verifyFinalized(bytes, networks.alto);
if (result.ok) {
  console.log('final at height', result.decoded.block.height);
} else {
  console.warn('rejected:', result.error.code);
}
```

Nothing in the package throws for bad input. Every entry point returns

```ts
{ ok: true, decoded: T } | { ok: false, error: { code, message } }
```

so `if (!result.ok)` is the only control flow there is. `code` is stable API;
`message` is for humans and may change.

Bytes are always `Uint8Array`. Consensus counters - views, heights, timestamps -
are always `bigint`, because they are attacker-controlled `u64`s that exceed
`Number.MAX_SAFE_INTEGER` long before they exceed `u64`.

---

## `init(source?)`

Loads the WebAssembly module. Idempotent: concurrent calls share one load.

| Argument | Behavior |
|---|---|
| omitted | Fetches `veriware_bg.wasm` from next to the package's own JavaScript. Under Node the same path is a `file:` URL, which `fetch` refuses, so it is read from disk. |
| `string` / `URL` | Fetched. Use this to serve the asset from a CDN. |
| `Response` / `BufferSource` | Used directly. |

This is the only async, developer-facing call, and the only one that throws - a
404 or a `WebAssembly.CompileError` is your bug, not an attacker's payload.
Calling a verify function before `init` resolves returns
`{ ok: false, error: { code: 'not_initialized' } }`.

`isInitialized()` reports whether it has resolved.

---

## Networks

A threshold-simplex network is a signing namespace plus a threshold public key.

```ts
const mine = defineNetwork({
  namespace: '_MYCHAIN',       // string is UTF-8 encoded; pass bytes if yours is not text
  identity: fromHex('a6ad...'),  // 96-byte compressed BLS12-381 G2 element
  name: 'mychain',             // optional label, not used in verification
});
```

`defineNetwork` never throws and never validates. An identity that is not a
point on the curve is reported by the first verify call as `invalid_identity`,
in the same shape as every other rejection.

Presets:

| Preset | Indexer | Identity source |
|---|---|---|
| `networks.alto` | `global.alto.exoware.xyz` | alto repo, `explorer/src/global_config.ts` (commit `b880582`) |
| `networks.altoUsa` | `usa.alto.exoware.xyz` | alto repo, `explorer/src/usa_config.ts` (commit `b880582`) |
| `networks.altoDevnet` | none | `fixtures/vectors.json`, generated from a seeded RNG |

Alto pins epoch 0 and never reshares, so these identities do not rotate. A
network that does reshare needs identity rotation, which this package does not
implement.

---

## Verifying

| Function | Payload | Returns |
|---|---|---|
| `verifySeed(bytes, network)` | a seed | `Seed` |
| `verifyNotarization(bytes, network)` | a bare notarization certificate | `Certificate` |
| `verifyFinalization(bytes, network)` | a bare finalization certificate | `Certificate` |
| `verifyNotarized(bytes, network)` | notarization + alto block | `CertifiedBlock` |
| `verifyFinalized(bytes, network)` | finalization + alto block | `CertifiedBlock` |

Which one to call depends on what the wire gave you. Alto's HTTP endpoints and
WebSocket carry certificate-plus-block, so `verifyNotarized` and
`verifyFinalized` are the alto-facing pair. The bare-certificate functions are
for networks that ship certificates without an alto `Block` - that is what makes
the layer generic.

**Notarization is not finality.** A notarized view can still be skipped. If the
question is "is this permanent?", the answer comes from a finalization.

For `verifyNotarized` / `verifyFinalized`, success also binds the certificate to
that exact block: a payload whose block does not hash to the attested digest is
rejected as `inconsistent`.

## Decoding without verifying

`decodeSeed`, `decodeNotarization`, `decodeFinalization`, `decodeNotarized`,
`decodeFinalized`, `decodeBlock`.

These answer "what does this payload claim to be?" and nothing about whether the
claim is true. On a public network the answer is "whatever an attacker chose".
They exist so a UI can explain a rejection. `decodeBlock` has no verified
counterpart at all: a block carries no certificate, so it is only ever as
trustworthy as the certificate it arrived with.

## Error codes

| Code | Meaning |
|---|---|
| `too_large` | Longer than the payload cap. Rejected before decoding. |
| `namespace_too_large` | The network's namespace exceeds the cap. |
| `invalid_identity` | The network's identity is not a valid threshold public key. |
| `truncated` | The payload ended mid-field. |
| `trailing_bytes` | Decoded, but bytes were left over. |
| `malformed` | Not a well-formed value of the requested kind. |
| `inconsistent` | A certificate stapled to a block it does not attest to. |
| `invalid_certificate` | Signature bytes that are not points on the curve. |
| `invalid_signature` | Well-formed, but not signed by this network. |
| `unknown_kind` | A framed message with an unrecognized kind byte. |
| `not_initialized` | `init()` has not resolved yet. |
| `unavailable` | Client only: the request failed or the indexer errored. |
| `unexpected_response` | Client only: verified, but answers a different question than was asked. |

---

## `AltoIndexerClient`

```ts
const client = new AltoIndexerClient({
  url: 'https://global.alto.exoware.xyz',
  network: networks.alto,
});

const head = await client.latest();
const stop = client.subscribe((block) => console.log(block.block.height));
```

Everything it returns has been verified against `network`. A response that does
not verify is an error, not a value.

| Method | Endpoint | Returns |
|---|---|---|
| `latest()` | `GET /block/latest` | `CertifiedBlock` |
| `seed(view?)` | `GET /seed/{view}` | `Seed` |
| `notarization(view?)` | `GET /notarization/{view}` | `CertifiedBlock` |
| `finalization(view?)` | `GET /finalization/{view}` | `CertifiedBlock` |
| `blockAtHeight(height)` | `GET /block/{height}` | `CertifiedBlock` |
| `blockByDigest(digest, { unverified: true })` | `GET /block/{digest}` | `Block` |
| `subscribe(handler)` | `WS /consensus/ws` | unsubscribe function |
| `health()` | `GET /health` | `boolean` |

Options: `timeoutMs` (10000), `maxResponseBytes` (4096), `backoff`
(`{ initialMs: 1000, maxMs: 30000 }`), and injectable `fetch` / `webSocket` for
tests.

Beyond verifying signatures, the client checks that a response answers the
question that was asked - the certificate is for the requested view, the block
is at the requested height, the block hashes to the requested digest - and
returns `unexpected_response` when it does not. Response bodies are capped
before they are read, by declared length and again by actual length.

`blockByDigest` is the one method that returns something no certificate vouches
for, so it will not run without the literal `{ unverified: true }`. The digest
check still applies, so the indexer cannot substitute a different block; nothing
proves the block is in the chain.

`subscribe` takes either a function (finalizations) or a `Subscription` object
with `onSeed`, `onNotarized`, `onFinalized`, `onError` and `onStatus`. Frames
that fail verification go to `onError` and no further.

---

## The indexer wire format

Read from `alto@b880582`: `client/src/lib.rs`, `client/src/consensus.rs`, and
the explorer's `App.tsx`. Reproduced here so the client can be audited against
it without cloning alto.

### HTTP

Base URL is the indexer origin - `https://global.alto.exoware.xyz`. All
responses are raw `commonware-codec` bytes with no envelope, no JSON, no
length prefix.

| Path | Response |
|---|---|
| `GET /seed/{query}` | `Seed` |
| `GET /notarization/{query}` | `Notarized` (certificate + block) |
| `GET /finalization/{query}` | `Finalized` (certificate + block) |
| `GET /block/latest` | `Finalized` |
| `GET /block/{height}` | `Finalized` |
| `GET /block/{digest}` | `Block`, bare |
| `GET /health` | status only |

`{query}` is either the literal `latest`, or a hex-encoded key:

- an index (view or height) is a **big-endian u64**, so 16 hex characters:
  view 9 is `0000000000000009`;
- a digest is 32 bytes, so 64 hex characters.

The server tells the two apart by length, which is why `/block/{query}` returns
a different type for each.

`POST` upload endpoints (`/seed`, `/notarization`, `/finalization`, `/block`)
exist for validators. A browser has nothing to upload, so this client does not
implement them.

### WebSocket

`wss://{host}/consensus/ws`, binary frames, `binaryType = 'arraybuffer'`. Each
frame is one kind byte followed by a payload:

| Kind | Payload |
|---|---|
| `0` | `Seed` |
| `1` | `Notarized` (certificate + block) |
| `2` | `Finalized` (certificate + block) |

Note that kinds `1` and `2` carry a block, unlike the bare certificates a
generic threshold-simplex network might send.

The public indexers rate-limit connections per IP; the explorer treats a close
within a second of opening as a rate-limit signal and waits eleven seconds
before retrying. This client's backoff starts at one second and doubles to
thirty, with full jitter. Do not tighten it.
