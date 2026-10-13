// Project-level fit choices: which sizing-table columns the names `bust`, `apex_to_apex` and `dart_height` follow.
// These names are derived (like a measurement with an expression rule) unless the project has a measurement of the
// same name, which then wins.

import type { CupChoice, Measurement, Project } from './model';

export const CUPS: { id: Exclude<CupChoice, 'custom'>; label: string; apex: string }[] = [
  { id: 'ab', label: 'A/B', apex: 'b' },
  { id: 'cd', label: 'C/D', apex: 'd' },
  { id: 'ef', label: 'E/F', apex: 'f' },
  { id: 'gh', label: 'G/H', apex: 'h' },
];

export const CUSTOM_BUST = 'bust_custom';

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

/**
 * Derived names as expressions over table columns, for the project's choices. A name is left out when the project
 * has a measurement of that name (it wins) or lacks the column it would come from.
 */
export function fitAliases(project: Pick<Project, 'fit' | 'measurements'>): Record<string, string> {
  const have = new Set(project.measurements.map((m: Measurement) => m.name));
  const cup = project.fit?.cup ?? 'cd';
  const out: Record<string, string> = {};
  const add = (name: string, expr: string | null) => {
    if (expr && !have.has(name) && have.has(expr)) out[name] = expr;
  };
  if (cup === 'custom') {
    add('bust', CUSTOM_BUST);
  } else {
    const c = CUPS.find((x) => x.id === cup)!;
    add('bust', bustColumn(cup));
    add('dart_height', `dart_height_${cup}`);
    add('apex_to_apex', `apex_to_apex_${c.apex}`);
  }
  return out;
}
