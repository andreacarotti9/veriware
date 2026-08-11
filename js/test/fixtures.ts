/**
 * Loads `fixtures/vectors.json` - the same file the Rust suite asserts against.
 *
 * The fixtures are the contract between the two implementations. If they ever
 * disagree, that is a bug in one of them and this is where it surfaces.
 */

import { readFile } from 'node:fs/promises';
import { defineNetwork, fromHex, type Network } from '../src/index.js';

export interface Vector {
  name: string;
  kind: 'seed' | 'notarization' | 'finalization' | 'notarized' | 'finalized' | 'block';
  network: string;
  payload: string;
  /** Expected `verify_*` result: `"ok"`, an error code, or null where verifying makes no sense. */
  verify: string | null;
  /** Expected `decode*` result: `"ok"` or an error code. */
  decode: string;
  about: string;
}

export interface Frame {
  name: string;
  network: string;
  frame: string;
  kind: 'seed' | 'notarization' | 'finalization' | null;
  expect: string;
  about: string;
}

export interface Bundle {
  maxPayloadLen: number;
  networks: Record<string, { namespace: string; identity: string }>;
  vectors: Vector[];
  frames: Frame[];
}

const url = new URL('../../fixtures/vectors.json', import.meta.url);

export const bundle: Bundle = JSON.parse(await readFile(url, 'utf8')) as Bundle;

/** The fixture networks, keyed as the vectors name them. */
export const fixtureNetworks: Record<string, Network> = Object.fromEntries(
  Object.entries(bundle.networks).map(([name, spec]) => [
    name,
    defineNetwork({ name, namespace: fromHex(spec.namespace), identity: fromHex(spec.identity) }),
  ]),
);

export function networkFor(name: string): Network {
  const network = fixtureNetworks[name];
  if (network === undefined) {
    throw new Error(`fixtures name an unknown network: ${name}`);
  }
  return network;
}

/** A vector by name, for tests that want one specific payload. */
export function vector(name: string): Vector {
  const found = bundle.vectors.find((candidate) => candidate.name === name);
  if (found === undefined) {
    throw new Error(`no fixture named ${name}`);
  }
  return found;
}
