// The rest of a contiguous garment: body and sleeves that continue from the yoke's held stitches, as ordinary
// top-down panels. Their widths at the underarm are the `yoke.*` names (held stitches + underarm cast-on), so they
// follow the yoke in every size; everything else is the usual bodice / sleeve shaping and can be edited freely.
// Made only when the knitter asks (never on a setting change).

import { yokePanel } from './contiguous';
import { conformToGarment } from './garment';
import type { EdgeRef, Join, Panel, Project } from './model';
import { defaultAutoMethod, defaultBust, newId, newPanel, newSegment, newWaypoint } from './model';
import { ensureEstimates } from './estimates';

export type YokeRole = NonNullable<Panel['fromYoke']>;
export const YOKE_ROLES: YokeRole[] = ['back', 'front', 'leftSleeve', 'rightSleeve'];
const ROLE_NAMES: Record<YokeRole, string> = { back: 'Back', front: 'Front', leftSleeve: 'Left sleeve', rightSleeve: 'Right sleeve' };

/** Measurements the generated panels use that a project may only have as estimates. */
const NEEDS = ['waist_to_underarm', 'waist_shift', 'hps_to_apex', 'apex_to_apex', 'underarm_co'];

function body(kind: 'back' | 'front', cardigan: boolean): Panel {
  const p = newPanel(ROLE_NAMES[kind]);
  p.template = kind;
  p.fromYoke = kind;
  p.direction = 'top-down';
  p.selvedge = { left: 0, right: 0 }; // the stitches continue from the yoke (and the underarm cast-on)
  p.inTheRound = !cardigan;
  p.rounding.parity = 'start'; // the yoke sets the top count; every change below it is even
  const shift = kind === 'back' ? '- waist_shift' : '+ waist_shift';
  const hem = newWaypoint('hem', 0, 'hem_circ / 2 + ease / 2');
  const waist = newWaypoint('waist', 'hem_drop', `waist / 2 + ease / 2 ${shift}`);
  const underarm = newWaypoint('underarm', 'waist.height + waist_to_underarm', kind === 'back' ? 'yoke.back_w' : 'yoke.front_w');
  p.waypoints = [hem, waist, underarm];
  p.segments = [newSegment(hem.id), newSegment(waist.id)];
  if (kind === 'front') {
    // Bust point measured from the top: the front of the yoke is worked from the neck point (HPS) to the split.
    const b = defaultBust();
    b.apexHeight = { expr: 'underarm.height + yoke.depth - (hps_to_apex - bust_apex_corr)', overrides: {} };
    b.sideWidth = false; // the underarm width is set by the yoke; short rows add the length
    b.vertical = { ...b.vertical, top: { expr: 'underarm.height - 2', overrides: {} } };
    p.bust = b;
  }
  p.notes = `Continues from the yoke's held body stitches plus half the underarm cast-on at each side (${kind}).`;
  return p;
}

function sleevePanel(side: 'leftSleeve' | 'rightSleeve', cardigan: boolean): Panel {
  const p = newPanel(ROLE_NAMES[side]);
  p.template = 'sleeve-contiguous';
  p.fromYoke = side;
  p.direction = 'top-down';
  p.selvedge = { left: 0, right: 0 };
  p.inTheRound = !cardigan; // cardigans: everything flat by default
  p.rounding.parity = 'start';
  const cuff = newWaypoint('cuff', 0, 'wrist + ease.wrist');
  const underarm = newWaypoint('underarm', 'arm_length', 'yoke.sleeve_w');
  p.waypoints = [cuff, underarm];
  p.segments = [newSegment(cuff.id, { ...defaultAutoMethod(), align: 'center' })];
  p.notes = 'Continues from the yoke’s held sleeve stitches plus the underarm cast-on.';
  return p;
}

/** Which body and sleeve panels the yoke still lacks. */
export function missingYokePanels(project: Project): YokeRole[] {
  const have = new Set(project.panels.map((p) => p.fromYoke).filter(Boolean));
  // A cardigan's front is a pair; either half counts.
  return YOKE_ROLES.filter((r) => !have.has(r));
}

function uniqueName(project: Project, name: string): string {
  const names = new Set(project.panels.map((p) => p.name));
  if (!names.has(name)) return name;
  for (let i = 2; ; i++) if (!names.has(`${name} ${i}`)) return `${name} ${i}`;
}

/**
 * Add the yoke (if there is none) and the body and sleeve panels it lacks, with joins recording that they continue
 * from the held stitches and share the underarm cast-on. Cardigans get a mirrored Left / Right front pair.
 */
export function generateBodyAndSleeves(project: Project, notes: string[] = []): Project {
  let p = ensureEstimates(project, NEEDS).project;
  let yoke = p.panels.find((x) => x.yoke);
  if (!yoke) {
    yoke = { ...yokePanel(), name: uniqueName(p, 'Yoke') };
    p = { ...p, panels: [...p.panels, yoke] };
    notes.push('Added a contiguous yoke.');
  }
  const cardigan = p.garment.opening === 'cardigan';
  const made: Partial<Record<YokeRole, Panel>> = {};
  for (const role of missingYokePanels(p)) {
    const panel = role === 'back' || role === 'front' ? body(role, cardigan) : sleevePanel(role, cardigan);
    panel.name = uniqueName(p, panel.name);
    made[role] = panel;
    p = { ...p, panels: [...p.panels, panel] };
  }
  if (!Object.keys(made).length) return project;
  notes.push(`Added ${Object.values(made).map((x) => x.name).join(', ')} from the yoke's held stitches.`);

  const top = (x: Panel): EdgeRef => ({ panelId: x.id, edge: { kind: 'top' } });
  const held = (part: 'leftSleeve' | 'body' | 'rightSleeve'): EdgeRef => ({ panelId: yoke!.id, edge: { kind: 'held', part } });
  const joins: Join[] = [];
  const live = (name: string, from: EdgeRef, to: Panel[], note: string): Join => ({ id: newId('join'), name, tag: 'live', edges: [from], partner: to.map(top), ratio: null, note });
  const bodies = [made.back, made.front].filter((x): x is Panel => !!x);
  if (bodies.length) joins.push(live('Body continues from the yoke', held('body'), bodies, 'The held body stitches continue down the back and front(s), with the underarm cast-on between them.'));
  if (made.leftSleeve) joins.push(live('Left sleeve continues from the yoke', held('leftSleeve'), [made.leftSleeve], 'The held sleeve stitches, plus the underarm cast-on.'));
  if (made.rightSleeve) joins.push(live('Right sleeve continues from the yoke', held('rightSleeve'), [made.rightSleeve], 'The held sleeve stitches, plus the underarm cast-on.'));
  const sleeves = [made.leftSleeve, made.rightSleeve].filter((x): x is Panel => !!x);
  if (bodies.length && sleeves.length) {
    joins.push({
      id: newId('join'),
      name: 'Underarm cast-on',
      tag: 'caston',
      edges: bodies.map(top),
      partner: sleeves.map(top),
      ratio: null,
      note: 'Cast on at each underarm when the sleeves are put on hold (half on the back, half on the front); the sleeve takes the same stitches.',
    });
  }
  p = { ...p, joins: [...(p.joins ?? []), ...joins] };
  return conformToGarment(p, notes);
}
