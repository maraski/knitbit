// Turning raw (fractional) stitch and row counts into whole numbers.
// Every adjustment is recorded so the UI can show exactly what happened and why.

export type Parity = 'any' | 'even' | 'odd';

export interface StitchRoundingRules {
  /** Pattern multiple, e.g. 4 for a k2p2 rib. 1 = no multiple. */
  multiple?: number;
  /** The "+n" in "multiple of 4 + 2". */
  offset?: number;
  /** Parity requirement for the total count (including selvedges). */
  parity?: Parity;
  /** Total selvedge / seam stitches added on top of the pattern stitches (both sides together). */
  selvedge?: number;
}

export interface RoundingStep {
  rule: 'nearest' | 'multiple' | 'selvedge' | 'parity';
  from: number;
  to: number;
  note: string;
}

export interface RoundingResult {
  raw: number;
  value: number;
  steps: RoundingStep[];
  warnings: string[];
}

/** Round half away from zero, tolerant of float noise like 22.499999999. */
export function roundNearest(x: number): number {
  const r = Math.round(Math.abs(x) + 1e-9);
  return x < 0 ? -r : r;
}

/** Nearest value of the form k*multiple + offset (k ≥ 0). Ties go up (more room, not less). */
export function nearestOfMultiple(x: number, multiple: number, offset = 0): number {
  if (multiple <= 1) return roundNearest(x);
  const k = Math.max(0, Math.floor((x - offset) / multiple));
  const lo = k * multiple + offset;
  const hi = lo + multiple;
  if (x - lo < hi - x - 1e-9) return lo;
  return hi;
}

/**
 * Round a raw stitch count (finished width × gauge) to a usable whole number.
 * Order: nearest whole stitch → pattern multiple → add selvedges → parity.
 */
export function roundStitches(raw: number, rules: StitchRoundingRules = {}): RoundingResult {
  const multiple = Math.max(1, Math.round(rules.multiple ?? 1));
  const offset = rules.offset ?? 0;
  const selvedge = rules.selvedge ?? 0;
  const parity = rules.parity ?? 'any';
  const steps: RoundingStep[] = [];
  const warnings: string[] = [];

  let n = roundNearest(raw);
  if (Math.abs(n - raw) > 1e-9) {
    steps.push({ rule: 'nearest', from: raw, to: n, note: `Rounded ${fmt(raw)} to nearest whole stitch` });
  }

  if (multiple > 1) {
    const m = nearestOfMultiple(raw, multiple, offset);
    if (m !== n) {
      const label = offset ? `${multiple}+${offset}` : `${multiple}`;
      steps.push({ rule: 'multiple', from: n, to: m, note: `Adjusted to a multiple of ${label}` });
    }
    n = m;
  }

  if (selvedge) {
    steps.push({ rule: 'selvedge', from: n, to: n + selvedge, note: `Added ${selvedge} selvedge stitch${selvedge === 1 ? '' : 'es'}` });
    n += selvedge;
  }

  if (parity !== 'any' && !matchesParity(n, parity)) {
    if (multiple % 2 === 0) {
      warnings.push(
        `Cannot make the count ${parity}: a multiple of ${multiple}${offset ? '+' + offset : ''} plus ${selvedge} selvedge is always ${n % 2 === 0 ? 'even' : 'odd'}.`,
      );
    } else {
      // Step by one multiple, toward the raw target.
      const target = raw + selvedge;
      const up = n + multiple;
      const down = n - multiple;
      const to = down >= selvedge && target - down < up - target ? down : up;
      steps.push({ rule: 'parity', from: n, to, note: `Made the count ${parity}` });
      n = to;
    }
  }

  if (n <= 0) warnings.push(`Stitch count is ${n}.`);
  return { raw, value: n, steps, warnings };
}

/** Round a raw row count. Optionally force parity (e.g. even so the next section starts on a RS row). */
export function roundRows(raw: number, parity: Parity = 'any'): RoundingResult {
  const steps: RoundingStep[] = [];
  let n = roundNearest(raw);
  if (Math.abs(n - raw) > 1e-9) {
    steps.push({ rule: 'nearest', from: raw, to: n, note: `Rounded ${fmt(raw)} to nearest whole row` });
  }
  if (parity !== 'any' && !matchesParity(n, parity)) {
    const to = raw >= n ? n + 1 : Math.max(parity === 'odd' ? 1 : 0, n - 1);
    steps.push({ rule: 'parity', from: n, to, note: `Made the row count ${parity}` });
    n = to;
  }
  return { raw, value: n, steps, warnings: [] };
}

export function matchesParity(n: number, parity: Parity): boolean {
  if (parity === 'any') return true;
  const even = ((n % 2) + 2) % 2 === 0;
  return parity === 'even' ? even : !even;
}

function fmt(x: number): string {
  return String(Math.round(x * 100) / 100);
}
