import { describe, expect, it } from 'vitest';
import { defaultEdges } from '../engine/edgeTreatments';
import { buildGarment, type GarmentSpec } from '../engine/garmentSetup';
import { fixtureProject, sizeId } from '../engine/testFixtures';
import { namePart, pdfFileName, pngFileName } from './fileName';
import { planExport, readySections } from './plan';
import { bodyTable, DASH, exportDate, finishedTable, headerInfo, pieceEntries, piecesTable } from './tables';
import { helveticaText, splitArrows, unprintable } from './text';

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const garment = (s: Partial<GarmentSpec> = {}) => buildGarment(base(), { method: 'seamed', opening: 'closed', neckline: 'round', sleeve: 'set-in', ease: 'standard', edges: defaultEdges(), ...s });

describe('file names', () => {
  it('one size, several sizes, PNG', () => {
    expect(pdfFileName('Raglan cardigan', ['M'])).toBe('Raglan cardigan-M.pdf');
    expect(pdfFileName('Raglan cardigan', ['M', 'L', 'XL'])).toBe('Raglan cardigan-3-sizes.pdf');
    expect(pngFileName('Top', 'chart', '2X')).toBe('Top-chart-2X.png');
  });
  it('characters not allowed in file names become "-"', () => {
    expect(namePart('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j');
    expect(pdfFileName('  ', ['M'])).toBe('project-M.pdf');
    expect(pdfFileName('Top: v2 / final', ['S/M'])).toBe('Top- v2 - final-S-M.pdf');
  });
});

describe('Helvetica text', () => {
  it('swaps the minus sign and ≈; keeps WinAnsi characters', () => {
    expect(helveticaText('−5 ≈ 3')).toBe('-5 ~ 3');
    expect(unprintable('Pull à côtes · 22 × 30 – ½ … “ok”')).toEqual([]);
  });
  it('lists what still won’t print, once each (arrows are drawn)', () => {
    expect(unprintable('Свитер → свитер ☃')).toEqual(['С', 'в', 'и', 'т', 'е', 'р', 'с', '☃']);
    expect(unprintable('row 1 → row 2')).toEqual([]);
  });
  it('splits arrows out of the text', () => {
    expect(splitArrows('a → b ↑')).toEqual([{ text: 'a ' }, { arrow: '→' }, { text: ' b ' }, { arrow: '↑' }]);
  });
});

describe('plan', () => {
  it('header first, then the size tables once; per-size sections only when built', () => {
    const p = garment();
    const parts = planExport(p, { sizeIds: [sizeId(p, 'L'), sizeId(p, 'M')], paper: 'a4', sections: readySections() });
    expect(parts.map((x) => x.section)).toEqual(['header', 'body', 'finished', 'pieces', 'charts', 'charts']);
    expect(parts.slice(4).map((x) => x.sizeId)).toEqual([sizeId(p, 'M'), sizeId(p, 'L')]);
    expect(parts[0].newPage).toBe(true);
    // The tables flow on; the charts start their own pages (portrait or landscape).
    expect(parts.slice(1).every((x) => !x.newPage)).toBe(true);
    expect(planExport(p, { sizeIds: [], paper: 'a4', sections: ['finished', 'charts'] }).map((x) => x.section)).toEqual(['header', 'finished']);
  });
});

describe('tables', () => {
  it('header facts', () => {
    const p = garment();
    const h = headerInfo(p, [sizeId(p, 'L'), sizeId(p, 'M')], new Date(2026, 9, 25));
    expect(h.title).toBe(p.name);
    expect(h.lines[0]).toBe(`Gauge ${p.gauge.stitches} sts × ${p.gauge.rows} rows = 10 cm`);
    expect(h.lines[1]).toBe('Units cm · Sizes M, L · Exported 25 Oct 2026');
    expect(h.lines[2]).toBe('Construction: Seamed panels · pullover');
    expect(exportDate(new Date(2026, 0, 3))).toBe('3 Jan 2026');
  });

  it('body measurements: ticked sizes in order, base size marked', () => {
    const p = garment();
    const t = bodyTable(p, [sizeId(p, 'L'), p.baseSizeId]);
    const base = p.sizes.find((s) => s.id === p.baseSizeId)!.name;
    expect(t.columns.map((c) => c.label)).toContain(`${base}*`);
    expect(t.note).toBe('* base size');
    const m = p.measurements.find((x) => x.name === 'upper_chest')!;
    const row = t.rows.find((r) => r.cells[0] === m.label)!;
    expect(row.cells.slice(1)).toEqual([sizeId(p, 'M'), sizeId(p, 'L')].map((id) => String(m.table[id])));
  });

  it('finished measurements: ease signed with a minus sign, "—" for what can’t be found', () => {
    const p = garment({ method: 'contiguous', sleeve: 'contiguous' });
    const t = finishedTable(p, [sizeId(p, 'M')]);
    const ease = t.rows.find((r) => r.cells[0] === 'Ease at bust')!;
    expect(ease.cells[1]).toMatch(/^[+−]\d|^0$/);
    expect(t.rows.map((r) => r.cells[0])).toContain('Yoke depth');
    const broken = structuredClone(p);
    broken.panels.find((x) => x.fromYoke === 'leftSleeve')!.waypoints[0].width.expr = 'nonsense_name';
    // Left sleeve is the first sleeve: can't be computed, so the sleeve rows show "—".
    const tb = finishedTable(broken, [sizeId(p, 'M')]);
    expect(tb.rows.find((r) => r.cells[0] === 'Upper arm')!.cells[1]).toBe(DASH);
  });

  it('key numbers: a pair of fronts once, a seamed sleeve ×2, a row per size', () => {
    const p = garment({ opening: 'cardigan' });
    const labels = pieceEntries(p).map((e) => e.label);
    expect(labels).toContain('Left front / Right front (mirrored)');
    expect(labels).toContain('Sleeve ×2');
    const sizes = [sizeId(p, 'S'), sizeId(p, 'M')];
    const t = piecesTable(p, sizes);
    expect(t.rows.length).toBe(labels.length * 2);
    const back = t.rows.findIndex((r) => r.cells[0] === 'Back');
    expect(t.rows[back].groupStart).toBe(true);
    expect(t.rows[back + 1].cells[0]).toBe('');
    expect(Number(t.rows[back].cells[2])).toBeGreaterThan(50);
  });

  it('key numbers: top-down fronts are picked up, a yoke shows its cast-on', () => {
    const td = garment({ method: 'top-down' });
    const front = piecesTable(td, [sizeId(td, 'M')]).rows.find((r) => r.cells[0] === 'Front')!;
    expect(front.cells[2]).toMatch(/^pick up \d+$/);
    const c = garment({ method: 'contiguous', sleeve: 'contiguous' });
    const yoke = piecesTable(c, [sizeId(c, 'M')]).rows.find((r) => r.cells[0] === 'Yoke')!;
    expect(Number(yoke.cells[2])).toBeGreaterThan(20);
  });
});
