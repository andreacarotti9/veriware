// A React hook, for copying into your app.
//
// The package itself has no React dependency and never will; this is twenty
// lines you own, not an integration you have to wait on.

import { AltoIndexerClient, init, networks, type CertifiedBlock, type Network } from 'veriware';
import { useEffect, useState } from 'react';

export function useFinalizedHead(
  url = 'https://global.alto.exoware.xyz',
  network: Network = networks.alto,
): CertifiedBlock | null {
  const [head, setHead] = useState<CertifiedBlock | null>(null);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;

    void init().then(() => {
      if (cancelled) return;
      const client = new AltoIndexerClient({ url, network });
      void client.latest().then((result) => {
        if (!cancelled && result.ok) setHead(result.decoded);
      });
      // Only verified finalizations reach setHead.
      stop = client.subscribe(setHead);
    });

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [url, network]);

  return head;
}
