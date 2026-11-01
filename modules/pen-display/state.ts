/// <reference path="../../ts/nekoc.d.ts" />
import { pdByte } from "./math";

// NekoC expression handles are numbers when evaluated by Kitten N.
export function pdState(name: string): number { return getVar(name) as number; }
export function pdItem(name: string, index: number): number { return listItem(name, "any", index) as number; }
export function pdFloor(value: number): number { return floor(value) as number; }
export function pdNow(): number { return timerValue() as number; }
export function pdMin(minA: number, minB: number): number { return (minA + minB - mathFunc("abs", minA - minB)) / 2; }
export function pdMax(maxA: number, maxB: number): number { return (maxA + maxB + mathFunc("abs", maxA - maxB)) / 2; }

export function rgb(red: number, green: number, blue: number): number {
  return pdByte(red) * 65536 + pdByte(green) * 256 + pdByte(blue);
}
