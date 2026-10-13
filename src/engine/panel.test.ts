import { describe, expect, it } from 'vitest';
import { defaultAutoMethod, dim, newPanel, newSegment, newWaypoint, type Project } from './model';
import { computePanel, waypointKey } from './panel';
import { backBodice } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

function project(): Project {
  const p = fixtureProject();
  p.panels = [backBodice()];
  return p;
}

describe('waypointKey', () => {
  it('makes identifiers', () => {
    expect(waypointKey('Under arm')).toBe('under_arm');
    expect(waypointKey('2nd')).toBe('wp_2nd');
  });
});

describe('simple panels', () => {
  const base = (): Project => {
    const p = fixtureProject();
    p.gauge = { stitches: 20, rows: 30, basis: '10cm' }; // 2 sts/cm, 3 rows/cm
    return p;
  };

  it('a straight rectangle', () => {
    const p = base();
    const panel = newPanel('R');
    panel.selvedge = { left: 0, right: 0 };
    panel.waypoints = [newWaypoint('bottom', 0, 30), newWaypoint('top', 20, 30)];
    const c = computePanel(p, panel, p.baseSizeId);
    expect(c.ok).toBe(true);
    expect(c.waypoints.map((w) => [w.row, w.stitches])).toEqual([[0, 60], [60, 60]]);
    expect(c.counts.every((n) => n === 60)).toBe(true);
    expect(c.outline).toEqual([{ x: -30, y: 0 }, { x: -30, y: 60 }, { x: 30, y: 60 }, { x: 30, y: 0 }]);
  });

  it('derives paired decreases between waypoints and reaches the target', () => {
    const p = base();
    const panel = newPanel('T');
    panel.selvedge = { left: 1, right: 1 };
    panel.waypoints = [newWaypoint('hem', 0, 50), newWaypoint('waist', 15, 44)];
    const c = computePanel(p, panel, p.baseSizeId);
    // 100+2 → 88+2 sts: −6 each side over 45 rows on RS rows, last one on the waist row's RS row.
    expect(c.waypoints[0].stitches).toBe(102);
    expect(c.waypoints[1].stitches).toBe(90);
    const seg = c.segments[0];
    expect(seg.implicit).toBe(true);
    expect(seg.left.events.map((e) => e.row)).toEqual(seg.right.events.map((e) => e.row));
    expect(seg.left.events).toHaveLength(6);
    expect(seg.left.events.every((e) => e.row % 2 === 1 && e.delta === -1 && e.kind === 'dec')).toBe(true);
    expect(c.counts[c.totalRows]).toBe(90);
    expect(c.issues.filter((i) => i.severity !== 'info')).toEqual([]);
  });

  it('warns on odd stitch changes and keeps the panel centred', () => {
    const p = base();
    const panel = newPanel('T');
    panel.selvedge = { left: 0, right: 0 };
    panel.waypoints = [newWaypoint('a', 0, 50), newWaypoint('b', 10, 48.5)]; // 100 → 97
    const c = computePanel(p, panel, p.baseSizeId);
    expect(c.segments[0].left.events.length + c.segments[0].right.events.length).toBe(3);
    expect(c.counts[c.totalRows]).toBe(97);
    expect(Math.abs(c.leftEdge[c.totalRows] + c.rightEdge[c.totalRows])).toBeLessThanOrEqual(1);
    expect(c.issues.some((i) => /odd stitch change/.test(i.message))).toBe(true);
  });

  it('flags shaping that does not fit', () => {
    const p = base();
    const panel = newPanel('T');
    panel.waypoints = [newWaypoint('a', 0, 50), newWaypoint('b', 2, 30)]; // −20 each side in 6 rows
    const c = computePanel(p, panel, p.baseSizeId);
    expect(c.issues.some((i) => i.severity === 'error' && /only 3 RS rows/.test(i.message))).toBe(true);
    expect(c.issues.some((i) => /reaches .* but the target/.test(i.message))).toBe(true);
  });

  it('places bind-off steps at the start of rows: right edge on RS, left edge on WS', () => {
    const p = base();
    const panel = newPanel('T');
    panel.selvedge = { left: 0, right: 0 };
    panel.waypoints = [newWaypoint('a', 0, 50), newWaypoint('b', 10, 50), newWaypoint('c', 12, 40)];
    panel.segments = [newSegment(panel.waypoints[0].id, { kind: 'straight' }), newSegment(panel.waypoints[1].id, { kind: 'steps', steps: null, maxPerStep: 4 })];
    const c = computePanel(p, panel, p.baseSizeId);
    const seg = c.segments[1];
    expect(seg.left.events.map((e) => e.delta)).toEqual([-4, -3, -3]);
    expect(seg.right.events.every((e) => e.row % 2 === 1)).toBe(true);
    expect(seg.left.events.every((e) => e.row % 2 === 0)).toBe(true);
    expect(seg.right.events[0].row).toBe(31);
    expect(seg.left.events[0].row).toBe(32);
    expect(c.counts[c.totalRows]).toBe(80);
  });

  it('lets waypoints refer to each other', () => {
    const p = base();
    const panel = newPanel('T');
    panel.waypoints = [newWaypoint('a', 0, 40), newWaypoint('b', 'a.height + 10', 'a.width - 4')];
    const c = computePanel(p, panel, p.baseSizeId);
    expect(c.waypoints[1].heightCm).toBe(10);
    expect(c.waypoints[1].widthCm).toBe(36);
  });

  it('reports expression errors and does not draw', () => {
    const p = base();
    const panel = newPanel('T');
    panel.waypoints = [newWaypoint('a', 0, 'nope'), newWaypoint('b', 10, 40)];
    const c = computePanel(p, panel, p.baseSizeId);
    expect(c.ok).toBe(false);
    expect(c.issues[0].message).toMatch(/Unknown name "nope"/);
  });

  it('uses per-size overrides', () => {
    const p = base();
    const panel = newPanel('T');
    panel.selvedge = { left: 0, right: 0 };
    panel.waypoints = [newWaypoint('a', 0, 40), newWaypoint('b', 10, 40)];
    panel.waypoints[1].width = dim(40, { [p.baseSizeId]: 45 });
    const c = computePanel(p, panel, p.baseSizeId);
    expect(c.waypoints[1].stitches).toBe(90);
    expect(c.waypoints[1].overridden.width).toBe(true);
  });

  it('supports asymmetric waypoints and unmirrored shaping', () => {
    const p = base();
    const panel = newPanel('T');
    panel.selvedge = { left: 0, right: 0 };
    const b = newWaypoint('b', 10, 40);
    b.symmetric = false;
    b.left = dim(20);
    b.right = dim(15);
    panel.waypoints = [newWaypoint('a', 0, 40), b];
    panel.segments = [{ ...newSegment(panel.waypoints[0].id), mirror: false, right: defaultAutoMethod() }];
    const c = computePanel(p, panel, p.baseSizeId);
    expect(c.segments[0].left.events).toHaveLength(0);
    expect(c.segments[0].right.events).toHaveLength(10);
    expect(c.rightEdge[c.totalRows]).toBe(30);
    expect(c.leftEdge[c.totalRows]).toBe(-40);
  });

  it('applies manual markers and warns when totals do not match', () => {
    const p = base();
    const panel = newPanel('T');
    panel.selvedge = { left: 0, right: 0 };
    panel.waypoints = [newWaypoint('a', 0, 40), newWaypoint('b', 10, 39)];
    panel.segments = [{ ...newSegment(panel.waypoints[0].id), manual: { [p.baseSizeId]: { left: [{ row: 5, delta: -1, symbol: 'ssk' }, { row: 11, delta: -1, symbol: 'ssk' }] } } }];
    const c = computePanel(p, panel, p.baseSizeId);
    expect(c.segments[0].left.method).toBe('manual');
    expect(c.segments[0].left.events.map((e) => e.row)).toEqual([5, 11]);
    expect(c.segments[0].right.events.map((e) => e.row)).toEqual([5, 11]); // mirrored
    expect(c.issues.some((i) => /manual markers change this edge by -2 sts; -1 are needed/.test(i.message))).toBe(true);
  });
});

describe('back bodice template', () => {
  it('computes cleanly in every size of the sample table', () => {
    const p = project();
    for (const s of p.sizes) {
      const c = computePanel(p, p.panels[0], s.id);
      expect(c.ok, s.name).toBe(true);
      const bad = c.issues.filter((i) => i.severity === 'error');
      expect(bad, `${s.name}: ${bad.map((b) => b.message).join('; ')}`).toEqual([]);
      for (const w of c.waypoints) expect(w.actualStitches, `${s.name} ${w.name}`).toBe(w.stitches);
    }
  });

  it('has sensible numbers in size M', () => {
    const p = project();
    const c = computePanel(p, p.panels[0], sizeId(p, 'M'));
    const byName = Object.fromEntries(c.waypoints.map((w) => [w.name, w]));
    // 22 sts / 10 cm, 30 rows / 10 cm, 1+1 selvedge
    expect(byName.underarm.widthCm).toBeCloseTo(59.75, 5);
    expect(byName.underarm.stitches).toBe(134); // 131.45 → 131, +2 selvedge = 133, made even → 134
    expect(byName.waist.row).toBe(45);
    expect(c.neck).not.toBeNull();
    expect(c.neck!.splitRow % 2).toBe(1);
    expect(c.counts[c.totalRows]).toBeLessThanOrEqual(1); // shoulders and neck bound off (an odd top leaves 1)
    // Outline is a closed polygon without self-repeats.
    for (let i = 1; i < c.outline.length; i++) {
      expect(c.outline[i]).not.toEqual(c.outline[i - 1]);
    }
  });
});

describe('top-down panels', () => {
  const both = (sizeName: string) => {
    const p = project();
    const up = computePanel(p, p.panels[0], sizeId(p, sizeName));
    const down = computePanel(p, { ...p.panels[0], direction: 'top-down' }, sizeId(p, sizeName));
    return { up, down };
  };

  it('keeps the shape and reverses the row numbering', () => {
    for (const name of ['3XS', 'M', '4X']) {
      const { up, down } = both(name);
      expect(down.ok).toBe(true);
      expect(down.topDown).toBe(true);
      expect(down.totalRows).toBe(up.totalRows);
      expect(down.waypoints.map((w) => w.name)).toEqual([...up.waypoints].reverse().map((w) => w.name));
      for (const w of down.waypoints) {
        const u = up.waypoints.find((x) => x.id === w.id)!;
        expect(w.row, `${name} ${w.name}`).toBe(up.totalRows - u.row);
        expect(w.actualStitches, `${name} ${w.name}`).toBe(w.stitches);
      }
      expect(down.counts[down.totalRows]).toBe(up.counts[0]); // hem
      expect(down.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('turns decreases into increases and bind-offs into cast-ons, keeping segment identity', () => {
    const { up, down } = both('M');
    const hemUp = up.segments.find((s) => s.fromWaypoint === up.waypoints[0].id)!;
    const hemDown = down.segments.find((s) => s.fromWaypoint === hemUp.fromWaypoint)!;
    expect(hemUp.left.events.every((e) => e.kind === 'dec')).toBe(true);
    expect(hemDown.left.events.every((e) => e.kind === 'inc')).toBe(true);
    expect(hemDown.left.events).toHaveLength(hemUp.left.events.length);
    const armUp = up.segments.find((s) => s.left.method === 'steps' && s.left.events[0].kind === 'bindoff')!;
    const armDown = down.segments.find((s) => s.fromWaypoint === armUp.fromWaypoint)!;
    expect(armDown.left.events.every((e) => e.kind === 'caston')).toBe(true);
    // Bottom-up the armhole bind-off is at the start of its segment; top-down the cast-on is at the end.
    expect(armUp.left.events[0].row - armUp.rowFrom).toBeLessThan(2);
    expect(armDown.rowTo - armDown.left.events[armDown.left.events.length - 1].row).toBeLessThan(2);
  });

  it('puts the neck at the cast-on and casts on the centre to join', () => {
    const { down } = both('M');
    expect(down.neck!.atStart).toBe(true);
    expect(down.neck!.openRow).toBe(0);
    expect(down.neck!.splitRow % 2).toBe(1);
    expect(down.neck!.events.every((e) => e.kind === 'inc' && e.row < down.neck!.splitRow)).toBe(true);
    expect(down.neckLeft[down.neck!.splitRow]).toBeNull();
    expect(down.neckLeft[0]).not.toBeNull();
  });
});
