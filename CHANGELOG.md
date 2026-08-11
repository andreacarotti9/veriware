# Changelog

Notable changes per release. Certificate formats are a wire contract, so any
change to what verifies gets its own line here, whatever the version bump says.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project uses [semantic versioning](https://semver.org/); `code` strings on
errors and the shape of the fixture bundle are part of the public API.

## [Unreleased]

## [0.1.0] - staged, not published

First release.

### Added

- `verifySeed`, `verifyNotarization`, `verifyFinalization`, `verifyNotarized`
  and `verifyFinalized`: threshold-simplex certificate verification against any
  `(namespace, identity)` pair. Verification is delegated to `alto-types` and
  commonware-cryptography compiled to WebAssembly; no cryptography is
  implemented here.
- `defineNetwork` for any threshold-simplex chain, plus `networks.alto`,
  `networks.altoUsa` and `networks.altoDevnet`. The alto identities are the ones
  published in the alto repository, quoted with the file and commit they came
  from.
- `decodeSeed` ... `decodeBlock`: what a payload claims, unverified, for
  explaining a rejection.
- `AltoIndexerClient`: the alto indexer's HTTP and WebSocket surface over
  `fetch` and `WebSocket`, verifying every response and checking that it answers
  the question that was asked. Reconnects with exponential backoff and full
  jitter.
- `init`, `isInitialized`, `toHex`, `fromHex`.
- `fixtures/vectors.json`: 26 conformance vectors and 6 WebSocket frame
  fixtures, replayed by both the Rust and the TypeScript suite.
- A framework-free demo page: live finality with per-certificate verification
  latency, falling back to fixture replay when no indexer answers.

### Pinned

- `alto-types` 2026.7.1 and `commonware-*` 2026.7.0. Certificates produced by
  other versions are not covered by these fixtures.

### Measured

- WASM 80.4 kB brotli, 102.4 kB gzip. JavaScript 13.3 kB brotli.
- Zero runtime dependencies.
