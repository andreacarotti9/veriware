# Pinned versions

Every version here is exact (`=` in Cargo.toml, no `^` in package.json).
Certificate encodings are a wire contract: an upstream patch release can change
what verifies. Bumps are deliberate - run `just bump-deps`, then `just ci`, and
let the fixture parity suite prove nothing moved.

Recorded 2026-08-11. Names claimed on npm and crates.io: `veriware` (npm),
`veriware` and `veriware-core` (crates.io), all verified free on that date and
none of them published yet.

## Toolchain

| Tool | Version | Where pinned |
|---|---|---|
| Rust | stable (built with 1.97.0) | `rust-toolchain.toml` |
| `wasm32-unknown-unknown` target | - | `rust-toolchain.toml` |
| wasm-pack | 0.15.0 | this file; CI installs it via `taiki-e/install-action` |
| Node | 24 (LTS) | `.nvmrc` |
| npm | 11.x | ships with Node 24 |

wasm-pack downloads a `wasm-bindgen-cli` matching the `wasm-bindgen` version in
`Cargo.lock`, so the CLI needs no separate pin.

**macOS also needs `brew install llvm`.** Apple's clang has no WebAssembly
backend, and `commonware-consensus` pulls in `zstd`, which is C. `just wasm`
picks up `/opt/homebrew/opt/llvm/bin/clang` automatically when it is present.
Linux clang already has the backend, so CI needs nothing extra. See decision
D10.

## Rust crates

| Crate | Version | Why it is here |
|---|---|---|
| `alto-types` | 2026.7.1 | The wrapped upstream. Certificate types, `_ALTO` namespace, `Block`/`Notarized`/`Finalized`. |
| `commonware-codec` | 2026.7.0 | `Decode`/`Encode`; the decode errors veriware maps to its typed errors. |
| `commonware-consensus` | 2026.7.0 | `simplex` certificate types and `bls12381_threshold::vrf::Scheme`. |
| `commonware-cryptography` | 2026.7.0 | BLS12-381 MinSig, SHA-256, Ed25519. Never reimplemented. |
| `commonware-parallel` | 2026.7.0 | `Sequential` verification strategy (single-threaded; WASM has no threads). |
| `commonware-utils` | 2026.7.0 | `sys_rng` for the batch-verification randomizers. |
| `wasm-bindgen` | 0.2.127 | Must be semver-compatible with `alto-types`' `^0.2.100` - the whole graph resolves to one version or the ABI breaks. |
| `serde-wasm-bindgen` | 0.6.5 | Same version `alto-types` uses. Build-time only. |
| `getrandom` | 0.4.3 (`wasm_js`, wasm32 only) | Browser entropy. Mirrors `alto-types`. |
| `serde` | 1.0.229 | Serializing the decoded views across the WASM boundary. |
| `thiserror` | 2.0.20 | Typed errors. |
| `rand` | 0.10.2 | Dev/fixtures only: seeded `StdRng` for deterministic vectors. |
| `serde_json` | 1.0.151 | Dev/fixtures only: the fixture manifest. |

Browser tests need Chromium: `cd js && npx playwright install chromium`. They
run under `just test-browser`, not `just ci`, so a machine without it can still
gate a change.

The four `commonware-*` crates are pinned to 2026.7.0 because that is what
`alto-types` 2026.7.1 resolves to. They must move together with it.

## npm

The published package has **zero runtime dependencies** - enforced by
`just no-runtime-deps`. Dev dependencies are pinned exactly in
`js/package.json`; see that file for the list (typescript, vitest, eslint,
prettier, size-limit, playwright for the browser smoke test).
