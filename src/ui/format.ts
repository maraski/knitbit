import { formatLength, type Units } from '../engine/units';

export const len = (cm: number, units: Units) => formatLength(cm, units);
export const sts = (n: number) => `${fmtNum(n)} st${Math.abs(n) === 1 ? '' : 's'}`;
export const rows = (n: number) => `${n} row${n === 1 ? '' : 's'}`;
export const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
}
