// Shared parts of the issue model: what to change to fix a problem (`IssueFix`), and the key that ties a knock-on
// issue to its root cause. Kept apart from panel.ts so the yoke generators can use them without an import cycle.

import type { Id } from './model';

/** A field the user can change to fix an issue: where it is and its label as the properties show it. */
export interface FieldRef {
  target: 'yoke' | 'neckline' | 'waypoint' | 'segment' | 'measurement' | 'settings';
  panelId?: Id;
  /** yoke: a key in `YokeResult.params`; neckline: 'width' | 'depth' | 'centre'; waypoint: `<id>.width` etc. */
  key: string;
  label: string;
}

export interface IssueFix {
  /** What to change, in knitting words: "Make Depth below the neck point at most 19.3 cm, or …". */
  text: string;
  fields: FieldRef[];
  /** This size's value and what it needs, e.g. "25 cm", "≤ 19.3 cm". */
  now?: string;
  need?: string;
  /** A one-click change (M2; unused for now). */
  apply?: { field: FieldRef; value: string; sizes: Id[] | 'all' };
}

/**
 * Key of one problem in one panel: `<panelId>|<ref>|<severity>|<message with numbers as #>`, so the same problem in
 * several sizes shares it (the Checks list groups on it). A knock-on's `causedBy` is its root issue's key.
 */
export function issueKey(panelId: Id, issue: { ref: unknown; severity: string; message: string }): string {
  return `${panelId}|${JSON.stringify(issue.ref)}|${issue.severity}|${issue.message.replace(/-?\d+(\.\d+)?/g, '#')}`;
}

/** The panel an issue key (e.g. a `causedBy`) belongs to. */
export function issueKeyPanel(key: string): Id {
  return key.slice(0, key.indexOf('|'));
}

/** A number of cm as the fix texts show it. */
export function cmText(cm: number): string {
  return `${Math.round(cm * 10) / 10} cm`;
}
