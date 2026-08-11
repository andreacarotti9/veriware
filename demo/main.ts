/**
 * The live finality ticker.
 *
 * Two modes, chosen at runtime: subscribe to a public alto indexer when one
 * answers, replay the committed fixtures when none does. The verification path
 * is the same either way; only the source of the bytes differs.
 */

import {
  AltoIndexerClient,
  fromHex,
  init,
  networks,
  toHex,
  verifyFinalized,
  type CertifiedBlock,
  type Network,
  type VerifyError,
} from '../js/dist/index.js';

const INDEXERS: Record<string, string> = {
  alto: 'https://global.alto.exoware.xyz',
  altoUsa: 'https://usa.alto.exoware.xyz',
};

const REPLAY_INTERVAL_MS = 1200;
const LOG_ROWS = 12;

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`missing #${id}`);
  return found as T;
};

const ui = {
  network: element<HTMLSelectElement>('network'),
  status: element('status'),
  height: element('height'),
  view: element('view'),
  latency: element('latency'),
  counts: element('counts'),
  digest: element('digest'),
  caption: element('caption'),
  log: element<HTMLTableSectionElement>('log'),
};

let accepted = 0;
let rejected = 0;
let stop: () => void = () => {};

function setStatus(state: 'idle' | 'live' | 'replay' | 'down', text: string): void {
  ui.status.dataset.state = state;
  ui.status.textContent = text;
}

function record(
  kind: string,
  latencyMs: number | null,
  block: CertifiedBlock | null,
  why?: string,
): void {
  if (block === null) rejected += 1;
  else accepted += 1;
  ui.counts.textContent = `${accepted} / ${rejected}`;

  const row = document.createElement('tr');
  const cells = [
    kind,
    block === null ? '-' : String(block.proof.view),
    block === null ? '-' : String(block.block.height),
    latencyMs === null ? '-' : `${latencyMs.toFixed(2)} ms`,
    block === null ? (why ?? 'rejected') : 'verified',
  ];
  for (const [column, value] of cells.entries()) {
    const cell = document.createElement('td');
    cell.textContent = value;
    if (column === cells.length - 1) {
      cell.className = 'verdict';
      cell.dataset.ok = String(block !== null);
    }
    row.append(cell);
  }

  ui.log.prepend(row);
  while (ui.log.children.length > LOG_ROWS) ui.log.lastElementChild?.remove();
}

function showHead(block: CertifiedBlock, latencyMs: number | null): void {
  ui.height.textContent = String(block.block.height);
  ui.view.textContent = String(block.proof.view);
  ui.digest.textContent = toHex(block.block.digest);
  if (latencyMs !== null) ui.latency.textContent = `${latencyMs.toFixed(2)} ms`;
}

/** Verifies bytes and reports how long the verification itself took. */
function timedVerify(
  payload: Uint8Array,
  network: Network,
): { block: CertifiedBlock | null; error: VerifyError | null; elapsedMs: number } {
  const started = performance.now();
  const result = verifyFinalized(payload, network);
  const elapsedMs = performance.now() - started;

  return result.ok
    ? { block: result.decoded, error: null, elapsedMs }
    : { block: null, error: result.error, elapsedMs };
}

/** Subscribes to a live indexer. Resolves false if it does not answer. */
async function runLive(key: string, network: Network): Promise<boolean> {
  const url = INDEXERS[key];
  if (url === undefined) return false;

  const client = new AltoIndexerClient({ url, network });
  // A runtime check, not a build assumption: CORS, DNS and downtime are all
  // things the page has to survive.
  if (!(await client.health())) return false;

  setStatus('live', `live · ${new URL(url).host}`);
  ui.caption.textContent = 'Most recent certificates, streamed from the indexer';

  const head = await client.latest();
  if (head.ok) showHead(head.decoded, null);

  stop = client.subscribe({
    // The client timed its own verification of this frame, so the number on
    // screen is the real one rather than a re-run staged for the demo.
    onFinalized: (block, info) => {
      showHead(block, info.verifiedInMs);
      record('finalization', info.verifiedInMs, block);
    },
    onNotarized: (block, info) => record('notarization', info.verifiedInMs, block),
    onError: (error) => record('dropped', null, null, error.code),
    onStatus: (state) => {
      if (state === 'open') setStatus('live', `live · ${new URL(url).host}`);
      if (state === 'reconnecting') setStatus('down', 'reconnecting...');
    },
  });
  return true;
}

/** Replays the committed fixtures, verifying each one for real. */
async function runReplay(reason: string): Promise<void> {
  setStatus('replay', reason);
  ui.caption.textContent = 'Committed fixtures, verified one at a time';

  const response = await fetch(new URL('../fixtures/vectors.json', import.meta.url));
  const bundle = (await response.json()) as {
    networks: Record<string, { namespace: string; identity: string }>;
    vectors: { name: string; kind: string; payload: string; verify: string | null }[];
  };
  const devnet = networks.altoDevnet;

  // Both the genuine finalizations and the tampered ones, so the page shows
  // rejections as well as successes.
  const reel = bundle.vectors.filter((vector) => vector.kind === 'finalized');

  let cursor = 0;
  const timer = setInterval(() => {
    const vector = reel[cursor % reel.length];
    cursor += 1;
    if (vector === undefined) return;

    const { block, error, elapsedMs } = timedVerify(fromHex(vector.payload), devnet);
    if (block !== null) showHead(block, elapsedMs);
    record(vector.name.replace('finalized/', ''), elapsedMs, block, error?.code);
  }, REPLAY_INTERVAL_MS);

  stop = () => clearInterval(timer);
}

async function start(): Promise<void> {
  stop();
  accepted = 0;
  rejected = 0;
  ui.counts.textContent = '0 / 0';
  ui.log.replaceChildren();
  setStatus('idle', 'connecting...');

  const key = ui.network.value;
  const network = networks[key as keyof typeof networks];
  if (key !== 'altoDevnet' && (await runLive(key, network))) return;

  await runReplay(
    key === 'altoDevnet' ? 'fixture replay' : 'indexer unreachable · fixture replay',
  );
}

await init();
ui.network.addEventListener('change', () => void start());
await start();
