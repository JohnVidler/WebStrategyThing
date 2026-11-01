/** Payload bytes moved over player sockets since the last stats line (frame headers and compression are not counted). */
export const traffic = { in: 0, out: 0 };

/** Length in bytes of an outgoing socket payload. */
export function payloadBytes(data: string | Uint8Array): number {
  return typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength;
}
