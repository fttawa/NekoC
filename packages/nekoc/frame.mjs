export function decodeFrame(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) throw new Error("Invalid player frame");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(0, true);
  if (size > bytes.byteLength - 4 || size % 4) throw new Error("Invalid frame metadata length");
  return JSON.parse(new TextDecoder().decode(bytes.subarray(4, size + 4)));
}
