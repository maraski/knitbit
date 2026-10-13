// Project-level fit choices: which sizing-table columns the derived names follow.
//   cup        → bust, dart_height, apex_to_apex
//   hem        → hem_circ, hem_drop
//   broad back → shoulder_w, cross_back_w
// These names are derived (like a measurement with an expression rule) unless the project has a measurement of the
// same name, which then wins.

import type { CupChoice, HemChoice, Measurement, Project } from './model';

export const CUPS: { id: Exclude<CupChoice, 'custom'>; label: string; apex: string }[] = [
  { id: 'ab', label: 'A/B', apex: 'b' },
  { id: 'cd', label: 'C/D', apex: 'd' },
  { id: 'ef', label: 'E/F', apex: 'f' },
  { id: 'gh', label: 'G/H', apex: 'h' },
];

export const CUSTOM_BUST = 'bust_custom';

export const HEMS: { id: HemChoice; label: string; drop: string }[] = [
  { id: 'high_hip', label: 'High hip', drop: 'waist_to_high_hip' },
  { id: 'hip_seat_straight', label: 'Hip / seat (straight)', drop: 'waist_to_full_hip' },
  { id: 'hip_seat_curvy', label: 'Hip / seat (curvy)', drop: 'waist_to_full_hip' },
];

export function cupLabel(cup: CupChoice): string {
  return cup === 'custom' ? 'custom bust' : (CUPS.find((c) => c.id === cup)?.label ?? cup);
}

export const bustColumn = (cup: Exclude<CupChoice, 'custom'>) => `bust_${cup}_cup`;

/**
 * Typical bust − upper_chest for each cup in the sample table (means over its 11 sizes, rounded): modern cup sizing
 * is about 2.5 cm per cup step. Used to guess the cup of a table that has a single bust column.
 */
export const TYPICAL_BUST_DIFFERENCE: Record<Exclude<CupChoice, 'custom'>, number> = { ab: 5, cd: 7.5, ef: 10, gh: 12.5 };

/** The cup whose typical bust difference is closest to `d` (cm). */
export function closestCup(d: number): Exclude<CupChoice, 'custom'> {
  let best = CUPS[0].id;
  for (const c of CUPS) if (Math.abs(TYPICAL_BUST_DIFFERENCE[c.id] - d) < Math.abs(TYPICAL_BUST_DIFFERENCE[best] - d)) best = c.id;
  return best;
}

export interface FitAlias {
  name: string;
  expr: string; // the column it copies
  choice: string; // which choice sets it, for labels and hints
  description: string;
}

/** Every derived name for the project's choices, whether or not the project has the column it copies. */
export function fitAliasList(project: Pick<Project, 'fit'>): FitAlias[] {
  const fit = project.fit ?? { cup: 'cd' };
  const out: FitAlias[] = [];
  const cupChoice = `cup ${cupLabel(fit.cup)}`;
  if (fit.cup === 'custom') {
    out.push({ name: 'bust', expr: CUSTOM_BUST, choice: cupChoice, description: 'Bust circumference for the chosen cup' });
  } else {
    const c = CUPS.find((x) => x.id === fit.cup)!;
    out.push(
      { name: 'bust', expr: bustColumn(c.id), choice: cupChoice, description: 'Bust circumference for the chosen cup' },
      { name: 'dart_height', expr: `dart_height_${c.id}`, choice: cupChoice, description: 'Suggested bust dart height for the chosen cup' },
      { name: 'apex_to_apex', expr: `apex_to_apex_${c.apex}`, choice: cupChoice, description: 'Apex to apex for the chosen cup' },
    );
  }
  const hem = HEMS.find((h) => h.id === (fit.hem ?? 'high_hip'))!;
  out.push(
    { name: 'hem_circ', expr: hem.id, choice: `hem at ${hem.label.toLowerCase()}`, description: 'Body circumference at the hem' },
    { name: 'hem_drop', expr: hem.drop, choice: `hem at ${hem.label.toLowerCase()}`, description: 'Waist to hem, at the side' },
  );
  const broad = !!fit.broadBack;
  const back = broad ? 'broad back' : 'standard back';
  out.push(
    { name: 'shoulder_w', expr: broad ? 'back_shoulder_width_broad' : 'back_shoulder_width', choice: back, description: 'Back shoulder width' },
    { name: 'cross_back_w', expr: broad ? 'cross_back_broad' : 'cross_back', choice: back, description: 'Cross back' },
  );
  return out;
}

/**
 * Derived names as expressions over table columns, for the project's choices. A name is left out when the project
 * has a measurement of that name (it wins) or lacks the column it would come from.
 */
export function fitAliases(project: Pick<Project, 'fit' | 'measurements'>): Record<string, string> {
  const have = new Set(project.measurements.map((m: Measurement) => m.name));
  const out: Record<string, string> = {};
  for (const a of fitAliasList(project)) if (!have.has(a.name) && have.has(a.expr)) out[a.name] = a.expr;
  return out;
}

/**
 * Custom bust: the sizing table has dart heights and apex widths per cup, not per bust, so each size takes them from
 * the cup whose typical bust − upper_chest is closest to its own. Names the project defines itself are left alone.
 */
export function customCupNames(project: Pick<Project, 'fit' | 'measurements'>, values: Record<string, number>): { cup: Exclude<CupChoice, 'custom'>; names: Record<string, string> } | null {
  if (project.fit?.cup !== 'custom' || values.bust === undefined || values.upper_chest === undefined) return null;
  const cup = closestCup(values.bust - values.upper_chest);
  const c = CUPS.find((x) => x.id === cup)!;
  const have = new Set(project.measurements.map((m) => m.name));
  const names: Record<string, string> = {};
  for (const [name, col] of [['dart_height', `dart_height_${cup}`], ['apex_to_apex', `apex_to_apex_${c.apex}`]]) {
    if (!have.has(name) && col in values) names[name] = col;
  }
  return { cup, names };
}

/** Why a derived name is missing (for error messages), or null when it isn't a derived name or isn't missing. */
export function missingAliasHint(project: Pick<Project, 'fit' | 'measurements'>, name: string): string | null {
  const a = fitAliasList(project).find((x) => x.name === name);
  if (!a || project.measurements.some((m) => m.name === name || m.name === a.expr)) return null;
  return `${name} follows ${a.expr} (${a.choice}), which this project doesn't have: import or merge the sizing table, or change the fit choice under Project`;
}
