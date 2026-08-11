// Follow alto's finalized head, verifying every certificate locally.
//
//   node follow-head.mjs

import { AltoIndexerClient, init, networks, toHex } from 'veriware';

await init();

const client = new AltoIndexerClient({
  url: 'https://global.alto.exoware.xyz',
  network: networks.alto,
});

const head = await client.latest();
console.log(head.ok ? `head is height ${head.decoded.block.height}` : `unavailable: ${head.error.code}`);

const stop = client.subscribe({
  onFinalized: (block, info) => {
    console.log(
      `height ${block.block.height}  view ${block.proof.view}  ` +
        `${toHex(block.block.digest).slice(0, 16)}...  verified in ${info.verifiedInMs.toFixed(1)}ms`,
    );
  },
  // Anything that fails verification lands here and is never surfaced above.
  onError: (error) => console.warn('dropped a frame:', error.code),
});

process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
