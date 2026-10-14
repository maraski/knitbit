// The measurement dictionary: every body measurement of the sizing table with its category, body region,
// a short definition and the tooltip text shown in the UI. All values are body measurements in cm.

import type { BodyRegion, Measurement } from './model';

export type { BodyRegion };
export type MeasurementCategory = 'circumference' | 'width' | 'length' | 'bust' | 'legacy';

export interface MeasurementDef {
  name: string;
  label: string;
  category: MeasurementCategory;
  kind: Measurement['kind'];
  region: BodyRegion;
  definition: string; // short, for labels and lists
  tooltip: string; // full text, shown on hover
  /** Kept only for reference; never used in calculations. Unmapped by default in the importer. */
  legacy?: boolean;
}

export const CATEGORY_LABELS: Record<MeasurementCategory, string> = {
  circumference: 'Circumference',
  width: 'Widths',
  length: 'Lengths and drops',
  bust: 'Bust shaping',
  legacy: 'Legacy (reference only)',
};

const HPS = 'HPS = high point shoulder, where the side of the neck meets the shoulder.';

function def(
  name: string,
  label: string,
  category: MeasurementCategory,
  region: BodyRegion,
  definition: string,
  tooltip: string,
  extra: Partial<MeasurementDef> = {},
): MeasurementDef {
  const kind: Measurement['kind'] = category === 'circumference' ? 'circumference' : 'length';
  return { name, label, category, kind, region, definition, tooltip, ...extra };
}

const bustCup = (cup: string, letters: string) =>
  def(
    `bust_${cup}_cup`,
    `Bust (${letters} cup)`,
    'circumference',
    'upper',
    `Fullest part of the bust, ${letters} cup`,
    `Circumference at the fullest part of the bust, for cup size ${letters}. Cup sizes are based on modern bra cup sizing.`,
  );

const dartHeight = (cup: string, letters: string) =>
  def(
    `dart_height_${cup}`,
    `Dart height (${letters} cup)`,
    'bust',
    'upper',
    `Suggested horizontal-dart height, ${letters} cup`,
    `Suggested height to add with horizontal bust darts for cup size ${letters}, based on volume and assuming some width is also added at the front.`,
  );

const apexToApex = (letter: string) =>
  def(
    `apex_to_apex_${letter}`,
    `Apex to apex (${letter.toUpperCase()} cup)`,
    'bust',
    'upper',
    `Horizontal width between the apexes, ${letter.toUpperCase()} cup`,
    `Horizontal width between the bust apexes, for cup size ${letter.toUpperCase()}.`,
  );

export const DICTIONARY: MeasurementDef[] = [
  // ---- circumference ----
  def('upper_chest', 'Upper chest', 'circumference', 'upper', 'Chest at underarm level', 'Circumference of the chest at underarm level.'),
  bustCup('ab', 'A/B'),
  bustCup('cd', 'C/D'),
  bustCup('ef', 'E/F'),
  bustCup('gh', 'G/H'),
  def('waist', 'Waist', 'circumference', 'lower', 'Natural waist', 'Circumference at the natural waist.'),
  def('high_hip', 'High hip', 'circumference', 'lower', 'At the hip bones', 'Circumference at about the level of the hip bones.'),
  def('hip_seat_straight', 'Hip / seat (straight)', 'circumference', 'lower', 'Fullest part of the seat, straight figure', 'Circumference at the fullest part of the seat, for a straighter figure.'),
  def('hip_seat_curvy', 'Hip / seat (curvy)', 'circumference', 'lower', 'Fullest part of the seat, curvy figure', 'Circumference at the fullest part of the seat, for a curvier figure.'),
  def('neck_base', 'Neck base', 'circumference', 'upper', 'Around the base of the neck', 'Circumference around the base of the neck. Used as a check for neckbands.'),
  def('shoulder_girth', 'Shoulder girth', 'circumference', 'upper', 'Around the shoulder area', 'Circumference measure of the shoulder area.'),
  def(
    'scye_circumference',
    'Scye circumference',
    'circumference',
    'upper',
    'Around the armhole',
    'From the underarm to the shoulder point and back to the underarm. A sanity check for set-in sleeves.',
  ),
  def('bicep', 'Bicep', 'circumference', 'sleeves', 'Largest part of the upper arm', 'Circumference at the largest part of the upper arm.'),
  def(
    'wrist',
    'Wrist',
    'circumference',
    'sleeves',
    'At the wrist bone',
    'Circumference at the wrist bone. Garments need wearing ease here so the cuff fits over the hand.',
  ),

  // ---- widths ----
  def('back_neck_width', 'Back neck width', 'width', 'upper', 'Straight across the back neck', `Straight across between where the neck meets the shoulder on each side. ${HPS}`),
  def('back_shoulder_width', 'Back shoulder width', 'width', 'upper', 'Shoulder point to shoulder point', 'Between the shoulder points, straight across the back.'),
  def(
    'back_shoulder_width_broad',
    'Back shoulder width (broad)',
    'width',
    'upper',
    'Shoulder point to shoulder point, broad back',
    'Between the shoulder points, straight across the back, for a broader back.',
  ),
  def('cross_back', 'Cross back', 'width', 'upper', 'Across the back between the break points', 'Width across the back between the break points (the top of the arm/torso crease).'),
  def(
    'cross_back_broad',
    'Cross back (broad)',
    'width',
    'upper',
    'Across the back between the break points, broad back',
    'Width across the back between the break points (the top of the arm/torso crease), for a broader back.',
  ),
  def('cross_front', 'Cross front', 'width', 'upper', 'Across the front between the break points', 'Width across the front between the break points (the top of the arm/torso crease).'),

  // ---- lengths and drops ----
  def('hps_to_apex', 'HPS to apex', 'length', 'upper', 'HPS to the bust apex', `From the HPS to the bust apex. ${HPS}`),
  def('back_waist_length', 'Back waist length', 'length', 'upper', 'Cervical bone to waist', 'From the cervical bone at the back of the neck to the waist.'),
  def('armhole_depth', 'Armhole depth', 'length', 'upper', 'Shoulder point to underarm, vertical', 'Vertical distance from the shoulder point to the underarm.'),
  def('shoulder_drop', 'Shoulder drop', 'length', 'upper', 'HPS level to shoulder point, vertical', `Vertical distance from the HPS level down to the shoulder point. ${HPS}`),
  def('back_neck_drop', 'Back neck drop', 'length', 'upper', 'HPS level to cervical bone, vertical', `Vertical distance from the HPS level down to the cervical bone. ${HPS}`),
  def('front_neck_drop', 'Front neck drop', 'length', 'upper', 'HPS level to collarbone at centre front, vertical', `Vertical distance from the HPS level down to the collarbone at centre front. ${HPS}`),
  def('waist_to_high_hip', 'Waist to high hip', 'length', 'lower', 'Waist to high hip, at the side', 'From the waist to the high hip, measured at the side of the body.'),
  def('waist_to_full_hip', 'Waist to full hip', 'length', 'lower', 'Waist to full hip, at the side', 'From the waist to the full hip (seat), measured at the side of the body.'),
  def('arm_length', 'Arm length', 'length', 'sleeves', 'Underarm to wrist', 'From the underarm to the wrist with the arm straight.'),

  // ---- bust shaping data ----
  dartHeight('ab', 'A/B'),
  dartHeight('cd', 'C/D'),
  dartHeight('ef', 'E/F'),
  dartHeight('gh', 'G/H'),
  apexToApex('b'),
  apexToApex('d'),
  apexToApex('f'),
  apexToApex('h'),

  // ---- legacy (reference only) ----
  def('legacy_bust_merged', 'Legacy bust (merged)', 'legacy', 'upper', 'Old table: bust', 'From the old sizing table, kept for reference only. Not used in calculations.', { kind: 'circumference', legacy: true }),
  def('legacy_full_hip', 'Legacy full hip', 'legacy', 'lower', 'Old table: full hip', 'From the old sizing table, kept for reference only. Not used in calculations.', { kind: 'circumference', legacy: true }),
  def('legacy_cross_chest_back', 'Legacy cross chest/back', 'legacy', 'upper', 'Old table: cross chest/back', 'From the old sizing table, kept for reference only. Not used in calculations.', { legacy: true }),
  def('legacy_waist_to_armhole', 'Legacy waist to armhole', 'legacy', 'upper', 'Old table: waist to armhole', 'From the old sizing table, kept for reference only. Not used in calculations.', { legacy: true }),
];

const BY_NAME = new Map(DICTIONARY.map((d) => [d.name, d]));

export function dictionaryEntry(name: string): MeasurementDef | undefined {
  return BY_NAME.get(name);
}

/** Legacy columns: kept for reference, unmapped by default in the importer. */
export function isLegacyColumn(name: string): boolean {
  return !!BY_NAME.get(name)?.legacy || /^legacy_/.test(name);
}

/** Tooltip for any measurement: the dictionary text, else the measurement's own note. */
export function measurementTooltip(m: Pick<Measurement, 'name' | 'label' | 'note'>): string {
  const d = BY_NAME.get(m.name);
  if (d) return `${d.label}: ${d.tooltip}`;
  return m.note ? `${m.label}: ${m.note}` : m.label;
}

/** The column header of the size table that says where a row came from ("table" or "estimated"). */
export const SOURCE_COLUMN = 'source';

export function isEstimatedSource(value: string): boolean {
  return /estimat/i.test(value.trim());
}
