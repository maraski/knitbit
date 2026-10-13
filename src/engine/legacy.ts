// Old (pre-Ysolda) measurement names and the schema 1 → 2 migration that maps them to the new ones.
// Every change is reported as a readable note; nothing is changed silently.

import { dictionaryEntry } from './dictionary';
import { bustColumn, closestCup, cupLabel, CUPS, CUSTOM_BUST, TYPICAL_BUST_DIFFERENCE } from './fit';
import { renameMeasurement } from './grading';
import { resolveMeasurements } from './measurements';
import type { CupChoice, Measurement, Project } from './model';

/**
 * Old name → new name. References in every expression follow. `waist`, `upper_chest`, `bicep`, `wrist`, `arm_length`,
 * `armhole_depth` and `back_waist_length` keep their names; `waist_to_armhole` stays as a custom measurement; `bust`
 * becomes a cup column (see `migrateBust`) while expressions keep saying `bust`, which follows the cup choice.
 */
export const LEGACY_RENAMES: Record<string, string> = {
  full_hip: 'hip_seat_straight',
  cross_chest_back: 'cross_back',
  shoulder_width: 'back_shoulder_width',
  neck_width: 'back_neck_width',
  back_neck_depth: 'back_neck_drop',
  front_neck_depth: 'front_neck_drop',
  shoulder_slope: 'shoulder_drop',
  bust_point_depth: 'hps_to_apex',
};

const fmt = (x: number) => String(Math.round(x * 100) / 100);

function uniqueName(p: Project, base: string): string {
  let n = base;
  for (let i = 2; p.measurements.some((m) => m.name === n); i++) n = `${base}_${i}`;
  return n;
}

/** An expression rule that is just another measurement's name, e.g. `back_shoulder_width`. */
function isAliasOf(m: Measurement, target: string): boolean {
  return m.rule.type === 'expression' && m.rule.expr.trim() === target && !Object.keys(m.table).length && !Object.keys(m.manual).length;
}

function dropMeasurement(p: Project, name: string): Project {
  return { ...p, measurements: p.measurements.filter((m) => m.name !== name) };
}

/** Rename one old measurement to its new name, coping with a project that already has the new one. */
function migrateName(p: Project, from: string, to: string, notes: string[]): Project {
  const old = p.measurements.find((m) => m.name === from);
  if (!old) return p;
  const existing = p.measurements.find((m) => m.name === to);
  if (!existing) {
    notes.push(`Renamed ${from} → ${to}, in the measurement list and in every expression.`);
    const label = dictionaryEntry(to)?.label;
    const q = renameMeasurement(p, from, to);
    return label ? { ...q, measurements: q.measurements.map((m) => (m.name === to ? { ...m, label } : m)) } : q;
  }
  if (isAliasOf(old, to)) {
    notes.push(`${from} was a copy of ${to}; removed it and pointed its expressions at ${to}.`);
    return renameMeasurement(dropMeasurement(p, from), from, to);
  }
  const keep = uniqueName(p, `${to}_old`);
  notes.push(`${from} could not become ${to} (the project already has ${to}); renamed it ${keep} so its values and expressions stay as they were.`);
  return renameMeasurement(p, from, keep);
}

/**
 * Old projects have one `bust` column. It becomes the cup column whose typical bust − upper_chest is closest to the
 * project's average, and the project's cup choice is set to that cup. Expressions keep using `bust`.
 */
function migrateBust(p: Project, notes: string[]): Project {
  const old = p.measurements.find((m) => m.name === 'bust');
  if (!old) {
    notes.push(`No bust measurement; the cup choice is set to ${cupLabel(p.fit.cup)}.`);
    return p;
  }
  // A bust that only copies a cup column (projects seeded from the new table before schema 2).
  const copied = CUPS.find((c) => isAliasOf(old, bustColumn(c.id)));
  if (copied) {
    notes.push(`bust was a copy of ${bustColumn(copied.id)}; removed it and set the cup choice to ${copied.label}. Expressions still say bust and follow the cup choice.`);
    return { ...dropMeasurement(p, 'bust'), fit: { ...p.fit, cup: copied.id } };
  }

  const diffs: { size: string; d: number }[] = [];
  for (const s of p.sizes) {
    const v = resolveMeasurements(p, s.id).values;
    if (v.bust && v.upper_chest) diffs.push({ size: s.name, d: v.bust.value - v.upper_chest.value });
  }
  let cup: CupChoice;
  if (diffs.length) {
    const mean = diffs.reduce((a, x) => a + x.d, 0) / diffs.length;
    cup = closestCup(mean);
    notes.push(
      `Old bust → ${bustColumn(cup)}: the average bust − upper chest is ${fmt(mean)} cm, closest to ${cupLabel(cup)} (typical ${TYPICAL_BUST_DIFFERENCE[cup]} cm; A/B 5, C/D 7.5, E/F 10, G/H 12.5).`,
    );
    const per = diffs.map((x) => ({ ...x, cup: closestCup(x.d) }));
    if (per.some((x) => x.cup !== cup)) {
      notes.push(`The old bust values match different cups in different sizes: ${per.map((x) => `${x.size} ${cupLabel(x.cup)}`).join(', ')}. Check the cup choice.`);
    }
  } else {
    cup = 'cd';
    notes.push(`Old bust → ${bustColumn(cup)}: there was no upper chest to compare with, so C/D was picked.`);
  }
  const target = bustColumn(cup as Exclude<CupChoice, 'custom'>);
  if (p.measurements.some((m) => m.name === target)) {
    notes.push(`The project already has ${target}, so the old bust became ${CUSTOM_BUST} and the cup choice is set to custom.`);
    return { ...renameColumnOnly(p, 'bust', CUSTOM_BUST), fit: { ...p.fit, cup: 'custom' } };
  }
  notes.push(`The cup choice is set to ${cupLabel(cup)}. Expressions still say bust and follow the cup choice.`);
  return { ...renameColumnOnly(p, 'bust', target), fit: { ...p.fit, cup } };
}

/** Rename a measurement but leave the references alone (they go through the `bust` alias). */
function renameColumnOnly(p: Project, from: string, to: string): Project {
  const m = p.measurements.find((x) => x.name === from)!;
  const label = to === CUSTOM_BUST ? 'Bust (custom)' : `Bust (${cupLabel(to.slice(5, 7) as CupChoice)} cup)`;
  return { ...p, measurements: p.measurements.map((x) => (x === m ? { ...x, name: to, label } : x)) };
}

/** Schema 1 → 2: new measurement names, the project's cup choice. */
export function migrateV1toV2(raw: any, notes: string[]): any {
  let p = { ...raw, fit: raw.fit ?? { cup: 'cd' } } as Project;
  // Leave a malformed file to validation, which explains what is wrong with it.
  if (!Array.isArray(p.measurements) || !Array.isArray(p.sizes) || !Array.isArray(p.panels) || !p.ease) return p;
  for (const [from, to] of Object.entries(LEGACY_RENAMES)) p = migrateName(p, from, to, notes);
  p = migrateBust(p, notes);
  const w2a = p.measurements.find((m) => m.name === 'waist_to_armhole');
  if (w2a) {
    notes.push('waist_to_armhole kept as a custom measurement (it is not in the new sizing table).');
    p = { ...p, measurements: p.measurements.map((m) => (m === w2a ? { ...m, note: m.note ?? 'Custom measurement kept from the old sizing table.' } : m)) };
  }
  if (p.measurements.some((m) => m.name === 'waist')) notes.push('waist, upper_chest, bicep, wrist, arm_length, armhole_depth and back_waist_length keep their names.');
  return p;
}
