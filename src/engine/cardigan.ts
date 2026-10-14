// Cardigan fronts: a front panel becomes a mirrored left/right pair (Panel.half), and back again. The pair shares
// one description of the whole front; an edit to either front is copied to the other until they are unlinked.

import type { EdgeRef, FrontHalf, FrontOpening, Id, Join, Panel, Project } from './model';
import { newId } from './model';

/** Fields that are each front's own; everything else describes the shared whole front. */
const OWN_FIELDS = new Set<keyof Panel>(['id', 'name', 'half', 'layout', 'notes', 'linkedTo']);

const DEFAULT_CF_SELVEDGE = 1;

function shapeKey(p: Panel): string {
  const shared: Record<string, unknown> = {};
  for (const k of Object.keys(p).sort()) if (!OWN_FIELDS.has(k as keyof Panel)) shared[k] = p[k as keyof Panel];
  shared.cfSelvedge = p.half?.cfSelvedge ?? null;
  return JSON.stringify(shared);
}

/** `dst` with `src`'s whole-front description (dst keeps its id, name, side, layout, notes and link). */
function copyShape(src: Panel, dst: Panel): Panel {
  const out: Panel = structuredClone(src);
  out.id = dst.id;
  out.name = dst.name;
  out.layout = dst.layout;
  out.notes = dst.notes;
  out.linkedTo = dst.linkedTo;
  out.half = dst.half ? { ...dst.half, cfSelvedge: src.half?.cfSelvedge ?? dst.half.cfSelvedge } : dst.half;
  return out;
}

export const isFront = (p: Panel) => p.template === 'front';

/** The other front of a linked pair, if both still point at each other. */
export function frontPartner(project: Project, panel: Panel): Panel | undefined {
  const id = panel.half?.pair;
  if (!id) return undefined;
  const other = project.panels.find((p) => p.id === id);
  return other?.half?.pair === panel.id ? other : undefined;
}

/**
 * After an edit, copy the whole-front description across each linked pair: from whichever front changed
 * (the left front when both did, or neither had a previous version).
 */
export function syncFrontPairs(prev: Project, next: Project): Project {
  let panels = next.panels;
  for (const a of next.panels) {
    if (a.half?.side !== 'left') continue;
    const b = frontPartner(next, a);
    if (!b) continue;
    const ka = shapeKey(a);
    const kb = shapeKey(b);
    if (ka === kb) continue;
    const prevB = prev.panels.find((p) => p.id === b.id);
    const bChanged = !!prevB && shapeKey(prevB) !== kb;
    const prevA = prev.panels.find((p) => p.id === a.id);
    const aChanged = !prevA || shapeKey(prevA) !== ka;
    const [src, dst] = bChanged && !aChanged ? [b, a] : [a, b];
    const copy = copyShape(src, dst);
    panels = panels.map((p) => (p.id === dst.id ? copy : p));
  }
  return panels === next.panels ? next : { ...next, panels };
}

// ---------- splitting and merging ----------

function mapRefs(refs: EdgeRef[], fn: (r: EdgeRef) => EdgeRef[]): EdgeRef[] {
  const out: EdgeRef[] = [];
  for (const r of refs.flatMap(fn)) if (!out.some((x) => JSON.stringify(x) === JSON.stringify(r))) out.push(r);
  return out;
}

function mapJoins(joins: Join[] | undefined, fn: (r: EdgeRef) => EdgeRef[]): Join[] | undefined {
  return joins?.map((j) => ({ ...j, edges: mapRefs(j.edges, fn), partner: mapRefs(j.partner, fn) }));
}

/**
 * Split a front into Left front + Right front. The left front keeps the panel's id (so links and joins to the
 * front stay valid); joins on the front's left side move to the right front (its side edge as seen from the RS),
 * joins on the lower edge, top or neckline go to both fronts.
 */
export function splitFront(project: Project, frontId: Id, notes: string[] = []): Project {
  const front = project.panels.find((p) => p.id === frontId);
  if (!front || front.half) return project;
  const rightId = newId('panel');
  const flat = { inTheRound: false, joinAt: null };
  const leftHalf: FrontHalf = { side: 'left', pair: rightId, cfSelvedge: DEFAULT_CF_SELVEDGE };
  const left: Panel = { ...structuredClone(front), ...flat, name: 'Left front', half: leftHalf };
  const right: Panel = { ...copyShape(left, { ...left, id: rightId, name: 'Right front', half: { side: 'right', pair: left.id, cfSelvedge: DEFAULT_CF_SELVEDGE } }), linkedTo: null };
  const panels = project.panels.flatMap((p) => (p.id === frontId ? [right, left] : [p]));
  const joins = mapJoins(project.joins, (r) => {
    if (r.panelId !== frontId) return [r];
    if (r.edge.kind === 'side') return [{ ...r, panelId: r.edge.side === 'left' ? rightId : frontId }];
    return [r, { ...r, panelId: rightId }];
  });
  notes.push(`${front.name} split into Left front and Right front (a mirrored pair: edit either, the other follows).`);
  if (front.inTheRound || front.joinAt) notes.push(`${front.name} was worked in the round; the fronts are flat.`);
  return { ...project, panels, joins };
}

/** Merge a left/right pair back into one front (the left front's description wins). */
export function mergeFronts(project: Project, leftId: Id, rightId: Id, notes: string[] = []): Project {
  const left = project.panels.find((p) => p.id === leftId);
  const right = project.panels.find((p) => p.id === rightId);
  if (!left || !right) return project;
  if (shapeKey(left) !== shapeKey(right)) notes.push(`${right.name} differed from ${left.name}; the merged front follows ${left.name}.`);
  const merged: Panel = { ...left, name: 'Front', half: null };
  const panels = project.panels.filter((p) => p.id !== rightId).map((p) => (p.id === leftId ? merged : p));
  const joins = mapJoins(project.joins, (r) => (r.panelId === rightId ? [{ ...r, panelId: leftId }] : [r]));
  notes.push(`${left.name} and ${right.name} merged into one Front.`);
  return { ...project, panels, joins };
}

/**
 * Make the panels match the front opening: cardigan → every whole front becomes a pair (and the body and sleeves
 * are worked flat); closed → every pair is merged back. Returns what changed.
 */
export function matchOpening(project: Project, opening: FrontOpening = project.garment.opening): { project: Project; notes: string[] } {
  const notes: string[] = [];
  let p = project;
  if (opening === 'cardigan') {
    for (const f of project.panels.filter((x) => isFront(x) && !x.half)) p = splitFront(p, f.id, notes);
  } else {
    const done = new Set<Id>();
    for (const l of p.panels.filter((x) => x.half?.side === 'left')) {
      const r = frontPartner(p, l) ?? p.panels.find((x) => x.half?.side === 'right' && !done.has(x.id) && isFront(x));
      if (r && !done.has(r.id)) {
        done.add(r.id);
        p = mergeFronts(p, l.id, r.id, notes);
      } else p = { ...p, panels: p.panels.map((x) => (x.id === l.id ? { ...x, half: null, name: 'Front' } : x)) };
      done.add(l.id);
    }
    for (const r of p.panels.filter((x) => x.half && !done.has(x.id))) {
      p = { ...p, panels: p.panels.map((x) => (x.id === r.id ? { ...x, half: null, name: 'Front' } : x)) };
    }
  }
  return { project: p, notes };
}

/** Everything flat in cardigan mode: body panels joined in the round become flat (sleeves keep their own choice). */
export function flattenForCardigan(project: Project, notes: string[] = []): Project {
  const panels = project.panels.map((p) => {
    if (p.template !== 'back' || (!p.inTheRound && !p.joinAt)) return p;
    notes.push(`${p.name} is worked flat (cardigan).`);
    return { ...p, inTheRound: false, joinAt: null };
  });
  return { ...project, panels };
}

export function unlinkFronts(project: Project, panelId: Id): Project {
  const panel = project.panels.find((p) => p.id === panelId);
  const other = panel && frontPartner(project, panel);
  if (!panel || !other) return project;
  const unlink = (p: Panel): Panel => ({ ...p, half: { ...p.half!, pair: null } });
  return { ...project, panels: project.panels.map((p) => (p.id === panel.id || p.id === other.id ? unlink(p) : p)) };
}

/** Link two fronts of opposite sides; `from` is copied to the other. */
export function linkFronts(project: Project, fromId: Id, toId: Id): Project {
  const from = project.panels.find((p) => p.id === fromId);
  const to = project.panels.find((p) => p.id === toId);
  if (!from?.half || !to?.half || from.half.side === to.half.side) return project;
  const a: Panel = { ...from, half: { ...from.half, pair: to.id } };
  const b: Panel = copyShape(a, { ...to, half: { ...to.half, pair: from.id } });
  return { ...project, panels: project.panels.map((p) => (p.id === a.id ? a : p.id === b.id ? b : p)) };
}
