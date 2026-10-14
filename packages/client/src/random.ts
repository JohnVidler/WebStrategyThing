/** Generates a hex ID, using secure browser randomness when available. */
export function randomHex(byteLength = 16): string {
  const bytes = new Uint8Array(byteLength);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}