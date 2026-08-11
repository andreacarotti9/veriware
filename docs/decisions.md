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
