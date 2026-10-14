// Edge treatments: hem rib, cuff rib, neckband and front bands, set once for the project (Project → Edges) and
// applied to the panels as ordinary pattern sections, strips and joins. Re-applying replaces what an earlier
// application made (marked with `edge`), so the panels follow the settings; anything else is left alone.

import { neckband } from './templates';
import type { EdgeRef, EdgeStitch, EdgeTreatment, EdgeTreatmentId, EdgeTreatments, Join, Panel, PatternSection, Project, StitchPattern } from './model';
import { dim, newId } from './model';

export const EDGE_STITCHES: Record<Exclude<EdgeStitch, 'custom'>, { label: string; pattern: StitchPattern }> = {
  rib1x1: { label: '1×1 rib', pattern: { name: '1x1 rib', multiple: 2, offset: 0 } },
  rib2x2: { label: '2×2 rib', pattern: { name: '2x2 rib', multiple: 4, offset: 2 } },
  garter: { label: 'Garter', pattern: { name: 'garter', multiple: 1, offset: 0 } },
  seed: { label: 'Seed', pattern: { name: 'seed', multiple: 2, offset: 1 } },
};

export const EDGE_TREATMENTS: { id: EdgeTreatmentId; label: string; depthLabel: string; withPanel: string; later: string }[] = [
  { id: 'hem', label: 'Hem ribbing', depthLabel: 'Height', withPanel: 'Knit with the body panels (a pattern section at the lower edge)', later: 'Picked up from the lower edge and worked later' },
  { id: 'cuff', label: 'Cuff ribbing', depthLabel: 'Height', withPanel: 'Knit with the sleeves (a pattern section at the cuff)', later: 'Picked up from the cuff edge and worked later' },
  { id: 'neckband', label: 'Neckband', depthLabel: 'Depth', withPanel: 'Knit with the panels (not available for necklines yet)', later: 'A strip picked up around the neckline' },
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
  const p = edgePattern(t);
  return t.stitch === 'custom' ? `custom (multiple of ${p.multiple}${p.offset ? ` + ${p.offset}` : ''})` : EDGE_STITCHES[t.stitch].label;
}

/** Whether the treatment is worked as part of the panels it edges. Neckbands are always added later for now. */
export function knitWithPanel(id: EdgeTreatmentId, t: EdgeTreatment): boolean {
  return t.method === 'with-panel' && id !== 'neckband';
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

/**
 * Apply the project's edge treatments to its panels. Front bands are only stored here; the bands themselves are
 * made by the cardigan band helper.
 */
export function applyEdgeTreatments(project: Project, notes: string[] = []): Project {
  const e = edgesOf(project);
  let panels = project.panels.map((p) => {
    if (isBodyPanel(p)) return withSection(p, 'hem', e.hem);
    if (isSleevePanel(p)) return withSection(p, 'cuff', e.cuff);
    return p;
  });
  let joins = (project.joins ?? []).filter((j) => j.edge !== 'hem' && j.edge !== 'cuff' && j.edge !== 'neckband');

  for (const [id, pick] of [['hem', isBodyPanel], ['cuff', isSleevePanel]] as const) {
    const t = e[id];
    if (!t.enabled || knitWithPanel(id, t)) continue;
    const edges = panels.filter(pick).map((p): EdgeRef => ({ panelId: p.id, edge: { kind: 'bottom' } }));
    if (edges.length) joins.push(laterJoin(id, t, edges, id === 'hem' ? 'Hem rib (added later)' : 'Cuff rib (added later)'));
  }

  // Neckband: a strip picked up around the neck edges of the body panels.
  const nb = e.neckband;
  const existing = panels.find((p) => p.edge === 'neckband') ?? panels.find((p) => p.template === 'neckband');
  if (nb.enabled) {
    const pattern = edgePattern(nb);
    const base = existing ?? { ...neckband(), name: 'Neckband' };
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
    const necks = panels.filter((p) => isBodyPanel(p) && p.neckline).map((p): EdgeRef => ({ panelId: p.id, edge: { kind: 'neck' } }));
    if (necks.length) joins.push({ ...laterJoin('neckband', nb, necks, 'Neckband picked up'), partner: [{ panelId: strip.id, edge: { kind: 'bottom' } }] });
  } else if (existing?.edge === 'neckband') {
    panels = panels.filter((p) => p.id !== existing.id);
    joins = joins.filter((j) => ![...j.edges, ...j.partner].some((r) => r.panelId === existing.id));
    notes.push('Removed the Neckband strip.');
  }
  return { ...project, panels, joins };
}
