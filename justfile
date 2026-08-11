# veriware - every gate CI runs is a recipe here, so `just ci` is the whole contract.
# Run `just` to list.

wasm_out := justfile_directory() / "js/src/wasm"
pkg := justfile_directory() / "js"

default:
    @just --list --unsorted

# Format Rust and TypeScript in place.
fmt:
    cargo fmt --all
    cd {{pkg}} && npm run fmt

alias f := fmt

# Every linter, no fixes. Fails on any warning. Depends on `build` because
# typechecking needs the generated WASM bindings and the demo imports the
# built package; on a fresh checkout neither exists yet.
lint: build
    cargo fmt --all -- --check
    cargo clippy --all-targets --all-features -- -D warnings
    cd {{pkg}} && npm run lint && npm run typecheck
    cd {{pkg}} && npx tsc -p ../demo/tsconfig.json --noEmit

alias l := lint

# Build the WASM artifact into js/src/wasm (the package's only asset).
wasm:
    #!/usr/bin/env bash
    set -euo pipefail
    # `commonware-consensus` pulls in zstd, which is C, and Apple's clang ships
    # without a WebAssembly backend. Homebrew's LLVM has one; Linux clang already
    # does, so CI never takes this branch.
    if [ -x /opt/homebrew/opt/llvm/bin/clang ]; then
      export CC_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/clang
      export AR_wasm32_unknown_unknown=/opt/homebrew/opt/llvm/bin/llvm-ar
    fi
    wasm-pack build core --release --target web --out-dir {{wasm_out}} --out-name veriware
    rm -f {{wasm_out}}/.gitignore {{wasm_out}}/package.json {{wasm_out}}/README.md

alias b := wasm

# Compile the package: TypeScript to dist/, WASM asset alongside it.
build: wasm
    cd {{pkg}} && npm run build

# Regenerate the golden fixtures. Deterministic: a diff means behavior changed.
fixtures:
    cargo run --release --bin veriware-fixtures -- fixtures

# Fail if the committed fixtures differ from a fresh generation.
fixtures-check: fixtures
    git diff --exit-code --stat -- fixtures/vectors.json

# Prove both implementations agree on every fixture: same accepts, same
# rejects, same error codes. `test` runs this as part of a wider suite; this
# recipe is the focused loop for when the fixtures themselves are changing.
fixtures-parity: wasm
    cargo nextest run -p veriware-core --test conformance
    cd {{pkg}} && npx vitest run --project node test/conformance.test.ts

# Rust tests, then the TypeScript suite (which replays the same fixtures).
test: wasm
    cargo nextest run --all-features --workspace
    cd {{pkg}} && npm test

alias t := test

# Verify one fixture in a real browser. Needs `npx playwright install chromium`.
test-browser: wasm
    cd {{pkg}} && npm run test:browser

# Report the shipped bundle size. Printed by `ci`; the README quotes it.
size: build
    cd {{pkg}} && npm run size

# The published package must have no runtime dependencies.
no-runtime-deps:
    cd {{pkg}} && npm ls --omit=dev --depth=999

# Install the tarball into a scratch project and run the node example against it.
smoke: build
    ./scripts/smoke.sh

# Compile the demo page against the built package.
demo-build: build
    cd {{pkg}} && npx tsc -p ../demo/tsconfig.json

# Serve the demo at http://localhost:8000/demo/.
#
# Served from the repository root so the page can reach both the built package
# and `fixtures/`, which is what makes offline replay work.
demo: demo-build
    @echo "open http://localhost:8000/demo/"
    npx --yes serve -l 8000 .

# Everything CI runs.
ci: lint fixtures-check test no-runtime-deps size smoke

alias pr := ci

# Refresh every pinned dependency, then prove the fixtures still verify.
bump-deps:
    cargo update
    cd {{pkg}} && npm update
    @echo "Pins in Cargo.toml / package.json are exact: edit them by hand, then run `just ci`."
