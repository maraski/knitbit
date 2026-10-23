// Checks for a contiguous garment: the yoke against the body's measurements (cross back / front, bicep, scye), the
// cap shape, and the body and sleeves that continue from the held stitches. The generator reports its own row and
// count problems (rows that don't fit, negative counts, a neck below the split); these add the fit comparisons.

import { cachedPanel, type PanelCache } from './joins';
import { buildScope } from './measurements';
import type { Id, Project } from './model';
import type { Issue } from './panel';

export interface ContiguousCheck {
  panelId: Id;
  panelName: string;
  issue: Issue;
}

const cm = (x: number) => `${(Math.round(x * 10) / 10).toFixed(1)} cm`;

export function contiguousChecks(project: Project, sizeId: Id, cache: PanelCache): ContiguousCheck[] {
  const out: ContiguousCheck[] = [];
  const panel = project.panels.find((p) => p.yoke);
  if (!panel) return out;
  const c = cachedPanel(project, panel.id, sizeId, cache);
  const y = c?.yoke;
  if (!y || !y.rows.length) return out;
  const scope = buildScope(project, sizeId);
  const tol = project.settings.seamToleranceCm;
  const push = (severity: Issue['severity'], message: string, at = panel) => out.push({ panelId: at.id, panelName: at.name, issue: { severity, message, ref: { kind: 'panel' } } });

  const raglan = !!y.raglan;
  // Widths at the end of the shoulders (info: the back follows the cross back by design; the shoulder width is a style).
  // A raglan has no shoulders: its checks are below.
  const cb = scope.cross_back_w ?? scope.cross_back;
  if (cb !== undefined && !raglan) {
    const d = y.derived.backEndOfACm - cb;
    push('info', `End of the shoulders (row ${y.counts.A}): the back is ${cm(y.derived.backEndOfACm)}, ${d >= 0 ? `${cm(d)} wider` : `${cm(-d)} narrower`} than the cross back (${cm(cb)}).`);
  }
  if (scope.cross_front !== undefined && !raglan) {
    const d = y.derived.frontEndOfACm - scope.cross_front;
    push('info', `End of the shoulders: the fronts (with the neck between them) are ${cm(y.derived.frontEndOfACm)}, ${d >= 0 ? `${cm(d)} wider` : `${cm(-d)} narrower`} than the cross front (${cm(scope.cross_front)}).`);
  }

  // Sleeve at the underarm (held sleeve + underarm cast-on) against bicep + ease.
  const ease = scope['ease.bicep'] ?? scope.ease ?? 0;
  if (scope.bicep !== undefined) {
    const target = scope.bicep + ease;
    const d = y.derived.sleeveCm - target;
    if (d < -tol) push('warning', `The sleeve at the underarm is ${cm(y.derived.sleeveCm)} (${y.held.leftSleeve} + ${y.underarmCo} sts), ${cm(-d)} less than bicep + ease (${cm(target)}): it may be tight.`);
    else if (d > Math.max(tol, 0.1 * target)) push('info', `The sleeve at the underarm is ${cm(y.derived.sleeveCm)}, ${cm(d)} more than bicep + ease (${cm(target)}).`);
  }

  // Around the armhole: both armhole edges, the cap top and the underarm cast-on, against the body's scye. (A raglan's
  // armhole runs up to the neck, so it isn't compared.)
  if (scope.scye_circumference !== undefined && !raglan) {
    const s = scope.scye_circumference;
    const d = y.derived.armholeCm - s;
    if (d < -tol) push('warning', `Around the armhole (yoke edges + cap top + ${y.underarmCo} sts cast on) is ${cm(y.derived.armholeCm)}, ${cm(-d)} less than the scye circumference (${cm(s)}): the sleeve may be tight at the underarm (a deeper yoke, extra depth, or a larger underarm cast-on helps).`);
    else if (d > 0.15 * s) push('info', `Around the armhole is ${cm(y.derived.armholeCm)}, ${cm(d)} more than the scye circumference (${cm(s)}): a deep armhole.`);
  }

  // Hint: a long shoulder seam with few rapid rows gives a narrow, pointy cap top.
  const { A, C } = y.counts;
  if (!raglan && C < A / 2) push('info', `Hint: the cap may look pointy: the shoulder seam is ${A} rows but the rapid cap only ${C}. More rapid rows (or more seam stitches) round it.`);

  if (y.raglan) {
    // The body at the split against its target (4 sts per increase row, so it can be up to 2 sts off), and how deep
    // the raglan is next to a set-in armhole.
    const body = y.params.bodyWidth?.value;
    if (body !== undefined) {
      const closing = project.garment.opening === 'cardigan' ? scope.closing_r ?? 0 : 0;
      const d = y.derived.bodyCm + closing - body;
      if (Math.abs(d) > Math.max(tol, 2 / y.stitchesPerCm + 1e-6)) push('warning', `The body at the underarm is ${cm(y.derived.bodyCm + closing)} (${y.held.body} + 2 × ${y.underarmCo} sts), ${d > 0 ? `${cm(d)} more` : `${cm(-d)} less`} than its target (${cm(body)}).`);
    }
    if (y.offShoulder) {
      // The band's top edge is off_shoulder_drop below the shoulder point; the front works every row but the short rows
      // (and a folded band's facing and turning round, which fold inside).
      const lower = (scope.off_shoulder_drop ?? 0) + (y.offShoulder.frontRows - (y.offShoulder.fold?.hiddenRows ?? 0)) / y.rowsPerCm;
      if (scope.armhole_depth !== undefined && lower < scope.armhole_depth - tol) push('warning', `The raglan splits ${cm(scope.armhole_depth - lower)} higher than the armhole depth (${cm(scope.armhole_depth)} below the shoulder): it may bind at the underarm. Deepen it.`);
      // It matters more here than most estimates: the band's and the ring's counts come from it.
      const est = project.measurements.find((m) => m.name === 'off_shoulder_circ')?.estimate;
      if (est) push('info', 'off_shoulder_circ is still an estimate: measure it (arms down, around both upper arms and the torso at band height). The band and the ring are worked out from it.');
    } else if (scope.armhole_depth !== undefined) {
      const lower = y.derived.backLengthCm - (scope.shoulder_drop ?? 0) + (scope.back_neck_drop ?? 0);
      if (lower < scope.armhole_depth - tol) push('warning', `The raglan splits ${cm(scope.armhole_depth - lower)} higher than the armhole depth (${cm(scope.armhole_depth)} below the shoulder): it may bind at the underarm. Deepen it.`);
    }
  }

  // Body and sleeves continuing from the held stitches: their first row should take exactly those plus the cast-on.
  const N = y.underarmCo;
  const top = (role: string) =>
    project.panels
      .filter((p) => p.fromYoke === role)
      .map((p) => ({ p, c: cachedPanel(project, p.id, sizeId, cache) }))
      .filter((x) => x.c?.ok);
  const bodies = [...top('back'), ...top('front')];
  if (bodies.length) {
    const have = bodies.reduce((a, x) => a + (x.c!.counts[0] ?? 0), 0);
    const want = y.held.body + 2 * N;
    const fronts = top('front').length;
    // A cardigan front pair counts both halves; a body missing a panel can't be compared.
    if (top('back').length && fronts) {
      if (have !== want) push('warning', `The body starts with ${have} sts (${bodies.map((x) => `${x.p.name} ${x.c!.counts[0]}`).join(', ')}), but the yoke holds ${y.held.body} + 2 × ${y.underarmCo} cast on = ${want}.`, bodies[0].p);
    }
  }
  for (const role of ['leftSleeve', 'rightSleeve'] as const) {
    for (const x of top(role)) {
      const want = y.held[role] + N;
      const have = x.c!.counts[0] ?? 0;
      if (have !== want) push('warning', `${x.p.name} starts with ${have} sts, but the yoke holds ${y.held[role]} + ${N} cast on = ${want}.`, x.p);
    }
  }
  return out;
}
