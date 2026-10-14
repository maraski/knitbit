import { describe, expect, it } from 'vitest';
import { buildChart } from './chart';
import { lineFromPoints, lineX } from './lines';
import { buildScope } from './measurements';
import { dim, newId, type ShapingLine } from './model';
import { computePanel, resolvePanelDims } from './panel';
import { loadProject, serializeProject } from './schema';
import { fromTemplate } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function line(over: Partial<ShapingLine> = {}): ShapingLine {
  return {
    id: newId('line'),
    name: 'Dart',
    from: { height: dim('hem.height + 5'), x: dim('-apex_to_apex / 2') },
    to: { height: dim('underarm.height - 3'), x: dim('-apex_to_apex / 2') },
    amount: dim(-6),
    kind: 'fisheye',
    sides: 'both',
    rowSide: 'rs',
    mirror: true,
    manual: {},
    ...over,
  };
}

function setup(direction: 'bottom-up' | 'top-down' = 'bottom-up', l: ShapingLine = line()) {
  const p = fixtureProject();
  const panel = fromTemplate('front', { direction });
  panel.bust!.method = 'none';
  panel.shapingLines = [l];
  p.panels.push(panel);
  return { p, panel };
}

describe('shaping lines', () => {
  it('fisheye: narrows to the middle and back, 2 sts per row per line, net zero, in every size', () => {
    for (const dir of ['bottom-up', 'top-down'] as const) {
      const { p, panel } = setup(dir);
      const plain = fixtureProject();
      const pp = fromTemplate('front', { direction: dir });
      pp.bust!.method = 'none';
      plain.panels.push(pp);
      for (const s of p.sizes) {
        const c = computePanel(p, panel, s.id);
        const c0 = computePanel(plain, pp, sizeId(plain, s.name));
        expect(c.issues.filter((i) => i.severity !== 'info').map((i) => i.message), `${dir} ${s.name}`).toEqual([]);
        const l = c.lines[0];
        expect(l.events.length).toBe(6); // 3 rows down, 3 rows back
        expect(l.events.every((e) => Math.abs(e.delta) === 2)).toBe(true);
        expect(l.events.reduce((a, e) => a + e.delta, 0)).toBe(0);
        // Narrower in the middle by 2 × 6 (two twins), back to the plain width at the top.
        const mid = Math.round((l.ends[0].row + l.ends[1].row) / 2);
        expect(c0.counts[mid] - c.counts[mid], `${dir} ${s.name}`).toBe(12);
        expect(c.counts[c.totalRows]).toBe(c0.counts[c0.totalRows]);
        // On the line through the bust points.
        expect(Math.abs(lineX(l, mid)) / c.stitchesPerCm).toBeCloseTo(buildScope(p, s.id).apex_to_apex / 2, 5);
      }
    }
  });

  it('one-way: keeps the change and says so', () => {
    const { p, panel } = setup('bottom-up', line({ kind: 'one-way', amount: dim(-4), mirror: false, to: { height: dim('waist.height'), x: dim('-apex_to_apex / 2') } }));
    const c = computePanel(p, panel, sizeId(p, 'M'));
    const l = c.lines[0];
    expect(l.events.map((e) => e.delta)).toEqual([-2, -2]);
    expect(c.issues.some((i) => /Changes the stitch count by -4/.test(i.message))).toBe(true);
  });

  it('one-way top-down: the garment-up change runs the other way in knit order', () => {
    const { p, panel } = setup('top-down', line({ kind: 'one-way', amount: dim(-4), to: { height: dim('waist.height'), x: dim('-apex_to_apex / 2') } }));
    const c = computePanel(p, panel, sizeId(p, 'M'));
    expect(c.lines[0].events.every((e) => e.delta === 2)).toBe(true); // increases when knitting down = narrower going up
  });

  it('slanted lines interpolate their position; one side + odd count', () => {
    const { p, panel } = setup('bottom-up', line({ kind: 'one-way', sides: 'one', amount: dim(-3), from: { height: dim('waist.height'), x: dim(-12) }, to: { height: dim('underarm.height - 5'), x: dim(-6) } }));
    const c = computePanel(p, panel, sizeId(p, 'M'));
    const l = c.lines[0];
    expect(l.events.length).toBe(3);
    expect(l.events.every((e) => e.delta === -1)).toBe(true);
    expect(lineX(l, l.ends[0].row)).toBeCloseTo(-12 * c.stitchesPerCm);
    expect(lineX(l, l.ends[1].row)).toBeCloseTo(-6 * c.stitchesPerCm);
    const xs = l.events.map((e) => lineX(l, e.row));
    expect(xs[0]).toBeLessThan(xs[2]);
  });

  it('hand-placed rows replace the auto rows for that size only', () => {
    const { p, panel } = setup();
    const M = sizeId(p, 'M');
    const c = computePanel(p, panel, M);
    const [a, b] = [c.lines[0].ends[0].row, c.lines[0].ends[1].row];
    panel.shapingLines![0].manual[M] = [a + 1, a + 3, a + 5, b - 4, b - 2, b];
    const c2 = computePanel(p, panel, M);
    expect(c2.lines[0].manual).toBe(true);
    expect(c2.lines[0].events.map((e) => e.row)).toEqual([a + 1, a + 3, a + 5, b - 4, b - 2, b]);
    expect(computePanel(p, panel, sizeId(p, 'L')).lines[0].manual).toBe(false);
  });

  it('the chart shows the stitches either side of each line and counts still match', () => {
    const { p, panel } = setup();
    const c = computePanel(p, panel, sizeId(p, 'M'));
    const chart = buildChart(p, panel, c);
    // A line row without edge shaping on it (edge decreases would add to the count).
    const edgeRows = new Set(c.segments.flatMap((sg) => [...sg.left.events, ...sg.right.events].map((e) => e.row)));
    const ev = c.lines[0].events.find((e) => !edgeRows.has(e.row))!;
    const row = chart.rows.find((r) => r.knitRow === ev.row)!;
    expect(row.cells.filter((v) => v === 'ssk' || v === 'k2tog').length).toBe(4);
    for (const r of chart.rows) expect(r.cells.filter((v) => v !== '' && v !== 'bo' && v !== 'hold').length, `row ${r.knitRow}`).toBe(c.counts[r.knitRow]);
  });

  it('a line drawn on the schematic grades: ends relative to the waypoint below and its width', () => {
    const { p, panel } = setup();
    panel.shapingLines = [];
    const M = sizeId(p, 'M');
    const scope = { ...buildScope(p, M), ...resolvePanelDims(p, panel, M).values };
    const l = lineFromPoints(panel, scope, { h: scope['waist.height'] + 2, x: -scope['waist.width'] / 4 }, { h: scope['underarm.height'] - 4, x: -scope['waist.width'] / 4 }, 'Drawn');
    expect(l.from.height.expr).toBe('waist.height + 2');
    expect(l.from.x.expr).toBe('waist.width / 2 * -0.5');
    panel.shapingLines = [l];
    for (const s of p.sizes) expect(computePanel(p, panel, s.id).lines[0].issues.filter((i) => i.severity === 'error'), s.name).toEqual([]);
  });

  it('round-trips through JSON', () => {
    const { p } = setup();
    const r = loadProject(serializeProject(p));
    expect(r.ok).toBe(true);
    if (r.ok) expect(serializeProject(r.project)).toBe(serializeProject(p));
  });
});
