// Starting a garment: the construction method, front, neckline and sleeve chosen together (New garment dialog,
// Garment tab), and the pieces, joins and edge defaults each choice makes. Nothing new is stored: the choices are
// read back from the pieces (garmentChoice), so older projects show their method without a migration.

import { yokePanel, yokeWithNeck } from './contiguous';
import { OFF_SHOULDER_NEEDS, raglanPanel } from './raglan';
import { generateBodyAndSleeves } from './contiguousGarment';
import { applyEdgeTreatments, edgesForNeckline } from './edgeTreatments';
import { ensureEstimates } from './estimates';
import { conformToGarment, CONTIGUOUS_TAG, RAGLAN_TAG, setConstruction } from './garment';
import { dropPanelFromJoins } from './joins';
import type { EdgeRef, Join, NecklineShape, Panel, Project, SleeveLength } from './model';
import { dim, newId } from './model';
import { applyStrap, BOAT_STRAP, defaultStrapWidth, setStrap } from './strap';
import { sleeveLengthNeeds, sleeveLengthOf, SLEEVE_LENGTHS, sleeveName, withSleeveLength } from './sleeveLength';
import { backNeckFor, bodice, bodiceNeck, FRONT_NECKS, sleeve, TEMPLATE_MEASUREMENTS, topDownTop, type TemplateId } from './templates';
import { garmentChoice, isBodice, isGarmentPiece, isSleeve, isYokeMethod, lengthFor, necklineFor, necklineLabel, SLEEVES, sleevesFor, withEasePreset, type GarmentChoice, type GarmentMethod, type GarmentSpec, type SleeveChoice } from './garmentInfo';

export * from './garmentInfo';

// ---------- pieces ----------

const wp = (p: Panel, name: string) => p.waypoints.find((w) => w.name === name)!.id;
const side = (p: Panel, s: 'left' | 'right', from: string, to: string): EdgeRef => ({ panelId: p.id, edge: { kind: 'side', side: s, from: wp(p, from), to: wp(p, to) } });
const seam = (name: string, edges: EdgeRef[], partner: EdgeRef[], note: string): Join => ({ id: newId('join'), name, tag: 'seam', edges, partner, ratio: null, note });

function sleeveFor(choice: SleeveChoice, method: GarmentChoice['method'], length: SleeveLength): Panel | null {
  if (choice === 'none' || choice === 'contiguous' || choice === 'raglan') return null;
  return sleeve(choice, method === 'top-down' ? 'top-down' : 'bottom-up', lengthFor(choice, length));
}

/** Measurements the garment's sleeves need at `length` (template estimates plus the length's own). */
const sleeveNeeds = (length: SleeveLength) => [...TEMPLATE_MEASUREMENTS.sleeve, ...sleeveLengthNeeds(length)];

/** The pieces and joins a panel method makes (whole front; the opening is applied afterwards). */
function panelPieces(method: 'seamed' | 'top-down', neckline: NecklineShape, sleeveChoice: SleeveChoice, length: SleeveLength): { panels: Panel[]; joins: Join[]; templates: TemplateId[] } {
  let back: Panel;
  let front: Panel;
  const joins: Join[] = [];
  if (method === 'top-down') {
    const top = topDownTop({ neckline, joinInRound: true, shoulderSlope: 'shortrows', backNeck: 'straight' });
    [back, front] = top.panels;
    joins.push(...top.joins);
  } else {
    back = bodice('back', { direction: 'bottom-up', neckline });
    front = bodice('front', { direction: 'bottom-up', neckline });
    joins.push(
      // One join per side (as worn): the front's left edge meets the back's right edge, seen from the RS.
      seam('Left side seam', [side(front, 'right', 'hem', 'underarm')], [side(back, 'left', 'hem', 'underarm')], 'Mattress stitch, hem to underarm.'),
      seam('Right side seam', [side(front, 'left', 'hem', 'underarm')], [side(back, 'right', 'hem', 'underarm')], 'Mattress stitch, hem to underarm.'),
      seam('Shoulder seams', [{ panelId: front.id, edge: { kind: 'top' } }], [{ panelId: back.id, edge: { kind: 'top' } }], 'Three-needle bind-off or sewn.'),
    );
  }
  const panels = [back, front];
  // No sleeve-cap seam: the cap is drafted with ease over the armhole, which a seam join would flag in every size.
  const sl = sleeveFor(sleeveChoice, method, length);
  if (sl) panels.push(sl);
  return { panels, joins, templates: sl ? ['back', 'front', 'sleeve'] : ['back', 'front'] };
}

/** Add the pieces of `method` to the project (its opening and edge settings applied). */
function addPieces(p: Project, method: GarmentMethod, neckline: NecklineShape, sleeveChoice: SleeveChoice, length: SleeveLength, notes: string[]): Project {
  if (method === 'blank') return p;
  if (isYokeMethod(method)) {
    const shape = necklineFor(method, neckline, p.garment.opening);
    const q = ensureEstimates(p, [...TEMPLATE_MEASUREMENTS.yoke, ...(shape === 'off-shoulder' ? OFF_SHOULDER_NEEDS : [])]).project;
    // Off-shoulder is always a raglan yoke; on the Modified card its back is raised.
    const yoke = method === 'raglan' ? raglanPanel(shape) : shape === 'off-shoulder' ? raglanPanel(shape, 'neck') : yokePanel(shape, method === 'modified-raglan' ? 'neck' : 'back');
    return generateBodyAndSleeves({ ...q, panels: [...q.panels, yoke] }, notes, length);
  }
  const set = panelPieces(method, neckline, sleeveChoice, length);
  const names = set.templates.flatMap((t) => (t === 'sleeve' ? sleeveNeeds(length) : TEMPLATE_MEASUREMENTS[t]));
  const q = ensureEstimates(p, [...new Set(names)]).project;
  return conformToGarment({ ...q, panels: [...q.panels, ...set.panels], joins: [...(q.joins ?? []), ...set.joins] }, notes);
}

/**
 * A new garment on `base`'s sizes, measurements and gauge: its pieces replaced by those of `spec`, with the
 * opening, ease preset and edge treatments set (the neckband and band strips made when the edges call for them).
 */
export function buildGarment(base: Project, spec: GarmentSpec): Project {
  const construction = isYokeMethod(spec.method) ? 'contiguous' : 'panels';
  let p: Project = setConstruction({ ...base, panels: [], joins: [], garment: { construction: base.garment.construction, opening: spec.opening } }, construction);
  p = withMethodTags(p, spec.method);
  p = { ...p, ease: withEasePreset(p.ease, spec.ease), edges: spec.edges ? structuredClone(spec.edges) : undefined, cardigan: undefined };
  p = addPieces(p, spec.method, spec.neckline, spec.sleeve, lengthFor(spec.sleeve, spec.sleeveLength ?? 'long'), []);
  // A boat neck's 3 cm is the strap (`base`'s strap setting, if any, isn't carried over).
  p = applyStrap(p);
  // Only an off-shoulder band is knit with the panel: another neckline (the method's fallback too) takes the strip,
  // and an off-shoulder one with a neckband still picked up later gets its band pre-set (the dialog has done it).
  const shape = garmentChoice(p).neckline;
  if (p.edges) {
    const nb = p.edges.neckband;
    p = { ...p, edges: edgesForNeckline(p.edges, shape, shape === 'off-shoulder' && nb.enabled && nb.method !== 'with-panel' ? 'round' : shape) };
  }
  return p.edges ? applyEdgeTreatments(p, [], { create: true }) : p;
}

/** Tags the method adds: "contiguous" for the contiguous yoke, "raglan" for both raglans (each removed again when
 * switching away, as construction tags are). */
function withMethodTags(p: Project, method: GarmentMethod): Project {
  const tag = method === 'contiguous' ? CONTIGUOUS_TAG : method === 'raglan' || method === 'modified-raglan' ? RAGLAN_TAG : null;
  const tags = p.tags.filter((t) => t !== CONTIGUOUS_TAG && t !== RAGLAN_TAG);
  return { ...p, tags: tag ? [...tags, tag] : tags };
}

/**
 * Switch an existing garment to another method: its bodices, sleeves and yoke are replaced by the new method's
 * pieces (neckline and sleeve kept where the new method has them); other pieces, sizes, gauge, ease and edge
 * settings stay. `notes` says what changed. One project → one undo step.
 */
export function changeMethod(p: Project, method: Exclude<GarmentMethod, 'blank'>, notes: string[] = []): Project {
  const now = garmentChoice(p);
  if (now.method === method) return p;
  const old = p.panels.filter(isGarmentPiece);
  let joins = p.joins ?? [];
  for (const x of old) joins = dropPanelFromJoins(joins, x.id);
  let q: Project = { ...p, panels: p.panels.filter((x) => !isGarmentPiece(x)), joins };
  q = withMethodTags(setConstruction(q, isYokeMethod(method) ? 'contiguous' : 'panels'), method);
  const sleeveChoice = sleevesFor(method).includes(now.sleeve) ? now.sleeve : isYokeMethod(method) ? sleevesFor(method)[0] : 'set-in';
  const length = lengthFor(sleeveChoice, now.sleeveLength);
  const added: string[] = [];
  q = addPieces(q, method, now.neckline, sleeveChoice, length, added);
  const fresh = q.panels.filter((x) => !p.panels.some((o) => o.id === x.id));
  const kept = q.panels.filter((x) => p.panels.some((o) => o.id === x.id));
  q = { ...q, panels: [...fresh, ...kept] }; // the garment first, as a new garment lists it
  if (old.length) notes.push(`Replaces ${old.map((x) => x.name).join(', ')}.`);
  if (fresh.length) notes.push(`Adds ${fresh.map((x) => x.name).join(', ')}.`);
  if (kept.length) notes.push(`Keeps ${kept.map((x) => x.name).join(', ')}.`);
  // Between yoke methods the sleeves are part of the method: no note.
  if (sleeveChoice !== now.sleeve && now.sleeve !== 'none' && !isYokeMethod(now.method)) notes.push(`Sleeves become ${SLEEVES.find((s) => s.id === sleeveChoice)!.label.toLowerCase()}: this method has no ${SLEEVES.find((s) => s.id === now.sleeve)!.label.toLowerCase()}.`);
  if (length !== now.sleeveLength && now.sleeve !== 'none') notes.push(`Sleeves become ${lengthLabel(length)}: these sleeves can’t be ${lengthLabel(now.sleeveLength)}.`);
  if (necklineFor(method, now.neckline, q.garment.opening) !== now.neckline) {
    notes.push(`The neckline becomes round: this method has no ${necklineLabel(now.neckline)} neck.`);
    if (q.edges) q = { ...q, edges: edgesForNeckline(q.edges, 'round', now.neckline) };
  }
  // The new bodices follow the strap setting (a boat neck gets one).
  q = applyStrap(q, {}, notes);
  notes.push('Sizes, gauge, ease and edge settings stay. Undo goes back.');
  return q.edges ? applyEdgeTreatments(q) : q;
}

/**
 * The neckline (fronts, backs and the yoke) set to a shape's defaults. The front takes the shape; the back takes
 * its matching back neck (a boat neck's wide back, a round back neck otherwise; a straight back stays straight),
 * and both tops follow the opening so the shoulder seams match.
 */
export function setNeckline(p: Project, shape: NecklineShape): Project {
  const from = garmentChoice(p).neckline;
  if (shape === 'off-shoulder' && p.panels.some((x) => x.yoke)) p = ensureEstimates(p, OFF_SHOULDER_NEEDS).project;
  // To or from a boat neck the strap takes the new shape's default too (3 cm, or the shape's own strap): unlinked
  // here, set again below.
  const strap = p.garment.strap;
  const restrap = !!strap && (shape === 'boat') !== (from === 'boat');
  if (restrap) p = setStrap(p, null);
  const panels = p.panels.map((x): Panel => {
    if (x.yoke) return { ...x, yoke: yokeWithNeck(x.yoke, shape) };
    if (!isBodice(x)) return x;
    const n = x.template === 'front' ? { ...FRONT_NECKS[bodiceNeck(shape)], shape: bodiceNeck(shape) } : backNeckFor(shape);
    const neckline = x.neckline && { ...x.neckline, shape: n.shape, width: dim(n.width), depth: dim(n.depth), centreWidth: dim(n.centre) };
    const waypoints = x.waypoints.map((w) => (w.name === 'neck_side' ? { ...w, height: dim(`shoulder.height + ${n.rise}`), width: dim(n.top) } : w));
    return { ...x, neckline, waypoints };
  });
  // The strap keeps driving the new shape's neck (a new boat neck gets a 3 cm strap).
  let q: Project = { ...p, panels };
  if (restrap) q = setStrap(q, { width: shape === 'boat' ? dim(BOAT_STRAP) : defaultStrapWidth(q), gives: strap!.gives });
  else q = applyStrap(q, { reset: true });
  const os = (s: NecklineShape) => s === 'off-shoulder';
  if (!q.edges || os(shape) === os(from)) return q;
  // An off-shoulder band is knit first with the yoke: the neckband strip goes (with its joins). Back to another
  // neckline, the default neckband strip is made again.
  const strips = os(shape) ? q.panels.filter((x) => x.edge === 'neckband') : [];
  let joins = q.joins ?? [];
  for (const x of strips) joins = dropPanelFromJoins(joins, x.id);
  const r: Project = { ...q, panels: q.panels.filter((x) => !strips.includes(x)), joins, edges: edgesForNeckline(q.edges, shape, from) };
  return applyEdgeTreatments(r, [], { create: !os(shape) });
}

/** Replace the sleeve panels (not a contiguous yoke's) with another type; 'none' removes them. */
export function setSleeve(p: Project, choice: SleeveChoice, notes: string[] = []): Project {
  const c = garmentChoice(p);
  if (isYokeMethod(c.method) || choice === c.sleeve) return p;
  const old = p.panels.filter((x) => isSleeve(x) && !x.fromYoke);
  // Joins made for the old sleeves (cap seams…) go with them.
  const joins = (p.joins ?? []).filter((j) => ![...j.edges, ...j.partner].some((r) => old.some((x) => x.id === r.panelId)));
  let q: Project = { ...p, panels: p.panels.filter((x) => !old.includes(x)), joins };
  const length = lengthFor(choice, c.sleeveLength);
  const sl = sleeveFor(choice, c.method, length);
  if (sl) {
    q = ensureEstimates(q, sleeveNeeds(length)).project;
    q = { ...q, panels: [...q.panels, sl] };
  }
  if (old.length) notes.push(`Replaces ${old.map((x) => x.name).join(', ')}.`);
  if (sl) notes.push(`Adds ${sl.name}.`);
  if (sl && length !== c.sleeveLength && c.sleeve !== 'none') notes.push(`${SLEEVES.find((s) => s.id === choice)!.label} sleeves can’t be ${lengthLabel(c.sleeveLength)}: made ${lengthLabel(length)}.`);
  return conformToGarment(q);
}

/** The sleeve templates' long-sleeve names (a sleeve still called one of these, with its length, is renamed). */
const SLEEVE_BASE_NAMES = ['Sleeve', 'Sleeve (drop shoulder)', 'Sleeve (straight)'];

const lengthLabel = (l: SleeveLength) => (l === 'cap' ? 'cap sleeves' : SLEEVE_LENGTHS.find((x) => x.id === l)!.label.toLowerCase());

/**
 * All the garment's sleeves (a contiguous yoke's too) at another length: underarm height and cuff width set from
 * it, everything else kept; a sleeve still named for its old length is renamed. Sleeves redrawn by hand are left.
 */
export function setSleeveLength(p: Project, length: SleeveLength, notes: string[] = []): Project {
  const c = garmentChoice(p);
  const to = lengthFor(c.sleeve, length);
  if (c.sleeve === 'none' || to !== length) return p;
  const skipped: string[] = [];
  const changed: string[] = [];
  const panels = p.panels.map((x) => {
    if (!isSleeve(x) || sleeveLengthOf(x) === length) return x;
    const next = withSleeveLength(x, length);
    if (!next) {
      skipped.push(x.name);
      return x;
    }
    const base = x.name.replace(new RegExp(`^${SLEEVE_LENGTHS.find((l) => l.id === sleeveLengthOf(x))!.prefix} (.)`), (_, ch: string) => ch.toUpperCase());
    const renamed = SLEEVE_BASE_NAMES.includes(base) && sleeveName(base, sleeveLengthOf(x)) === x.name ? sleeveName(base, length) : x.name;
    changed.push(x.name);
    return { ...next, name: renamed };
  });
  if (changed.length) notes.push(`Sets ${changed.join(', ')} to ${lengthLabel(length)}: the underarm height and the cuff width follow; other edits are kept.`);
  if (skipped.length) notes.push(`Leaves ${skipped.join(', ')} as drawn (no cuff and underarm points to set).`);
  return ensureEstimates({ ...p, panels }, sleeveLengthNeeds(length)).project;
}
