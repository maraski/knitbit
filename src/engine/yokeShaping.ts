// What happens in one row of a yoke, for the hover and tap readouts of both yoke views (seen from above and laid
// flat): its increases by symbol and by zone, cast-ons, German short-row turns, and an off-shoulder band's special
// rounds (the increase round, a folded band's turning round and joining round). Counted from the generator's rows,
// not from drawn cells, so both views say the same.

import { ZONES, zoneName, type YokeResult, type Zone, type ZoneCounts } from './contiguous';
import type { CustomSymbol } from './model';
import { symbolInfo } from './symbols';

export interface ShapingItem {
  /** 'inc': an increase symbol; 'co': a cast-on; 'turn': a German short-row turn; 'yo'/'dec': a picot turning
   * round's yarn overs and k2togs; 'purl': a purl turning round; 'join': knit together with the cast-on loop. */
  kind: 'inc' | 'co' | 'turn' | 'yo' | 'dec' | 'purl' | 'join';
  symbol: string;
  count: number;
  byZone: ZoneCounts;
}

export interface RowShaping {
  row: number;
  items: ShapingItem[];
  /** Stitches added by increases (yarn overs of a picot round not counted: its k2togs take them back). */
  incs: number;
  incByZone: ZoneCounts;
  /** Of those, the front neck increases. */
  neckIncs: number;
  castOn: number;
  /** Where the row's cast-on is made: at centre front (joining a pullover) or at the front edges. */
  castOnWhere: 'centre-front' | 'front-edge' | null;
  turns: number;
  /** Stitches on the needle after the row less before it. */
  change: number;
  /** An off-shoulder band row: its stitch pattern (a folded band: 'stockinette') and which part of a folded band. */
  band?: { pattern: string; part?: 'facing' | 'turn' | 'outer' | 'join' };
  /** A short-row section's half row (no increases), the band's increase round. */
  notes: string[];
}

const zeros = (): ZoneCounts => ({ leftFront: 0, leftSleeve: 0, back: 0, rightSleeve: 0, rightFront: 0 });

/** The zone stitch `i` of a row (in row order, after the row) falls in. */
export function zoneAt(z: ZoneCounts, i: number): Zone {
  let o = 0;
  for (const k of ZONES) {
    o += z[k];
    if (i < o) return k;
  }
  return 'rightFront';
}

/** Shaping of row `row` (1 = the first row after the cast-on). */
export function rowShaping(y: YokeResult, row: number): RowShaping {
  const r = y.rows[row - 1];
  const out: RowShaping = { row, items: [], incs: 0, incByZone: zeros(), neckIncs: 0, castOn: 0, castOnWhere: null, turns: 0, change: 0, notes: [] };
  if (!r) return out;
  const before = row === 1 ? y.castOn : y.rows[row - 2].total;
  out.change = r.total - before;
  const item = (kind: ShapingItem['kind'], symbol: string) => {
    let it = out.items.find((x) => x.kind === kind && x.symbol === symbol);
    if (!it) out.items.push((it = { kind, symbol, count: 0, byZone: zeros() }));
    return it;
  };
  for (const inc of r.incs) {
    const it = item('inc', inc.symbol);
    it.count++;
    it.byZone[inc.zone]++;
    out.incs++;
    out.incByZone[inc.zone]++;
    if (inc.kind === 'neck') out.neckIncs++;
  }
  for (const co of r.castOns) {
    const it = item('co', 'co');
    it.count += co.count;
    it.byZone[co.zone] += co.count;
    out.castOn += co.count;
    out.castOnWhere = co.where;
  }
  if (r.turn) {
    const it = item('turn', 'turn-german');
    it.count++;
    it.byZone[zoneAt(r.zones, r.turn.at)]++;
    out.turns++;
  }
  const os = y.offShoulder;
  if (r.band && os) {
    out.band = { pattern: os.fold ? 'stockinette' : os.pattern.name, ...(r.bandPart ? { part: r.bandPart } : {}) };
    if (r.bandPart === 'turn' && os.fold) {
      if (os.fold.turn === 'purl') {
        const it = item('purl', 'purl');
        it.count = r.total;
        it.byZone = { ...r.zones };
      } else {
        // Picot: (yo, k2tog) round the band, as on the chart (an odd count ends with a yarn over).
        const yo = item('yo', 'yo');
        const dec = item('dec', 'k2tog');
        yo.count = Math.ceil(r.total / 2);
        dec.count = Math.floor(r.total / 2);
        let i = 0;
        for (const k of ZONES) {
          for (let j = 0; j < r.zones[k]; j++, i++) (i % 2 === 0 ? yo : dec).byZone[k]++;
        }
      }
    }
    if (r.bandPart === 'join') {
      const it = item('join', 'join');
      it.count = r.total;
      it.byZone = { ...r.zones };
    }
  }
  if (r.incs.some((i) => i.kind === 'band')) out.notes.push('increase round to the ring');
  if (r.plain) out.notes.push('half row, no increases');
  return out;
}

/** The readout's shaping words, e.g. "8 inc: 4 M1L, 4 M1R (left front 1, …) · 1 German short-row turn (right
 * front)". `custom`: the project's own symbols, for their abbreviations. */
export function shapingText(s: RowShaping, custom: CustomSymbol[] = []): string {
  const parts: string[] = [];
  const abbr = (id: string) => symbolInfo(id, custom).abbr || symbolInfo(id, custom).label;
  const zones = (z: ZoneCounts) =>
    ZONES.filter((k) => z[k] > 0)
      .map((k) => `${zoneName(k)} ${z[k]}`)
      .join(', ');
  const incs = s.items.filter((i) => i.kind === 'inc');
  if (incs.length) parts.push(`${s.incs} inc: ${incs.map((i) => `${i.count} ${abbr(i.symbol)}`).join(', ')} (${zones(s.incByZone)}${s.neckIncs ? `; ${s.neckIncs} at the front neck` : ''})`);
  if (s.castOn) parts.push(`cast on ${s.castOn} ${s.castOnWhere === 'centre-front' ? 'at centre front, join' : `at the front edge${ZONES.filter((k) => s.items.find((i) => i.kind === 'co')!.byZone[k]).length > 1 ? 's' : ''}`}`);
  for (const it of s.items) {
    if (it.kind === 'turn') parts.push(`${it.count} German short-row turn${it.count > 1 ? 's' : ''} (${ZONES.filter((k) => it.byZone[k]).map(zoneName).join(', ')})`);
    if (it.kind === 'purl') parts.push(`turning round: purl ${it.count}`);
    if (it.kind === 'yo') parts.push(`picot turning round: ${it.count} yo`);
    if (it.kind === 'dec') parts.push(`${it.count} k2tog`);
    if (it.kind === 'join') parts.push(`joining round: ${it.count} sts knit together with their cast-on loops`);
  }
  if (s.band && !s.band.part) parts.push(`band: ${s.band.pattern}`);
  if (s.band?.part === 'facing') parts.push('band facing (folds inside)');
  if (s.band?.part === 'outer') parts.push('band, outside');
  parts.push(...s.notes);
  return parts.length ? parts.join(' · ') : 'no shaping';
}

/** The readout for a stitch of a row in either yoke view: row, side, phase, `where` (the laid-flat view's half), the
 * stitch in its zone, the row's counts, and its shaping. */
export function stitchReadout(y: YokeResult, row: number, index: number, custom: CustomSymbol[] = [], where?: string): string {
  const r = y.rows[row - 1];
  const phase = y.phases.find((ph) => ph.id !== 'B' && ph.id !== 'neck' && row >= ph.from && row <= ph.to);
  const zone = zoneAt(r.zones, index);
  let start = 0;
  for (const k of ZONES) {
    if (k === zone) break;
    start += r.zones[k];
  }
  const counts = ZONES.map((z) => `${zoneName(z)} ${r.zones[z]}`).join(', ');
  return (
    `Row ${row} · ${r.round ? 'round' : r.rs ? 'RS' : 'WS'} · ${phase ? `${phase.id} ${phase.label}` : ''} · ${where ? `${where} · ` : ''}${zoneName(zone)} st ${index - start + 1} · ` +
    `${r.total} sts (${counts}) · ${shapingText(rowShaping(y, row), custom)}`
  );
}
