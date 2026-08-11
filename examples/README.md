# Examples

Each assumes `npm install veriware` (or an import map / CDN, as the browser one
shows).

| File | What it shows |
|---|---|
| `node/verify-fixture.mjs` | Verify a certificate with no network access. Deterministic; this is what `just smoke` runs against a freshly packed tarball. |
| `node/follow-head.mjs` | Follow alto's finalized head over WebSocket, verifying every frame. |
| `browser/index.html` | A page with no bundler and no build step. |
| `react/useFinalizedHead.ts` | Twenty lines to copy into a React app. The package has no React dependency. |

`demo/` at the repository root is the fuller version of the browser example:
live indexer when one answers, committed fixtures when none does.
