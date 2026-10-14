// Checks that come from the sizing data: region sizing, hem vs bust, armhole vs scye, neckband vs neck base.
// Called by projectChecks with the panels already computed for one size.

import { measureEdge, type PanelCache } from './joins';
import { buildScope } from './measurements';
import type { Id, Panel, Project } from './model';
import type { ComputedPanel, Issue } from './panel';
import { regionTransitions } from './regionShaping';
import { regionSizingOn, regionSources, sizesApart } from './regions';

export const DEFAULT_REGION_GAP = 2;

export interface FitCheck {
  panelId: Id;
  panelName: string;
  issue: Issue;
  /** A panel issue this check restates with more context (the check list shows this one instead). */
  replaces?: Issue;
}

const cm = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)} cm`;
const isBody = (p: Panel) => p.template === 'back' || p.template === 'front';

/** Lowest waypoint of a computed panel in garment order (the hem). */
function hemOf(c: ComputedPanel) {
  if (!c.ok || !c.waypoints.length) return null;
  const up = (r: number) => (c.topDown ? c.totalRows - r : r);
  return [...c.waypoints].sort((a, b) => up(a.row) - up(b.row))[0];
}

export function fitChecks(project: Project, sizeId: Id, computed: { panel: Panel; c: ComputedPanel }[], cache: PanelCache): FitCheck[] {
  const out: FitCheck[] = [];
  const scope = buildScope(project, sizeId);
  const name = (id: Id) => project.sizes.find((s) => s.id === id)?.name ?? '?';
  const first = project.panels[0];
  const projectLevel = (issue: Issue): FitCheck => ({ panelId: first?.id ?? '', panelName: 'Sizes', issue });

  // ---- region sizing: lower body far from the upper body ----
  if (regionSizingOn(project)) {
    const src = regionSources(project, sizeId);
    const limit = project.settings.regionGapLimit ?? DEFAULT_REGION_GAP;
    const apart = sizesApart(project, src.upper, src.lower);
    if (apart !== null && apart > limit) {
      out.push(
        projectLevel({
          severity: 'warning',
          message: `Lower body ${name(src.lower)} is ${apart} sizes from upper body ${name(src.upper)} (limit ${limit}): check the shaping between the waist and the underarm.`,
          ref: { kind: 'panel' },
        }),
      );
    }
  }

  // ---- shaping that doesn't fit its rows, where regions meet: say which sizes meet there ----
  for (const { panel, c } of computed) {
    const ts = regionTransitions(project, panel, c);
    if (!ts.length) continue;
    for (const issue of c.issues) {
      if (issue.severity !== 'error' || issue.ref.kind !== 'segment') continue;
      const ref = issue.ref;
      const t = ts.find((x) => x.lower.waypointId === ref.fromWaypoint || x.upper.waypointId === ref.fromWaypoint);
      if (!t) continue;
      out.push({
        panelId: panel.id,
        panelName: panel.name,
        issue: { severity: 'error', message: `More shaping than the rows allow between ${t.lower.name} and ${t.upper.name}, where ${t.lower.sizes} meets ${t.upper.sizes}: ${t.label}. Bring the sizes closer or lengthen this part. (${issue.message})`, ref },
        replaces: issue,
      });
    }
  }

  // ---- hem narrower than bust + ease (optional, off by default) ----
  if (project.settings.hemCheck && scope.bust !== undefined) {
    const bodies = computed.filter(({ panel }) => isBody(panel));
    const hems = bodies.map(({ panel, c }) => ({ panel, w: hemOf(c) })).filter((x) => x.w);
    if (hems.length) {
      const total = hems.reduce((a, x) => a + x.w!.widthCm, 0);
      const need = scope.bust + (scope.ease ?? 0);
      if (total < need - 1e-6) {
        const p = hems[0].panel;
        out.push({
          panelId: p.id,
          panelName: hems.map((x) => x.panel.name).join(' + '),
          issue: {
            severity: 'warning',
            message: `The hem (${cm(total)} around) is ${cm(need - total)} narrower than the bust plus ease (${cm(need)}): it may not pull over the bust.`,
            ref: { kind: 'waypoint', id: hems[0].w!.id },
          },
        });
      }
    }
  }

  // ---- armhole shorter than the body's scye (set-in sleeves sanity check) ----
  if (scope.scye_circumference !== undefined) {
    const lengths: number[] = [];
    let panelId: Id | null = null;
    for (const tpl of ['front', 'back']) {
      const panel = project.panels.find((p) => p.template === tpl);
      const u = panel?.waypoints.find((w) => w.name === 'underarm');
      const sh = panel?.waypoints.find((w) => w.name === 'shoulder');
      if (!panel || !u || !sh) continue;
      const m = measureEdge(project, { panelId: panel.id, edge: { kind: 'side', side: 'left', from: u.id, to: sh.id } }, sizeId, project.settings.pickUp, cache);
      if (m.ok) {
        lengths.push(m.lengthCm);
        panelId ??= panel.id;
      }
    }
    if (lengths.length === 2 && panelId) {
      const total = lengths[0] + lengths[1];
      if (total < scope.scye_circumference - 1e-6) {
        const p = project.panels.find((x) => x.id === panelId)!;
        out.push({
          panelId,
          panelName: p.name,
          issue: { severity: 'warning', message: `The armhole (Front + Back, ${cm(total)}) is shorter than the scye circumference (${cm(scope.scye_circumference)}): the sleeve will be tight at the underarm.`, ref: { kind: 'panel' } },
        });
      }
    }
  }

  // ---- neckband shorter than the base of the neck ----
  if (scope.neck_base !== undefined) {
    for (const { panel, c } of computed) {
      if (panel.template !== 'neckband' || !c.ok || !c.waypoints.length) continue;
      const w = c.waypoints[0];
      if (w.widthCm < scope.neck_base - 1e-6) {
        out.push({ panelId: panel.id, panelName: panel.name, issue: { severity: 'warning', message: `The neckband (${cm(w.widthCm)}) is shorter than the neck base (${cm(scope.neck_base)}): it won't sit around the neck.`, ref: { kind: 'waypoint', id: w.id } } });
      }
    }
  }
  return out;
}
