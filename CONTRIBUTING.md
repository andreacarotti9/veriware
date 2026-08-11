# Contributing

## Wrap; do not rewrite

The Rust core depends on published `alto-types` and calls its verification
paths. Do not reimplement cryptography here: not the BLS variant, not
hash-to-curve, not the domain separation tag, not the message encoding. If
something upstream is inconvenient, wrap it or open an issue there.

The moment this crate computes a signature message itself, conformance stops
being guaranteed and starts being hoped for. That rules out a `@noble/curves`
backend, a hand-rolled codec, and "just this one field" parsing.

## Treat every byte from outside as hostile

Certificates, identities, indexer responses, WebSocket frames, URLs.

- Cap the length before decoding.
- No `unwrap`, `expect`, `panic!`, indexing, or overflowing arithmetic on any
  path reachable from the public API. A panic in WebAssembly poisons the module
  instance for the rest of the page, so it is a denial of service rather than a
  crash. `core/src/lib.rs` denies `clippy::unwrap_used` and
  `clippy::expect_used`; tests may use them freely.
- Every failure is a typed error with a stable `code`. Not a bare string, not a
  thrown exception, not `null`.
- Error messages describe the input, not this crate's internals.

## The fixtures are the contract

`fixtures/` holds golden vectors: valid certificates and a tampered variant for
every way a certificate can be wrong. The Rust and TypeScript suites run the
same files and must agree on accept, reject, and error code. `just
fixtures-parity` is the focused loop.

Regeneration is `just fixtures` and is deterministic. A diff in `git status`
afterwards means behavior changed: work out why, then note it in
`CHANGELOG.md`. Never regenerate to make a test pass.

## The npm package has no runtime dependencies

A WASM asset and TypeScript. `fetch` and `WebSocket` are platform features, not
packages. Adding a runtime dependency needs an entry in `docs/decisions.md`
explaining what it does that a few lines cannot.

ESM only, no CJS build. `Uint8Array` in and out; the hex helpers are a
convenience and never required. TypeScript strict mode, and every exported
symbol carries TSDoc.

## Pins are exact

`=` in `Cargo.toml`, no `^` in `package.json`. `wasm-bindgen` must stay
semver-compatible with what `alto-types` requires, or the ABI breaks at runtime
rather than at build time. Bumping is `just bump-deps` followed by `just ci`.

## `just ci` is the gate

`lint`, `fixtures-check`, `test`, `no-runtime-deps`, `size`, `smoke`. Green
locally means green in CI: the workflow is a thin wrapper over the same
recipes.

On macOS you also need `brew install llvm` to build the WASM, since Apple's
clang has no WebAssembly backend. Browser tests need `npx playwright install
chromium` and run under `just test-browser`.

## Commits

`[component] Subject In Title Case`, where component is one of `core`, `js`,
`fixtures`, `demo`, `docs`, `ci`, `repo`, `release`. One complete change per
commit: it should build, lint, and test on its own.
