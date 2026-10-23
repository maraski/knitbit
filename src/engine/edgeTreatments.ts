// Edge treatments: hem rib, cuff rib, neckband and front bands, set once for the project (Project → Edges) and
// applied to the panels as ordinary pattern sections, strips and joins. Re-applying replaces what an earlier
// application made (marked with `edge`), so the panels follow the settings; anything else is left alone.

import { attachOf, BAND_NAMES, bandRoles } from './bands';
import { neckband } from './templates';
import type { BandRole, EdgeRef, EdgeStitch, EdgeTreatment, EdgeTreatmentId, EdgeTreatments, Join, NecklineShape, Panel, PatternSection, Project, StitchPattern } from './model';
import { dim, newId, newPanel, newSegment, newWaypoint, straightNeck } from './model';

export const EDGE_STITCHES: Record<Exclude<EdgeStitch, 'custom'>, { label: string; pattern: StitchPattern }> = {
  rib1x1: { label: '1×1 rib', pattern: { name: '1x1 rib', multiple: 2, offset: 0 } },
  rib2x2: { label: '2×2 rib', pattern: { name: '2x2 rib', multiple: 4, offset: 2 } },
  garter: { label: 'Garter', pattern: { name: 'garter', multiple: 1, offset: 0 } },
  seed: { label: 'Seed', pattern: { name: 'seed', multiple: 2, offset: 1 } },
};

export const EDGE_TREATMENTS: { id: EdgeTreatmentId; label: string; depthLabel: string; withPanel: string; later: string }[] = [
  { id: 'hem', label: 'Hem ribbing', depthLabel: 'Height', withPanel: 'Knit with the body panels (a pattern section at the lower edge)', later: 'Picked up from the lower edge and worked later' },
  { id: 'cuff', label: 'Cuff ribbing', depthLabel: 'Height', withPanel: 'Knit with the sleeves (a pattern section at the cuff)', later: 'Picked up from the cuff edge and worked later' },
  { id: 'neckband', label: 'Neckband', depthLabel: 'Depth', withPanel: 'Knit with the panels (an off-shoulder band only)', later: 'A strip picked up around the neckline' },
  { id: 'frontBands', label: 'Front bands', depthLabel: 'Width', withPanel: 'Integrated: extra stitches at the front edges', later: 'Added later: picked up, or knit sideways and sewn on' },
];

const custom = (multiple = 2, offset = 0): StitchPattern => ({ name: 'custom', multiple, offset });

export function defaultEdges(): EdgeTreatments {
  return {
    hem: { enabled: false, depth: dim(5), stitch: 'rib2x2', custom: custom(), method: 'with-panel' },
    cuff: { enabled: true, depth: dim(5), stitch: 'rib2x2', custom: custom(), method: 'with-panel' },
    neckband: { enabled: true, depth: dim(2.5), stitch: 'rib1x1', custom: custom(), method: 'later' },
    frontBands: { enabled: true, depth: dim(2.5), stitch: 'rib1x1', custom: custom(), method: 'later' },
  };
}

export function edgesOf(project: Pick<Project, 'edges'>): EdgeTreatments {
  return project.edges ?? defaultEdges();
}

/** The stitch pattern (name, multiple, offset) a treatment uses. */
export function edgePattern(t: EdgeTreatment): StitchPattern {
  if (t.stitch === 'custom') return { ...t.custom, multiple: Math.max(1, Math.round(t.custom.multiple)), offset: Math.round(t.custom.offset) };
  return { ...EDGE_STITCHES[t.stitch].pattern };
}

export function edgeStitchLabel(t: EdgeTreatment): string {
  if (t.fold && t.method === 'with-panel') return `folded stockinette, ${t.fold.turn === 'picot' ? 'picot' : 'purl'} turning round`;
  const p = edgePattern(t);
  return t.stitch === 'custom' ? `custom (multiple of ${p.multiple}${p.offset ? ` + ${p.offset}` : ''})` : EDGE_STITCHES[t.stitch].label;
}

/** A neckband can be knit with the panels only as an off-shoulder yoke's band (knit first, raglan.ts). */
export function neckbandWithPanelAllowed(project: Pick<Project, 'panels'>): boolean {
  return project.panels.some((p) => p.yoke?.neck.shape === 'off-shoulder');
}

/** Whether the treatment is worked as part of the panels it edges (a neckband: an off-shoulder band only). */
export function knitWithPanel(id: EdgeTreatmentId, t: EdgeTreatment, project?: Pick<Project, 'panels'>): boolean {
  return t.method === 'with-panel' && (id !== 'neckband' || (!!project && neckbandWithPanelAllowed(project)));
}

type Fold = NonNullable<EdgeTreatment['fold']>;

/** A folded band: a purl turning round, knit closed. */
export function defaultFold(): Fold {
  return { turn: 'purl', close: 'knit' };
}

/** An off-shoulder band as the Neckband: 4 cm of 1×1 rib, knit with the yoke. */
export function offShoulderNeckband(): EdgeTreatment {
  return { enabled: true, depth: dim(4), stitch: 'rib1x1', custom: custom(), method: 'with-panel' };
}

/**
 * The edges for a neckline changed from `from` to `shape`: choosing off-shoulder pre-sets its band; any other
 * neckline can't knit the neckband with the panels, so a with-panel neckband goes back to the default strip.
 */
export function edgesForNeckline(edges: EdgeTreatments, shape: NecklineShape, from: NecklineShape): EdgeTreatments {
  if (shape === 'off-shoulder') return from === 'off-shoulder' ? edges : { ...edges, neckband: offShoulderNeckband() };
  return edges.neckband.method === 'with-panel' ? { ...edges, neckband: defaultEdges().neckband } : edges;
}

export const isBodyPanel = (p: Panel) => p.template === 'back' || p.template === 'front';
export const isSleevePanel = (p: Panel) => (p.template ?? '').startsWith('sleeve');

const SECTION_NAMES: Partial<Record<EdgeTreatmentId, string>> = { hem: 'Hem rib', cuff: 'Cuff rib' };

/** Sections an earlier application (or the templates, by name) made for this treatment. */
function isTreatmentSection(s: PatternSection, id: EdgeTreatmentId): boolean {
  return s.edge === id || (s.edge === undefined && s.name === SECTION_NAMES[id]);
}

function withSection(panel: Panel, id: EdgeTreatmentId, t: EdgeTreatment): Panel {
  const sections = panel.sections.filter((s) => !isTreatmentSection(s, id));
  if (t.enabled && knitWithPanel(id, t)) {
    sections.unshift({ id: newId('sec'), name: SECTION_NAMES[id]!, fromHeight: dim(0), toHeight: structuredClone(t.depth), pattern: edgePattern(t), edge: id });
  }
  return { ...panel, sections };
}

function laterJoin(id: EdgeTreatmentId, t: EdgeTreatment, edges: EdgeRef[], name: string): Join {
  return {
    id: newId('join'),
    name,
    tag: 'pickup',
    edges,
    partner: [],
    ratio: null,
    note: `${edgeStitchLabel(t)}, ${t.depth.expr} cm, worked after the panels.`,
    edge: id,
  };
}

export interface ApplyOptions {
  /**
   * Make missing strips (the neckband, front band strips). Off by default: changing a setting never adds or removes
   * panels; strips you made follow the settings, and strips that no longer fit them are left for you to delete.
   */
  create?: boolean;
}

/** Apply the project's edge treatments to its panels: sections, pick-up joins, and the strips that exist. */
export function applyEdgeTreatments(project: Project, notes: string[] = [], opts: ApplyOptions = {}): Project {
  const e = edgesOf(project);
  let panels = project.panels.map((p) => {
    if (isBodyPanel(p)) return withSection(p, 'hem', e.hem);
    if (isSleevePanel(p)) return withSection(p, 'cuff', e.cuff);
    return p;
  });
  const existing = panels.find((p) => p.edge === 'neckband') ?? panels.find((p) => p.template === 'neckband');
  const nb = e.neckband;
  // An off-shoulder band is knit with the yoke: no strip, no pick-up.
  const asStrip = nb.enabled && !knitWithPanel('neckband', nb, project);
  // A neckband that is switched off keeps its strip and pick-up join as they are (the knitter deletes them).
  const keepNeckJoin = !nb.enabled && !!existing;
  let joins = (project.joins ?? []).filter((j) => j.edge !== 'hem' && j.edge !== 'cuff' && (j.edge !== 'neckband' || keepNeckJoin));

  for (const [id, pick] of [['hem', isBodyPanel], ['cuff', isSleevePanel]] as const) {
    const t = e[id];
    if (!t.enabled || knitWithPanel(id, t)) continue;
    const edges = panels.filter(pick).map((p): EdgeRef => ({ panelId: p.id, edge: { kind: 'bottom' } }));
    if (edges.length) joins.push(laterJoin(id, t, edges, id === 'hem' ? 'Hem rib (added later)' : 'Cuff rib (added later)'));
  }

  // Neckband: a strip picked up around the neck edges of the body panels (made only when asked for).
  if (asStrip && (existing || opts.create)) {
    const pattern = edgePattern(nb);
    const shape = panels.find((x) => x.yoke)?.yoke!.neck.shape ?? panels.find((x) => x.template === 'front' && x.neckline)?.neckline!.shape;
    const base = existing ?? { ...neckband(shape), name: 'Neckband' };
    const top = base.waypoints[base.waypoints.length - 1];
    const strip: Panel = {
      ...base,
      edge: 'neckband',
      pattern,
      waypoints: base.waypoints.map((w) => (w.id === top.id ? { ...w, height: structuredClone(nb.depth) } : w)),
      sections: [{ id: base.sections[0]?.id ?? newId('sec'), name: 'Rib', fromHeight: dim(0), toHeight: dim(`${top.name}.height`), pattern }],
    };
    panels = existing ? panels.map((p) => (p.id === existing.id ? strip : p)) : [...panels, strip];
    if (!existing) notes.push('Added a Neckband strip.');
    const necks = panels.filter((p) => p.yoke || (isBodyPanel(p) && p.neckline) || straightNeck(p)).map((p): EdgeRef => ({ panelId: p.id, edge: { kind: 'neck' } }));
    if (necks.length) joins.push({ ...laterJoin('neckband', nb, necks, 'Neckband picked up'), partner: [{ panelId: strip.id, edge: { kind: 'bottom' } }] });
  }
  return applyFrontBands({ ...project, panels, joins }, notes, opts);
}

/** Strips the settings call for that don't exist yet: the neckband, front band strips. */
export function missingStrips(project: Project): string[] {
  const out: string[] = [];
  const e = edgesOf(project);
  if (project.edges && e.neckband.enabled && !knitWithPanel('neckband', e.neckband, project) && !project.panels.some((p) => p.edge === 'neckband' || p.template === 'neckband')) out.push('Neckband');
  for (const role of bandRoles(project)) {
    if (attachOf(project, role) === 'integrated') continue;
    if (!project.panels.some((p) => p.edge === 'frontBands' && p.band === role)) out.push(BAND_NAMES[role]);
  }
  return out;
}

/** Strips left from earlier settings: a neckband that is switched off (or knit with the panels), bands the settings
 * no longer call for. */
export function staleStrips(project: Project): Panel[] {
  const e = edgesOf(project);
  const roles = bandRoles(project).filter((r) => attachOf(project, r) !== 'integrated');
  const noStrip = !e.neckband.enabled || knitWithPanel('neckband', e.neckband, project);
  return project.panels.filter((p) => (p.edge === 'neckband' && noStrip) || (p.edge === 'frontBands' && (!p.band || !roles.includes(p.band))));
}

/** Make the strips the settings call for (the knitter asked for them). */
export function addStrips(project: Project, notes: string[] = []): Project {
  return applyEdgeTreatments(project, notes, { create: true });
}

// ---------- cardigan front bands ----------

/** The edges a band is attached to, in working order (a continuous band: up the right front, around, down the left). */
/** A front edge (as worn), from the hem up: the front panel's, then on a contiguous yoke the yoke's up to the neck. */
export function frontEdges(project: Project, side: 'left' | 'right'): EdgeRef[] {
  const f = project.panels.find((p) => p.half?.side === side);
  const yoke = project.panels.find((p) => p.yoke);
  return [...(f ? [{ panelId: f.id, edge: { kind: 'front' as const } }] : []), ...(yoke && project.garment.opening === 'cardigan' ? [{ panelId: yoke.id, edge: { kind: 'front' as const, side } }] : [])];
}

export function bandEdges(project: Project, role: BandRole): EdgeRef[] {
  const front = (side: 'left' | 'right') => project.panels.find((p) => p.half?.side === side);
  const yoke = project.panels.find((p) => p.yoke);
  const c = project.cardigan;
  const one = (side: 'left' | 'right') => frontEdges(project, side);
  if (role !== 'continuous') {
    const holeSide = c?.buttonholeSide ?? 'right';
    return one(role === 'buttonhole' ? holeSide : holeSide === 'right' ? 'left' : 'right');
  }
  const r = front('right');
  const l = front('left');
  const back = project.panels.find((p) => p.template === 'back' && p.neckline);
  const neck = (p: Panel | undefined): EdgeRef[] => (p?.neckline ? [{ panelId: p.id, edge: { kind: 'neck' } }] : []);
  const necks = yoke ? [{ panelId: yoke.id, edge: { kind: 'neck' as const } }] : [...neck(r), ...neck(back), ...neck(l)];
  // Up the right front, around the neck, down the left front.
  return [...one('right'), ...necks, ...one('left').reverse()];
}

/**
 * A band strip. Picked up: worked out from the picked-up edge for the band width (its width is the pick-up count,
 * rounded to the band's multiple). Knit sideways: the band width across, as many rows as the edge is long.
 */
function bandStrip(role: BandRole, attach: 'pickup' | 'sideways', pattern: StitchPattern, existing?: Panel): Panel {
  const p = newPanel(BAND_NAMES[role]);
  const [a, b] =
    attach === 'pickup'
      ? [newWaypoint('pick_up', 0, 'edge_pickup * st_w'), newWaypoint('bind_off', 'band_w', 'pick_up.width')]
      : [newWaypoint('cast_on', 0, 'band_w'), newWaypoint('bind_off', 'edge_len', 'band_w')];
  if (existing) {
    // Keep the waypoint ids so hand-edited joins to its edges stay valid.
    const old = existing.waypoints;
    if (old[0]) a.id = old[0].id;
    if (old[1]) b.id = old[1].id;
  }
  p.id = existing?.id ?? p.id;
  p.name = existing?.name ?? p.name;
  p.layout = existing?.layout ?? p.layout;
  p.template = 'band';
  p.edge = 'frontBands';
  p.band = role;
  p.selvedge = { left: 0, right: 0 };
  p.startFrom = attach === 'pickup' ? 'pickup' : 'caston';
  p.pattern = pattern;
  p.waypoints = [a, b];
  p.segments = [newSegment(a.id, { kind: 'straight' })];
  p.sections = [{ id: existing?.sections[0]?.id ?? newId('sec'), name: pattern.name, fromHeight: dim(0), toHeight: dim(`${b.name}.height`), pattern }];
  p.notes =
    attach === 'pickup'
      ? 'Picked up along the edge (pick-up helper at the join’s ratio), rounded to the band’s multiple; worked for the band width.'
      : 'Knit sideways: the band width across, as many rows as the edge is long; sewn to the edge.';
  return p;
}

/**
 * Make the band strips that exist (or, with `create`, all of them) and their joins match the settings. Strips the
 * settings no longer call for are left as they are, joins included.
 */
export function applyFrontBands(project: Project, notes: string[] = [], opts: ApplyOptions = {}): Project {
  const roles = bandRoles(project).filter((r) => attachOf(project, r) !== 'integrated');
  const pattern = edgePattern(edgesOf(project).frontBands);
  let panels = project.panels;
  const active = (id: string) => panels.some((p) => p.id === id && p.edge === 'frontBands' && p.band && roles.includes(p.band));
  const joins = (project.joins ?? []).filter((j) => j.edge !== 'frontBands' || !j.partner.some((r) => active(r.panelId)));
  for (const role of roles) {
    const attach = attachOf(project, role) as 'pickup' | 'sideways';
    const existing = panels.find((p) => p.edge === 'frontBands' && p.band === role);
    if (!existing && !opts.create) continue;
    const strip = bandStrip(role, attach, pattern, existing);
    panels = existing ? panels.map((p) => (p.id === existing.id ? strip : p)) : [...panels, strip];
    if (!existing) notes.push(`Added a ${strip.name} strip.`);
    const edges = bandEdges({ ...project, panels }, role);
    const end = strip.waypoints[1].id;
    joins.push({
      id: newId('join'),
      name: `${strip.name} ${attach === 'pickup' ? 'picked up' : 'sewn on'}`,
      tag: attach === 'pickup' ? 'pickup' : 'seam',
      edges,
      partner: [{ panelId: strip.id, edge: attach === 'pickup' ? { kind: 'bottom' } : { kind: 'side', side: 'left', from: strip.waypoints[0].id, to: end } }],
      ratio: null,
      note: `${edgeStitchLabel(edgesOf(project).frontBands)}, band_w wide.`,
      edge: 'frontBands',
    });
  }
  return { ...project, panels, joins };
}
