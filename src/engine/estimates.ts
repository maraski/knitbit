// Measurements a sizing table may lack, seeded as derived rules or graded estimates. Apart from seed.ts so adding a
// template (which tops up missing estimates) doesn't load the table-seeding code.

import { fitAliases } from './fit';
import { newMeasurement, type BodyRegion, type Measurement, type Project } from './model';

/**
 * Measurements the templates use that the sizing table derives rather than lists: seeded as editable expression
 * rules when every column they need is there and the name is not.
 */
export const DERIVED_FROM_NEW: Record<string, { label: string; expr: string; needs: string[]; note: string }> = {
  waist_to_underarm: {
    label: 'Waist to underarm',
    expr: 'back_neck_drop + back_waist_length - shoulder_drop - armhole_depth',
    needs: ['back_neck_drop', 'back_waist_length', 'shoulder_drop', 'armhole_depth'],
    note: 'Vertical distance from the waist up to the underarm: HPS → waist (back_neck_drop + back_waist_length) minus HPS → underarm (shoulder_drop + armhole_depth).',
  },
};

export function derivedMeasurement(name: string): Measurement {
  const d = DERIVED_FROM_NEW[name];
  return { ...newMeasurement(name, d.label, 'length'), rule: { type: 'expression', expr: d.expr }, note: d.note };
}

/**
 * Measurements not in the sizing table, seeded as graded estimates (cm). All flagged `estimate`
 * so the UI can mark them for checking. Expressions refer to table columns. The new sizing table has most of these;
 * the estimates are only seeded for tables that lack them (e.g. older tables).
 */
export const ESTIMATED_MEASUREMENTS: { name: string; label: string; expr: string; note: string; region?: BodyRegion; /** Seeded only when a piece needs it (not with every new table). */ onDemand?: true }[] = [
  { name: 'back_shoulder_width', label: 'Back shoulder width', expr: 'round(cross_back + 3, 0.5)', note: 'Shoulder point to shoulder point across the back.' },
  { name: 'back_neck_width', label: 'Back neck width', expr: 'round(13 + upper_chest * 0.03, 0.5)', note: 'Width of the neck opening at the top of the back.' },
  { name: 'back_neck_drop', label: 'Back neck drop', expr: '2', note: 'Drop of the back neckline below the shoulder line.' },
  { name: 'front_neck_drop', label: 'Front neck drop', expr: 'round(5.5 + upper_chest * 0.02, 0.5)', note: 'Crew-neck depth below the shoulder line.' },
  { name: 'shoulder_drop', label: 'Shoulder drop', expr: 'round(1.5 + upper_chest * 0.012, 0.5)', note: 'Height difference between the neck side and the shoulder point.' },
  { name: 'hps_to_apex', label: 'HPS to apex', expr: 'round(20 + bust * 0.07, 0.5)', note: 'High point of shoulder down to the bust apex.' },
  { name: 'apex_to_apex', label: 'Apex to apex', expr: 'round(14 + bust * 0.04, 0.5)', note: 'Horizontal distance between bust points.' },
  { name: 'cap_height', label: 'Sleeve cap height', expr: 'round(armhole_depth * 0.65, 0.5)', note: 'Set-in sleeve cap height (not used by the set-in template, which fits the cap to the armhole).' },
  { name: 'underarm_co', label: 'Underarm cast-on', expr: 'round(upper_chest * 0.05, 0.5)', note: 'Width cast on at each underarm to join front and back (cm, front and back together: half each). Top-down, shoulders-first tops.' },
  { name: 'short_sleeve_length', label: 'Short sleeve length', expr: 'round(4 + bicep * 0.1, 0.5)', note: 'Underarm to the edge of a short sleeve, cuff band included.', region: 'sleeves' },
  { name: 'elbow_length', label: 'Underarm to elbow', expr: 'round(arm_length * 0.42, 0.5)', note: 'Underarm to the edge of an elbow-length sleeve, cuff band included.', region: 'sleeves' },
  { name: 'three_quarter_length', label: 'Three-quarter sleeve length', expr: 'round(arm_length * 0.7, 0.5)', note: 'Underarm to the edge of a three-quarter sleeve (mid forearm), cuff band included.', region: 'sleeves' },
  { name: 'cap_ease', label: 'Sleeve cap ease', expr: '1.5', note: 'How much longer the cap edge is than the armhole it is sewn into (cm, both sides together).' },
  {
    name: 'waist_shift',
    label: 'Waist shift (back → front)',
    expr: '(bust - waist) / 4',
    note: 'Share of the bust-to-waist narrowing taken by the back: back waist = waist/2 + ease/2 − waist_shift, front waist = waist/2 + ease/2 + waist_shift.',
  },
  // Off-shoulder necklines only (raglan.ts). Bodies vary a lot here: measure them.
  {
    name: 'off_shoulder_circ',
    label: 'Off-shoulder circumference',
    expr: 'round(upper_chest + bicep * 0.6, 0.5)',
    note: 'Arms down, around both upper arms and the torso at the height of an off-shoulder band.',
    region: 'upper',
    onDemand: true,
  },
  { name: 'off_shoulder_drop', label: 'Off-shoulder drop', expr: '5', note: 'Shoulder point down to the top edge of an off-shoulder band.', region: 'upper', onDemand: true },
];

/** The estimates a new table is seeded with; `all` adds those seeded only when a piece needs them. */
export function estimatedMeasurements(all = false): Measurement[] {
  return ESTIMATED_MEASUREMENTS.filter((e) => all || !e.onDemand).map((e) => ({
    ...newMeasurement(e.name, e.label),
    rule: { type: 'expression', expr: e.expr },
    estimate: true,
    note: e.note,
    ...(e.region ? { region: e.region } : {}),
  }));
}

/** Add any estimated measurements that are missing (e.g. when a template needs one an older project lacks). */
export function ensureEstimates(project: Project, names: string[]): { project: Project; added: string[] } {
  const have = new Set([...project.measurements.map((m) => m.name), ...Object.keys(fitAliases(project))]);
  const derived = Object.entries(DERIVED_FROM_NEW)
    .filter(([n, d]) => names.includes(n) && !have.has(n) && d.needs.every((x) => have.has(x)))
    .map(([n]) => derivedMeasurement(n));
  const add = [...derived, ...estimatedMeasurements(true).filter((m) => names.includes(m.name) && !have.has(m.name))];
  if (!add.length) return { project, added: [] };
  return { project: { ...project, measurements: [...project.measurements, ...add] }, added: add.map((m) => m.name) };
}
