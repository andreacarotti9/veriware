/**
 * Hex conveniences. Nothing in the package requires them - every entry point
 * takes and returns `Uint8Array`.
 *
 * @packageDocumentation
 */

/**
 * Renders bytes as lowercase hex, without a `0x` prefix.
 *
 * @example
 * ```ts
 * toHex(result.decoded.block.digest); // "9f86d081..."
 * ```
 */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Parses hex into bytes. A leading `0x` is accepted.
 *
 * @throws TypeError if the input is not an even-length run of hex digits. This
 * helper is for constants and configuration; payloads from a network go
 * straight to a verify function, which returns a typed error instead.
 */
export function fromHex(hex: string): Uint8Array {
  const digits = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (digits.length % 2 !== 0) {
    throw new TypeError(`hex must have an even number of digits, got ${digits.length}`);
  }

  const bytes = new Uint8Array(digits.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = digits.slice(index * 2, index * 2 + 2);
    if (!/^[0-9a-fA-F]{2}$/.test(pair)) {
      throw new TypeError(`"${pair}" is not a hex byte`);
    }
    bytes[index] = Number.parseInt(pair, 16);
  }
  return bytes;
}
