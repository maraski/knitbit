// Shared parts of the issue model: what to change to fix a problem (`IssueFix`), and the key that ties a knock-on
// issue to its root cause. Kept apart from panel.ts so the yoke generators can use them without an import cycle.

import type { Id } from './model';

/** A field the user can change to fix an issue: where it is and its label as the properties show it. */
export interface FieldRef {
  target: 'yoke' | 'neckline' | 'waypoint' | 'segment' | 'bust' | 'line' | 'panel' | 'join' | 'measurement' | 'settings';
  /** The piece the field is on (filled in by computePanel / the checks when the generator doesn't know it). */
  panelId?: Id;
  /** The waypoint, the segment's lower waypoint, or the line the field belongs to. */
  id?: Id;
  /**
   * yoke: a key in `YokeResult.params`; neckline: 'width' | 'depth' | 'centre'; waypoint: 'height' | 'width' | 'left' |
   * 'right'; segment: 'method' | 'princess'; bust: a BustSpec field; line: 'amount' | 'start' | 'end'; panel: 'waypoints';
   * measurement: its name; settings: 'strap' | 'edges' | 'cuff' | 'seamTolerance' | 'regionGap' | 'joins' | 'waistSplit'.
   */
  key: string;
  label: string;
}

/** A one-click change: set the field to `value` (in the field's own unit) in this size. */
export interface FixApply {
  field: FieldRef;
  value: number;
  unit: 'cm' | 'rows' | 'sts' | '';
  /** The button's words when the change isn't "field = value" (a project choice, e.g. "Even waist split"). */
  label?: string;
}

export interface IssueFix {
  /** What to change, in knitting words: "Make Depth below the neck point at most 19.3 cm, or …". */
  text: string;
  fields: FieldRef[];
  /** This size's value and what it needs, e.g. "25 cm", "≤ 19.3 cm". */
  now?: string;
  need?: string;
  /** A one-click change for this size (the UI gathers the failing sizes and applies them as one undo step). */
  apply?: FixApply;
}

/**
 * Key of one problem in one panel: `<panelId>|<ref>|<severity>|<message with numbers as #>`, so the same problem in
 * several sizes shares it (the Checks list groups on it). A knock-on's `causedBy` is its root issue's key.
 */
export function issueKey(panelId: Id, issue: { ref: unknown; severity: string; message: string }): string {
  // "1 row" and "15 rows" are the same problem: the unit after a number loses its plural.
  const text = issue.message.replace(/-?\d+(\.\d+)?/g, '#').replace(/(# ?[a-z]+?)(es|s)?\b/g, '$1');
  return `${panelId}|${JSON.stringify(issue.ref)}|${issue.severity}|${text}`;
}

/** The panel an issue key (e.g. a `causedBy`) belongs to. */
export function issueKeyPanel(key: string): Id {
  return key.slice(0, key.indexOf('|'));
}

/** A number of cm as the fix texts show it. */
export function cmText(cm: number): string {
  return `${Math.round(cm * 10) / 10} cm`;
}

/** Rounded to 0.1 cm up (a minimum) or down (a maximum), so the fix's value really is enough. */
export const ceil1 = (cm: number) => Math.ceil(cm * 10 - 1e-6) / 10;
export const floor1 = (cm: number) => Math.floor(cm * 10 + 1e-6) / 10;

/** Rows (or stitches) with their length in cm: "12 rows (4 cm)". */
export function rowsCm(rows: number, rpc: number): string {
  return `${rows} row${Math.abs(rows) === 1 ? '' : 's'} (${cmText(rows / rpc)})`;
}
export function stsCm(sts: number, spc: number): string {
  return `${sts} st${Math.abs(sts) === 1 ? '' : 's'} (${cmText(sts / spc)})`;
}

/** A fix: the text, the field(s), and optionally this size's value, its need and a one-click change. */
export function fixOf(text: string, fields: FieldRef[], o: { now?: string; need?: string; apply?: FixApply } = {}): IssueFix {
  return { text, fields, ...(o.now !== undefined && { now: o.now }), ...(o.need !== undefined && { need: o.need }), ...(o.apply && { apply: o.apply }) };
}

// ---------- fields as the properties show them ----------

/** A yoke parameter's label as YokeProps / RaglanProps show it (the start of it). */
export const YOKE_LABELS: Record<string, string> = {
  seamSts: 'Seam stitches',
  frontCo: 'Front cast-on, both fronts',
  srPairs: 'Short-row pairs',
  srFirst: 'First turn',
  srStep: 'Sts between turns',
  backWidth: 'Back width after the markers move',
  shoulderLength: 'Shoulder seam length',
  shorten: 'Shorten the seam by',
  extraRows: 'Extra rows',
  backNeckPerRow: 'Increases per row',
  backNeckRows: 'Over the first … rows',
  neckWidth: 'Neck width, cast on across the back',
  neckDepth: 'Depth below the neck point',
  neckBackDepth: 'Back depth, from the strap top',
  neckCentre: 'Centre',
  capTopSts: 'Cap top stitches',
  rapidRows: 'Rapid rows',
  sleeveWidth: 'Sleeve at the underarm',
  backLength: 'Back length, neck to underarm',
  extraDepth: 'Extra depth',
  maxRapid: 'Rapid rows at most',
  bodyWidth: 'Body at the underarm',
  bodyZone: 'Body increases over',
  underarmCo: 'Underarm cast-on, each',
  sleeveTop: 'Sleeve top at the cast-on',
  bandEase: 'Band ease',
  ringEase: 'Ring ease',
  armArc: 'Arm arc',
  backRaise: 'Back raise',
};

export const NECKLINE_LABELS: Record<'width' | 'depth' | 'centre', string> = { width: 'Opening width', depth: 'Depth (from top)', centre: 'Centre width' };

export const SETTINGS_LABELS: Record<string, string> = {
  strap: 'Strap width',
  edges: 'Edges',
  cuff: 'Cuff band depth',
  seamTolerance: 'Seam tolerance',
  regionGap: 'Region sizing gap',
  joins: 'Joins',
  waistSplit: 'Waist split',
};

export const field = {
  yoke: (key: string, label = YOKE_LABELS[key] ?? key): FieldRef => ({ target: 'yoke', key, label }),
  neckline: (key: 'width' | 'depth' | 'centre', panelId?: Id): FieldRef => ({ target: 'neckline', key, label: NECKLINE_LABELS[key], ...(panelId && { panelId }) }),
  waypoint: (id: Id, name: string, key: 'height' | 'width' | 'left' | 'right'): FieldRef => ({ target: 'waypoint', id, key, label: `${waypointLabel(name)} ${key === 'height' ? 'height' : key === 'width' ? 'width' : `${key} half`}` }),
  segment: (fromWaypoint: Id, label: string, key: 'method' | 'princess' = 'method'): FieldRef => ({ target: 'segment', id: fromWaypoint, key, label }),
  bust: (key: string, label: string): FieldRef => ({ target: 'bust', key, label }),
  line: (id: Id, key: 'amount' | 'start' | 'end', label: string): FieldRef => ({ target: 'line', id, key, label }),
  panel: (key: string, label: string): FieldRef => ({ target: 'panel', key, label }),
  measurement: (name: string): FieldRef => ({ target: 'measurement', key: name, label: name }),
  settings: (key: string, label = SETTINGS_LABELS[key] ?? key): FieldRef => ({ target: 'settings', key, label }),
};

/** A waypoint's name in user text: the template's `neck_side` is "the neck point (top of the shoulder)". */
export function waypointLabel(name: string): string {
  if (name === 'neck_side') return 'Neck point (top of the shoulder)';
  return name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** The same in running text ("the neck point (top of the shoulder)", "underarm"). */
export function waypointWords(name: string): string {
  return name === 'neck_side' ? 'the neck point (top of the shoulder)' : name.replace(/_/g, ' ');
}

/** A waypoint's name inside a message: only the template's `neck_side` needs words ("neck point"). */
export function wpText(name: string): string {
  return name === 'neck_side' ? 'neck point' : name;
}

/** An expression error in words: an unknown name is "… isn't a measurement or a name in this piece". */
export function exprErrorText(e: string): string {
  return e.replace(/Unknown name "([\w.]+)"/g, (_, n: string) => `“${n}” isn't a measurement or a name this piece knows`);
}

/** Fill in the panel on fields that don't name one (the generators and helpers don't know it). */
export function withPanelFields<T extends { fix?: IssueFix }>(issues: T[], panelId: Id): T[] {
  return issues.map((i) => {
    if (!i.fix || i.fix.fields.every((f) => f.panelId || f.target === 'measurement' || f.target === 'settings')) return i;
    const put = (f: FieldRef): FieldRef => (f.panelId || f.target === 'measurement' || f.target === 'settings' ? f : { ...f, panelId });
    return { ...i, fix: { ...i.fix, fields: i.fix.fields.map(put), ...(i.fix.apply && { apply: { ...i.fix.apply, field: put(i.fix.apply.field) } }) } };
  });
}
