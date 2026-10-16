// Buttons and buttonholes on a cardigan, and the band checks: where each buttonhole is worked (row and stitch on the
// buttonhole band, or on the front for an integrated band), and whether bands, holes and the closed width work out.

import { attachOf, bandOnFront, bandRoles, buttonPositions, cardiganOf } from './bands';
import { edgePattern, edgesOf } from './edgeTreatments';
import { cachedPanel, frontEdgeRows, measureEdge, type PanelCache } from './joins';
import type { BandAttach, BandRole, Id, Panel, Project } from './model';
import { buildScope } from './measurements';
import type { ComputedPanel, Issue } from './panel';
import { roundNearest } from './rounding';

export interface Buttonhole {
  index: number; // 0 = top button
  heightCm: number; // up from the front's lower edge
  panelId: Id; // the band strip, or the front for an integrated band
  row: number; // knit row on that panel
  x: number; // stitch x (from the panel's centre line) of the hole's first (leftmost) cell
}

export interface ButtonPlan {
  positions: number[]; // cm up from the lower edge, top button first
  manual: boolean;
  frontEdgeCm: number; // height of the straight front edge
  buttonFrontId: Id | null;
  holeFrontId: Id | null;
  holeRole: BandRole;
  holeAttach: BandAttach;
  holes: Buttonhole[];
  holeWidth: number; // cells per buttonhole
  /** For a picked-up band: stitches between buttonholes along the band. */
  spacingSts: number[];
  issues: { severity: Issue['severity']; message: string }[];
}

/** Cells of one buttonhole in working order on a RS row read right to left: the yarn over, then the k2tog. */
export function buttonholeCells(project: Project): string[] {
  const b = cardiganOf(project).buttonhole;
  if (b.style === 'yo-k2tog') return ['k2tog', 'yo'];
  return new Array(Math.max(1, Math.round(b.width))).fill(b.symbol || 'buttonhole');
}

function rowAt(c: ComputedPanel, hCm: number): number {
  const r = Math.max(1, Math.min(c.totalRows, Math.round(hCm * c.rowsPerCm)));
  return c.topDown ? c.totalRows - r + 1 : r;
}

/** Where the buttons go and where each buttonhole is worked, in one size. Null without buttons or fronts. */
export function buttonPlan(project: Project, sizeId: Id, cache: PanelCache = new Map()): ButtonPlan | null {
  const roles = bandRoles(project);
  if (!roles.length) return null;
  const opts = cardiganOf(project);
  const holeSide = opts.buttonholeSide;
  const holeFront = project.panels.find((p) => p.half?.side === holeSide);
  const buttonFront = project.panels.find((p) => p.half && p.half.side !== holeSide);
  if (!holeFront) return null;
  const fc = cachedPanel(project, holeFront.id, sizeId, cache);
  if (!fc?.ok) return null;
  const issues: ButtonPlan['issues'] = [];
  const frontEdgeCm = frontEdgeRows(fc) / fc.rowsPerCm;
  const scope = buildScope(project, sizeId);
  const bp = buttonPositions(project, sizeId, frontEdgeCm, scope);
  for (const e of bp.errors) issues.push({ severity: 'error', message: e });
  const cells = buttonholeCells(project);
  const w = cells.length;
  const hole = bandOnFront(project, holeSide)!;
  const plan: ButtonPlan = {
    positions: bp.positions,
    manual: bp.manual,
    frontEdgeCm,
    buttonFrontId: buttonFront?.id ?? null,
    holeFrontId: holeFront.id,
    holeRole: hole.role,
    holeAttach: hole.attach,
    holes: [],
    holeWidth: w,
    spacingSts: [],
    issues,
  };

  for (const [i, h] of bp.positions.entries()) {
    if (h < 0 || h > frontEdgeCm + 1e-6) issues.push({ severity: 'error', message: `Button ${i + 1} is at ${h.toFixed(1)} cm, outside the front edge (0–${frontEdgeCm.toFixed(1)} cm).` });
  }

  if (hole.attach === 'integrated') {
    const half = fc.half!;
    const sel = holeFront.half!.cfSelvedge;
    const start = half.keep === 'right' ? half.cfX + sel : half.cfX - sel - half.bandSts;
    const x = start + Math.floor((half.bandSts - w) / 2);
    plan.holes = bp.positions.map((h, index) => ({ index, heightCm: h, panelId: holeFront.id, row: rowAt(fc, h), x }));
    if ((half.bandSts - w) / 2 < 1) issues.push({ severity: 'warning', message: `Buttonholes (${w} sts) leave fewer than 1 band stitch each side in a ${half.bandSts}-st band.` });
  } else {
    const strip = project.panels.find((p) => p.edge === 'frontBands' && p.band === hole.role);
    const sc = strip ? cachedPanel(project, strip.id, sizeId, cache) : null;
    if (!strip || !sc?.ok) {
      issues.push({ severity: 'warning', message: `No ${hole.role === 'continuous' ? 'front band' : 'buttonhole band'} strip to put the buttonholes on: change any band setting (Project → Edges) to make it.` });
      return plan;
    }
    // Distance along the band from its start (the right front's lower edge for a continuous band).
    let total = frontEdgeCm;
    if (hole.role === 'continuous') {
      const j = (project.joins ?? []).find((x) => x.partner.some((r) => r.panelId === strip.id));
      total = j ? j.edges.reduce((a, r) => a + measureEdge(project, r, sizeId, j.ratio ?? project.settings.pickUp, cache).lengthCm, 0) : frontEdgeCm;
    }
    const along = (h: number) => (hole.role === 'continuous' && holeSide === 'left' ? total - h : h);
    if (hole.attach === 'pickup') {
      // Worked in the middle row of the band; hem end on the right for the right front, on the left for the left.
      const row = Math.max(1, Math.ceil(sc.totalRows / 2));
      const n = sc.counts[row];
      const hemRight = hole.role === 'continuous' || holeSide === 'right';
      plan.holes = bp.positions.map((h, index) => {
        const idx = Math.max(0, Math.min(n - w, roundNearest((along(h) / total) * n - w / 2)));
        return { index, heightCm: h, panelId: strip.id, row, x: hemRight ? sc.rightEdge[row] - idx - w : sc.leftEdge[row] + idx };
      });
      const ordered = [...plan.holes].sort((a, b) => a.x - b.x);
      plan.spacingSts = ordered.slice(1).map((hh, k) => hh.x - ordered[k].x - w);
      if (Math.min(row - 1, sc.totalRows - row) < 2) issues.push({ severity: 'warning', message: `The band is ${sc.totalRows} rows deep: the buttonholes (row ${row}) are within 2 rows of its edge. Widen the band.` });
      const closest = Math.min(...plan.spacingSts);
      if (closest < 2) issues.push({ severity: 'warning', message: `Buttonholes are ${closest} st${closest === 1 ? '' : 's'} apart on the band: too close together.` });
    } else {
      // Knit sideways from the lower edge: each buttonhole on the row at its height, centred across the band.
      const n = sc.counts[1] ?? 0;
      plan.holes = bp.positions.map((h, index) => {
        const row = Math.max(1, Math.min(sc.totalRows, Math.round(along(h) * sc.rowsPerCm)));
        return { index, heightCm: h, panelId: strip.id, row, x: sc.leftEdge[row] + Math.floor((n - w) / 2) };
      });
      if ((n - w) / 2 < 1) issues.push({ severity: 'warning', message: `Buttonholes (${w} sts) leave fewer than 1 stitch each side in a ${n}-st band.` });
    }
  }
  if (hole.attach !== 'pickup') {
    const rows = plan.holes.map((h) => h.row).sort((a, b) => a - b);
    const gaps = rows.slice(1).map((r, k) => r - rows[k]);
    if (gaps.some((g) => g < 4)) issues.push({ severity: 'warning', message: `Buttonholes are only ${Math.min(...gaps)} rows apart: too close together.` });
  }
  return plan;
}

export interface BandCheck {
  panelId: Id;
  panelName: string;
  issue: Issue;
}

/** Band checks in one size: lengths, multiples, buttonholes and the closed width. */
export function bandChecks(project: Project, sizeId: Id, cache: PanelCache): BandCheck[] {
  const out: BandCheck[] = [];
  const roles = bandRoles(project);
  const fronts = project.panels.filter((p) => p.half);
  if (project.garment.opening !== 'cardigan' || !fronts.length) return out;
  const scope = buildScope(project, sizeId);
  const tol = project.settings.seamToleranceCm;
  const pattern = edgePattern(edgesOf(project).frontBands);
  const push = (p: Panel, severity: Issue['severity'], message: string) => out.push({ panelId: p.id, panelName: p.name, issue: { severity, message, ref: { kind: 'panel' } } });

  // Picked-up and sewn-on strips: length against the edge, and the pick-up against the band's multiple.
  for (const role of roles) {
    const attach = attachOf(project, role);
    if (attach === 'integrated') continue;
    const strip = project.panels.find((p) => p.edge === 'frontBands' && p.band === role);
    const sc = strip && cachedPanel(project, strip.id, sizeId, cache);
    const join = strip && (project.joins ?? []).find((j) => j.partner.some((r) => r.panelId === strip.id));
    if (!strip || !sc?.ok || !join) continue;
    const m = join.edges.map((r) => measureEdge(project, r, sizeId, join.ratio ?? project.settings.pickUp, cache));
    const edgeCm = m.reduce((a, x) => a + x.lengthCm, 0);
    const pickup = m.reduce((a, x) => a + x.pickup, 0);
    const bandCm = attach === 'pickup' ? (sc.counts[1] ?? 0) / sc.stitchesPerCm : sc.totalRows / sc.rowsPerCm;
    if (bandCm < edgeCm * 0.9 - 1e-6) push(strip, 'warning', `${strip.name} is ${bandCm.toFixed(1)} cm long, ${(edgeCm - bandCm).toFixed(1)} cm shorter than its edge (${edgeCm.toFixed(1)} cm): it may pull the front up.`);
    else if (bandCm > edgeCm * 1.05 + tol) push(strip, 'warning', `${strip.name} is ${bandCm.toFixed(1)} cm long, ${(bandCm - edgeCm).toFixed(1)} cm longer than its edge (${edgeCm.toFixed(1)} cm): it may ripple.`);
    if (attach === 'pickup' && pattern.multiple > 1 && ((pickup - pattern.offset) % pattern.multiple + pattern.multiple) % pattern.multiple !== 0) {
      const sts = sc.counts[0] ?? 0;
      push(strip, 'info', `Picking up ${pickup} sts doesn't fit ${pattern.name} (${pattern.multiple}n${pattern.offset ? ` + ${pattern.offset}` : ''}); the band rounds to ${sts}: pick up ${sts - pickup > 0 ? `${sts - pickup} more` : `${pickup - sts} fewer`}.`);
    }
  }
  if (roles.includes('continuous') && edgesOf(project).neckband.enabled) {
    const strip = project.panels.find((p) => p.band === 'continuous');
    if (strip) push(strip, 'warning', 'A continuous front band goes around the neck, and a neckband is switched on too.');
  }

  // Buttons and buttonholes.
  const plan = buttonPlan(project, sizeId, cache);
  if (plan) {
    const p = project.panels.find((x) => x.id === (plan.holes[0]?.panelId ?? plan.holeFrontId)) ?? fronts[0];
    for (const i of plan.issues) push(p, i.severity, i.message);
  }

  // Closed width: both fronts' fabric plus the bands, less the overlap, against the whole front's target.
  const front = fronts[0];
  const fc = cachedPanel(project, front.id, sizeId, cache);
  if (fc?.ok) {
    const bandW = scope.band_w ?? 0;
    const overlap = scope.band_overlap ?? 0;
    for (const w of fc.waypoints) {
      if (w.wholeCm === undefined) continue;
      const fabric = (w.stitches - w.selvedge - (fc.half?.bandSts ?? 0)) / fc.stitchesPerCm;
      const closed = 2 * fabric + 2 * bandW - overlap;
      if (closed < w.wholeCm - tol) {
        const rounding = w.stitchRounding[0]?.steps.find((st) => st.rule === 'multiple' && st.to < st.from);
        push(front, 'warning', `Closed at ${w.name}, the fronts measure ${closed.toFixed(1)} cm (2 × ${fabric.toFixed(1)} + 2 × ${bandW} band − ${overlap} overlap), ${(w.wholeCm - closed).toFixed(1)} cm short of the front's ${w.wholeCm.toFixed(1)} cm${rounding ? ` (each front was rounded down to its pattern multiple)` : ''}.`);
      }
    }
  }
  return out;
}
