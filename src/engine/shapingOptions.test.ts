import { describe, expect, it } from 'vitest';
import { buildChart } from './chart';
import { addMarker, shapingPoints } from './manual';
import { buildScope } from './measurements';
import type { Project } from './model';
import { computePanel } from './panel';
import { loadProject, serializeProject } from './schema';
import { fromTemplate } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function front(direction: 'bottom-up' | 'top-down', edit?: (p: ReturnType<typeof fromTemplate>) => void) {
  const p = fixtureProject();
  const panel = fromTemplate('front', { direction });
  edit?.(panel);
  p.panels.push(panel);
  return { p, panel };
}

const apexToSide = (direction: 'bottom-up' | 'top-down') =>
  front(direction, (pn) => {
    pn.bust!.shortRows.span = 'apex-to-side';
    pn.bust!.shortRows.start = 'apex';
    pn.bust!.shortRows.order = direction === 'top-down' ? 'lengthening' : 'shortening';
  });

describe('bust short rows from the bust point to the side seam', () => {
  it('top-down: first turn at the bust point, then evenly every `step` sts outwards, starting on the bust-point row', () => {
    const { p, panel } = apexToSide('top-down');
    for (const s of p.sizes) {
      const c = computePanel(p, panel, s.id);
      const b = c.bust!;
      const sr = b.shortRows!;
      expect(c.issues.filter((i) => i.severity === 'error'), s.name).toEqual([]);
      expect(sr.span).toBe('apex-to-side');
      expect(sr.step).toBeGreaterThanOrEqual(1);
      // Starts right at the bust point (or one row on, to begin with a RS row).
      expect(sr.afterRow - b.apex.row, s.name).toBeGreaterThanOrEqual(-1);
      expect(sr.afterRow - b.apex.row, s.name).toBeLessThanOrEqual(0);
      const centre = (c.leftEdge[sr.afterRow] + c.rightEdge[sr.afterRow]) / 2;
      // First pair turns at the bust point; each later pair `step` sts further out.
      const dist = sr.pairs.map((pr) => centre - pr.leftX);
      expect(Math.abs(dist[0] - b.apex.offsetCm * c.stitchesPerCm), s.name).toBeLessThanOrEqual(1);
      for (let k = 1; k < dist.length; k++) expect(Math.round(dist[k] - dist[k - 1]), s.name).toBe(sr.step);
      // The last turn stays inside the side edge.
      expect(sr.pairs[sr.pairs.length - 1].leftUnworked).toBeGreaterThanOrEqual(2);
    }
  });

  it('bottom-up mirror: starts near the side seam and finishes at the bust point, just below it', () => {
    const { p, panel } = apexToSide('bottom-up');
    const c = computePanel(p, panel, sizeId(p, 'M'));
    const b = c.bust!;
    const sr = b.shortRows!;
    expect(b.apex.row - sr.afterRow).toBeGreaterThanOrEqual(1);
    expect(b.apex.row - sr.afterRow).toBeLessThanOrEqual(2);
    const u = sr.pairs.map((pr) => pr.leftUnworked);
    expect(u[0]).toBeLessThan(u[u.length - 1]); // first short row is the longest (turns near the side)
    const centre = (c.leftEdge[sr.afterRow] + c.rightEdge[sr.afterRow]) / 2;
    expect(Math.abs(centre - sr.pairs[sr.pairs.length - 1].leftX - b.apex.offsetCm * c.stitchesPerCm)).toBeLessThanOrEqual(1);
  });

  it('reports when the turns do not fit between the bust point and the side', () => {
    const { p, panel } = apexToSide('top-down');
    panel.bust!.shortRows.pairs = 200;
    const c = computePanel(p, panel, sizeId(p, 'M'));
    expect(c.issues.some((i) => i.severity === 'error' && /don't fit between the bust point and the side seam/.test(i.message))).toBe(true);
  });

  it('the chart inserts the short rows right after the bust-point row', () => {
    const { p, panel } = apexToSide('top-down');
    const c = computePanel(p, panel, sizeId(p, 'M'));
    const chart = buildChart(p, panel, c);
    const i = chart.rows.findIndex((r) => r.label === 'SR1');
    expect(chart.rows[i - 1].knitRow).toBe(c.bust!.shortRows!.afterRow);
  });
});

// ---------- princess lines ----------

function withPrincess(placement: 'princess' | 'both', sides: 'both' | 'one' = 'both'): { p: Project; panel: ReturnType<typeof fromTemplate> } {
  return front('bottom-up', (pn) => {
    pn.bust!.method = 'none';
    const hem = pn.waypoints.find((w) => w.name === 'hem')!;
    const waist = pn.waypoints.find((w) => w.name === 'waist')!;
    for (const id of [hem.id, waist.id]) {
      let seg = pn.segments.find((s) => s.fromWaypoint === id);
      if (!seg) {
        seg = { fromWaypoint: id, left: { kind: 'auto', side: 'rs', align: 'end', order: 'spread', rhythm: { type: 'auto' }, perSide: 1 }, right: { kind: 'auto', side: 'rs', align: 'end', order: 'spread', rhythm: { type: 'auto' }, perSide: 1 }, mirror: true, manual: {} };
        pn.segments.push(seg);
      }
      seg.placement = placement;
    }
    pn.princess = { position: { expr: 'apex_to_apex / 2', overrides: {} }, sides };
  });
}

describe('princess-seam shaping', () => {
  it('moves waist shaping to the lines through the bust points, 2 sts per line per row, same stitch counts', () => {
    const { p, panel } = withPrincess('princess');
    const edgeOnly = front('bottom-up', (pn) => void (pn.bust!.method = 'none'));
    for (const s of p.sizes) {
      const c = computePanel(p, panel, s.id);
      const e = computePanel(edgeOnly.p, edgeOnly.panel, sizeId(edgeOnly.p, s.name));
      expect(c.issues.filter((i) => i.severity !== 'info').map((i) => i.message), s.name).toEqual([]);
      expect(c.princess!.offset).toBeCloseTo((c.stitchesPerCm * buildScope(p, s.id).apex_to_apex) / 2, 5);
      const seg = c.segments.find((x) => x.placement === 'princess' && x.left.events.length)!;
      // Every event takes 2 sts at the line except possibly an odd one.
      expect(seg.left.events.filter((ev) => Math.abs(ev.delta) === 2).length).toBeGreaterThanOrEqual(seg.left.events.length - 1);
      // Same stitch counts at the waypoints as edge shaping, in about half the shaping rows.
      for (const w of c.waypoints) expect(w.actualStitches).toBe(e.waypoints.find((x) => x.name === w.name)!.actualStitches);
      const eSeg = e.segments[seg.index];
      expect(seg.left.events.length).toBe(Math.ceil(eSeg.left.events.length / 2));
      // Markers sit on the lines, not the edges.
      for (const m of c.markers.filter((m) => m.segment === seg.index)) {
        const centre = (c.leftEdge[m.row] + c.rightEdge[m.row]) / 2;
        expect(Math.abs(m.x - centre)).toBeCloseTo(c.princess!.offset, 5);
      }
    }
  });

  it('an odd stitch is worked on one side of the marker, with a note', () => {
    const { p, panel } = withPrincess('princess');
    let found = false;
    for (const s of p.sizes) {
      const c = computePanel(p, panel, s.id);
      const odd = c.segments.some((seg) => seg.placement === 'princess' && seg.left.events.some((ev) => Math.abs(ev.delta) === 1));
      if (odd) {
        found = true;
        expect(c.issues.some((i) => /one side of the marker/.test(i.message)), s.name).toBe(true);
      }
    }
    expect(found).toBe(true);
  });

  it("'both' adds the edge: 3 sts per half per row", () => {
    const { p, panel } = withPrincess('both');
    const c = computePanel(p, panel, sizeId(p, 'M'));
    const seg = c.segments.find((x) => x.placement === 'both' && x.left.events.length)!;
    expect(Math.max(...seg.left.events.map((e) => Math.abs(e.delta)))).toBe(3);
  });

  it('the chart puts the symbols either side of each line and keeps the edge plain', () => {
    const { p, panel } = withPrincess('princess');
    const c = computePanel(p, panel, sizeId(p, 'M'));
    const chart = buildChart(p, panel, c);
    const seg = c.segments.find((x) => x.placement === 'princess' && x.left.events.some((e) => Math.abs(e.delta) === 2))!;
    const ev = seg.left.events.find((e) => Math.abs(e.delta) === 2)!;
    const row = chart.rows.find((r) => r.knitRow === ev.row && !r.shortRow)!;
    const symbols = row.cells.map((v, k) => [v, k] as const).filter(([v]) => v !== '' && v !== 'k');
    expect(symbols.length).toBe(4); // 2 per line
    const first = row.cells.findIndex((v) => v !== '');
    const last = row.cells.length - 1 - [...row.cells].reverse().findIndex((v) => v !== '');
    for (const [, k] of symbols) expect(k - first > panel.shapingInset + 1 && last - k > panel.shapingInset + 1).toBe(true);
    const pair = symbols.slice(0, 2).map(([v]) => v);
    expect(pair).toEqual(ev.delta < 0 ? ['ssk', 'k2tog'] : ['m1l', 'm1r']);
    expect(row.cells.filter((v) => v !== '').length).toBe(c.counts[ev.row]);
  });

  it('a hand-placed marker on a princess segment counts both sides of the marker', () => {
    const { p, panel } = withPrincess('princess');
    const waist = panel.waypoints.find((w) => w.name === 'waist')!;
    const ref = { panelId: panel.id, fromWaypoint: waist.id, sizeId: sizeId(p, 'M'), edge: 'left' as const };
    expect(shapingPoints(p, ref)).toBe(2);
    const q = addMarker(p, ref, 3, 'k2tog');
    const list = q.panels.find((x) => x.id === panel.id)!.segments.find((s) => s.fromWaypoint === waist.id)!.manual[ref.sizeId]!.left!;
    expect(list.find((e) => e.row === 3)!.delta).toBe(-2);
  });

  it('round-trips through JSON', () => {
    const { p } = withPrincess('both', 'one');
    p.panels[p.panels.length - 1].bust = { ...p.panels[p.panels.length - 1].bust!, shortRows: { ...p.panels[p.panels.length - 1].bust!.shortRows, span: 'apex-to-side', start: 'apex' } };
    const r = loadProject(serializeProject(p));
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeProject(r.project)).toBe(serializeProject(p));
  });
});
