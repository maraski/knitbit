// Ready-made shaping lines offered when adding a line to a panel (kept apart from LineProps, which loads on first use).

import type { Anchor, Panel, ShapingLine } from '../engine/model';
import { dim, newId } from '../engine/model';
import { waypointKey } from '../engine/panel';

/** Ready-made lines, in garment terms (cm expressions). */
export function linePresets(panel: Panel): { label: string; make: () => ShapingLine }[] {
  const keys = panel.waypoints.map((w) => waypointKey(w.name));
  const has = (k: string) => keys.includes(k);
  const lo = has('hem') ? 'hem' : keys[0];
  const waist = has('waist') ? 'waist' : keys[Math.min(1, keys.length - 1)];
  const under = has('underarm') ? 'underarm' : keys[keys.length - 1];
  const line = (name: string, from: Anchor, to: Anchor, amount: string, kind: ShapingLine['kind']): ShapingLine => ({
    id: newId('line'),
    name,
    from,
    to,
    amount: dim(amount),
    kind,
    sides: 'both',
    rowSide: 'rs',
    mirror: true,
    manual: {},
  });
  return [
    {
      label: 'Fisheye dart through the bust point (waist area)',
      make: () => line('Fisheye dart', { height: dim(`${lo}.height + 5`), x: dim('-apex_to_apex / 2') }, { height: dim(`${under}.height - 3`), x: dim('-apex_to_apex / 2') }, '-6', 'fisheye'),
    },
    {
      label: 'Waist dart ⅓ in from the side (hem → waist)',
      make: () => line('Waist dart', { height: dim(`${lo}.height + 5`), x: dim(`-${waist}.width / 6`) }, { height: dim(`${waist}.height`), x: dim(`-${waist}.width / 6`) }, '-4', 'one-way'),
    },
    {
      label: 'Slanted side-front dart (towards the bust point)',
      make: () =>
        line('Side-front dart', { height: dim(`${waist}.height`), x: dim(`-${waist}.width / 2 + 4`) }, { height: dim(`${under}.height - 5`), x: dim('-apex_to_apex / 2 - 2') }, '-4', 'one-way'),
    },
    {
      label: 'Sway-back dart at the centre back (fisheye)',
      make: () => ({
        ...line('Sway-back', { height: dim(`${waist}.height - 6`), x: dim('-1') }, { height: dim(`${waist}.height + 6`), x: dim('-1') }, '-2', 'fisheye'),
      }),
    },
    { label: 'Blank line (edit its ends)', make: () => line('Line', { height: dim(`${waist}.height`), x: dim('-5') }, { height: dim(`${waist}.height + 10`), x: dim('-5') }, '-4', 'one-way') },
  ];
}
