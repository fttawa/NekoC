/// <reference path="../../ts/nekoc.d.ts" />

export function pdByte(channel: number): number {
  // Clamp without ternary reporter blocks, which Kitten N does not expose.
  const upper = (floor(channel) + 255 - mathFunc("abs", floor(channel) - 255)) / 2;
  return (upper + mathFunc("abs", upper)) / 2;
}
