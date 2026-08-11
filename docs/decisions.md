# Design notes

Why things are the way they are, for the choices where the reasoning is not
obvious from the code.

## Wrap `alto-types`; never reimplement the cryptography

`veriware-core` depends on the published `alto-types` crate and calls its
verification paths. The BLS12-381 variant, the hash-to-curve domain separation
tag, the message encodings and the namespace derivation are therefore correct
by construction: if upstream changes them, this crate changes with it on the
next pin bump, and the fixture suite says so out loud.

This rules out a hand-written verifier, and for v1 a pure-JS `@noble/curves`
backend, since reimplementing hash-to-curve is exactly the conformance risk the
decision exists to avoid. A second backend would need a parity suite proving it
byte-identical on every fixture first.

## What upstream already does, and what this adds

`alto-types` 2026.7.1 already ships a `wasm` module built with `wasm-pack build
--target web`, and the alto explorer already verifies certificates in the
browser with it:

| Export | Behavior |
|---|---|
| `parse_seed(identity, bytes)` | decode + verify, `null` on any failure |
| `parse_notarized(identity, bytes)` | decode + verify, `null` on any failure |
| `parse_finalized(identity, bytes)` | decode + verify, `null` on any failure |
| `parse_block(bytes)` | decode only; a block carries no certificate |
| `leader_index(seed, participants)` | VRF leader election for the explorer's map |

The explorer vendors that output into `explorer/src/alto_types/` and marks the
app `private: true`, so it is unversioned, unpublished and undocumented. The
gap this project fills is what has to sit on top:

1. **No reachable panics.** `parse_*` calls
   `Identity::decode(..).expect("invalid identity")` and `leader_index` calls
   `.expect("too many participants")`. In WebAssembly a panic poisons the
   module instance, so a caller-supplied identity becomes a denial of service.
2. **Typed errors instead of `null`.** Upstream collapses "not a certificate",
   "truncated", "wrong network" and "forged signature" into one `null`. A
   verifier that cannot say why it rejected is not auditable.
3. **Length caps before decode.** Upstream decodes whatever it is handed.
4. **A namespace parameter.** `parse_*` hardcodes `NAMESPACE = b"_ALTO"`, so
   the bindings cannot verify any other threshold-simplex network. Taking
   `(namespace, identity)` is the whole generic thesis.
5. **Decode without verifying.** No upstream entry point returns the contents
   of a certificate it could not verify, which is what a UI needs to explain a
   rejection.
6. **Bare certificates.** Upstream exposes only `Notarized`/`Finalized`
   (certificate plus alto block). A non-alto network has no alto `Block`.

None of that required reaching into `alto-types` internals; every path is
public API.

## Sequential verification, OS entropy

Verification uses `commonware_parallel::Sequential`. WebAssembly has no threads
without `SharedArrayBuffer` and cross-origin isolation, which is a deployment
burden not worth imposing on consumers, and there is nothing to parallelize
within a single threshold aggregate anyway.

`Notarization::verify` and `Finalization::verify` take a `CryptoRng` to
randomize batch verification. This passes `commonware_utils::sys_rng()`, as
`alto-types` does, which is `crypto.getRandomValues` in a browser and hence the
`getrandom/wasm_js` pin for wasm32. Seeding it deterministically would make the
randomizers predictable and weaken batch verification, so it is not an option.

## Errors are values on both sides of the boundary

Nothing throws for bad input. The WASM bindings serialize
`{ ok: true, decoded } | { ok: false, error: { code, message } }`, because a
`wasm_bindgen` `Result::Err` becomes a thrown JS exception, which is the one
failure mode a caller of an adversarial-input API forgets to catch. `code` is
stable and part of the public API; `message` is not.

`u64` crosses as `bigint`. Views, heights and timestamps are
attacker-controlled and pass `Number.MAX_SAFE_INTEGER` long before they
exhaust `u64`, and a verified value that silently rounds is worse than one the
caller has to write `2n` for.
