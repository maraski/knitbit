import { describe, expect, it } from 'vitest';
import { buildScope } from './measurements';
import { computePanel, rowInPanel } from './panel';
import { clearRectOverrides, convertRule, heightBase, isRectangle, readRule, rectWaypoints, ruleExpr, setRectDim, type SizeRule } from './rectSize';
import { rectangle } from './templates';
import { fixtureProject, sizeId } from './testFixtures';
import type { Project } from './model';
import { dragHeight, dragWidth } from './waypointDrag';

const NAMES = ['bust', 'waist', 'arm_length'];

function withRect(): { project: Project; panelId: string } {
  const project = fixtureProject();
  const panel = rectangle();
  project.panels = [panel];
  return { project, panelId: panel.id };
}

describe('readRule', () => {
  it('reads fixed values in any unit', () => {
    expect(readRule('20', NAMES)).toEqual({ mode: 'fixed', value: 20 });
    expect(readRule('8in', NAMES)).toEqual({ mode: 'fixed', value: 8 * 2.54 });
  });

  it('reads measurement formulas', () => {
    expect(readRule('bust / 2 + 4', NAMES)).toEqual({ mode: 'measure', measurement: 'bust', fraction: 0.5, ease: 4 });
    expect(readRule('bust*0.25-1.5in', NAMES)).toEqual({ mode: 'measure', measurement: 'bust', fraction: 0.25, ease: -1.5 * 2.54 });
    expect(readRule('arm_length', NAMES)).toEqual({ mode: 'measure', measurement: 'arm_length', fraction: 1, ease: 0 });
  });

  it('recognises "same as bottom" and falls back to custom', () => {
    expect(readRule('bottom.width', NAMES, 'bottom')).toEqual({ mode: 'same' });
    expect(readRule('max(bust / 2, 40)', NAMES)).toEqual({ mode: 'custom', expr: 'max(bust / 2, 40)' });
    expect(readRule('unknown / 2', NAMES)).toEqual({ mode: 'custom', expr: 'unknown / 2' });
  });
});

describe('ruleExpr', () => {
  it('writes in the display units and round-trips', () => {
    const rules: SizeRule[] = [
      { mode: 'fixed', value: 20 },
      { mode: 'measure', measurement: 'bust', fraction: 0.5, ease: 4 },
      { mode: 'measure', measurement: 'waist', fraction: 0.3, ease: -2 },
      { mode: 'measure', measurement: 'bust', fraction: 1, ease: 0 },
    ];
    for (const units of ['metric', 'imperial'] as const) {
      for (const r of rules) {
        const back = readRule(ruleExpr(r, units, 'bottom'), NAMES) as Extract<SizeRule, { mode: 'fixed' | 'measure' }>;
        expect(back.mode).toBe(r.mode);
        if (r.mode === 'fixed' && back.mode === 'fixed') expect(back.value).toBeCloseTo(r.value, 2);
        if (r.mode === 'measure' && back.mode === 'measure') {
          expect(back.fraction).toBeCloseTo(r.fraction, 6);
          expect(back.ease).toBeCloseTo(r.ease, 2);
        }
      }
    }
    expect(ruleExpr({ mode: 'measure', measurement: 'bust', fraction: 0.5, ease: 4 }, 'metric', 'bottom')).toBe('bust / 2 + 4');
    expect(ruleExpr({ mode: 'fixed', value: 2.54 * 8 }, 'imperial', 'bottom')).toBe('8in');
  });
});

describe('setRectDim', () => {
  it('the template is a rectangle whose top follows the bottom', () => {
    const { project, panelId } = withRect();
    const panel = project.panels[0];
    expect(isRectangle(panel)).toBe(true);
    expect(readRule(rectWaypoints(panel).top.width.expr, NAMES, 'bottom')).toEqual({ mode: 'same' });
    const c = computePanel(project, panel, sizeId(project, 'M'));
    expect(c.waypoints[1].widthCm).toBeCloseTo(20);
    void panelId;
  });

  it('grades the bottom from a measurement in every size, the top following', () => {
    const { project, panelId } = withRect();
    const next = setRectDim(project, panelId, 'bottom', { mode: 'measure', measurement: 'bust', fraction: 0.5, ease: 4 }, 'metric');
    const panel = next.panels[0];
    for (const s of next.sizes) {
      const c = computePanel(next, panel, s.id);
      const bust = buildScope(next, s.id).bust;
      expect(c.waypoints[0].widthCm).toBeCloseTo(bust / 2 + 4);
      expect(c.waypoints[1].widthCm).toBeCloseTo(bust / 2 + 4);
    }
    expect(panel.segments[0].left.kind).toBe('straight');
  });

  it('a top of its own switches to spread shaping; back to "same" removes it', () => {
    const { project, panelId } = withRect();
    let next = setRectDim(project, panelId, 'top', { mode: 'fixed', value: 15 }, 'metric');
    expect(next.panels[0].segments[0].left.kind).toBe('auto');
    const c = computePanel(next, next.panels[0], sizeId(next, 'M'));
    expect(c.waypoints[1].widthCm).toBeCloseTo(15);
    next = setRectDim(next, panelId, 'top', { mode: 'same' }, 'metric');
    expect(next.panels[0].segments[0].left.kind).toBe('straight');
  });

  it('fixed rules clear per-size values, custom ones keep them', () => {
    const { project, panelId } = withRect();
    const m = sizeId(project, 'M');
    project.panels[0].waypoints[1].height.overrides[m] = 50;
    const custom = setRectDim(project, panelId, 'height', { mode: 'custom', expr: 'arm_length' }, 'metric');
    expect(custom.panels[0].waypoints[1].height.overrides[m]).toBe(50);
    const fixed = setRectDim(custom, panelId, 'height', { mode: 'fixed', value: 40 }, 'metric');
    expect(fixed.panels[0].waypoints[1].height).toEqual({ expr: '40', overrides: {} });
    expect(clearRectOverrides(custom, panelId, 'height').panels[0].waypoints[1].height.overrides).toEqual({});
  });

  it('leaves other panels alone', () => {
    const project = fixtureProject();
    const before = structuredClone(project);
    expect(setRectDim(project, project.panels[0].id, 'bottom', { mode: 'fixed', value: 10 }, 'metric')).toEqual(before);
  });
});

describe('convertRule', () => {
  it('starts a measurement rule with no ease and keeps the value when fixing it', () => {
    const r: SizeRule = convertRule('measure', { mode: 'fixed', value: 50 }, 50, 'metric', 'bust', 0.5, 'bottom');
    expect(r).toEqual({ mode: 'measure', measurement: 'bust', fraction: 0.5, ease: 0 });
    expect(convertRule('fixed', r, 50.3, 'metric', 'bust', 0.5, 'bottom')).toEqual({ mode: 'fixed', value: 50.5 });
    expect(convertRule('fixed', r, 50.3, 'imperial', 'bust', 0.5, 'bottom')).toEqual({ mode: 'fixed', value: 19.75 * 2.54 });
    expect(convertRule('custom', { mode: 'measure', measurement: 'bust', fraction: 0.5, ease: 4 }, 50, 'metric', 'bust', 0.5, 'bottom')).toEqual({ mode: 'custom', expr: 'bust / 2 + 4' });
  });
});

describe('rows kept across a resize', () => {
  it('a row hovered near the top is gone once the rectangle gets shorter', () => {
    const { project, panelId } = withRect();
    const m = sizeId(project, 'M');
    const tall = computePanel(project, project.panels[0], m);
    const hovered = tall.totalRows - 1;
    expect(rowInPanel(tall, hovered)).toBe(hovered);
    const shorter = setRectDim(project, panelId, 'height', { mode: 'fixed', value: 10 }, 'metric');
    const short = computePanel(shorter, shorter.panels[0], m);
    expect(short.counts[hovered]).toBeUndefined(); // what the schematic used to pass to sts()
    expect(rowInPanel(short, hovered)).toBeNull();
    expect(rowInPanel(short, 0)).toBe(0);
    expect(rowInPanel(short, null)).toBeNull();
  });
});

describe('schematic drags on a rectangle', () => {
  it('a rectangle made before the size rules (top fixed at 20, no shaping) widens as a whole from either corner', () => {
    const { project, panelId } = withRect();
    const m = sizeId(project, 'M');
    const old = project.panels[0].waypoints[1];
    old.width = { expr: '20', overrides: {} };
    for (const wp of project.panels[0].waypoints) {
      const next = dragWidth(project, panelId, wp.id, m, 'width', 26, 'all');
      const c = computePanel(next, next.panels[0], m);
      expect(c.waypoints.map((w) => Math.round(w.widthCm * 100) / 100)).toEqual([26, 26]);
      expect(c.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    }
  });

  it('dragging the top corner of a rectangle whose top follows the bottom widens the whole rectangle', () => {
    const { project, panelId } = withRect();
    const m = sizeId(project, 'M');
    const top = project.panels[0].waypoints[1];
    const next = dragWidth(project, panelId, top.id, m, 'width', 30, 'all');
    const c = computePanel(next, next.panels[0], m);
    expect(c.waypoints[0].widthCm).toBeCloseTo(30);
    expect(c.waypoints[1].widthCm).toBeCloseTo(30);
    expect(c.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(readRule(next.panels[0].waypoints[1].width.expr, NAMES, 'bottom')).toEqual({ mode: 'same' });
  });

  it('a top with its own width still drags on its own', () => {
    const { project, panelId } = withRect();
    const m = sizeId(project, 'M');
    const tapered = setRectDim(project, panelId, 'top', { mode: 'fixed', value: 15 }, 'metric');
    const next = dragWidth(tapered, panelId, tapered.panels[0].waypoints[1].id, m, 'width', 18, 'all');
    const c = computePanel(next, next.panels[0], m);
    expect(c.waypoints[0].widthCm).toBeCloseTo(20);
    expect(c.waypoints[1].widthCm).toBeCloseTo(18);
  });

  it('a dragged height reads back as a plain length', () => {
    const { project, panelId } = withRect();
    const m = sizeId(project, 'M');
    const next = dragHeight(project, panelId, project.panels[0].waypoints[1].id, m, 12, 'all');
    const panel = next.panels[0];
    expect(panel.waypoints[1].height.expr).toBe('bottom.height + 12');
    expect(readRule(panel.waypoints[1].height.expr, NAMES, undefined, heightBase(panel))).toEqual({ mode: 'fixed', value: 12 });
    expect(readRule('bottom.height + arm_length', NAMES, undefined, 'bottom')).toEqual({ mode: 'measure', measurement: 'arm_length', fraction: 1, ease: 0 });
    expect(readRule('bottom.height + 12', NAMES)).toEqual({ mode: 'custom', expr: 'bottom.height + 12' });
  });
});
