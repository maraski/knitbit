// Garment → Shoulders: the strap width setting, what gives, and one readout line per bodice (or for the yoke: its
// shoulder seam). The readout (with its Re-link button) is also shown in the neckline, waypoint and yoke properties.

import { useMemo } from 'react';
import { buildScope } from '../../engine/measurements';
import type { Id, Panel, Project, StrapGives } from '../../engine/model';
import { defaultStrapWidth, isStrapPiece, isStrapYoke, relinkStrap, setStrap, STRAP_FIELD_LABELS, strapLinks, strapPieces, strapReadout, strapScope, yokeStrapReadout, type StrapField } from '../../engine/strap';
import type { Units } from '../../engine/units';
import { len, sts } from '../format';
import { ExprField } from './ExprField';

type Update = (fn: (p: Project) => Project, key?: string | null) => void;

const GIVES: { id: StrapGives; label: string; hint: string; yoke: string }[] = [
  {
    id: 'neck',
    label: 'Neck',
    hint: 'The neck widens or narrows; the shoulder line and the armholes stay. Back and front necks stay the same width.',
    yoke: 'The neck cast-on widens or narrows so the back still reaches its width after the shoulders; the front neck keeps its shaping (the extra width goes to the centre).',
  },
  {
    id: 'armhole',
    label: 'Armhole',
    hint: 'The neck stays; the shoulder line moves in or out. The armhole shaping follows a narrower shoulder (higher up the armhole when it needs the rows); check the sleeve cap against the armhole.',
    yoke: 'The neck stays; the back after the shoulders is the neck plus the seam’s increases, so the cross back is no longer followed (by design). Check the armhole and the sleeve.',
  },
];

export function StrapSettings({ project, sizeId, update }: { project: Project; sizeId: Id; update: Update }) {
  const kind = strapScope(project);
  const strap = project.garment.strap;
  // Until it is set, the strap shows what the pieces have now, so setting it moves nothing.
  const width = useMemo(() => strap?.width ?? (kind === 'panels' || kind === 'yoke' ? defaultStrapWidth(project) : null), [strap, kind, project]);
  if (!kind) return null;
  if (kind === 'raglan') {
    return (
      <>
        <h4>Shoulders</h4>
        <p className="hint">A raglan has no shoulder seam, so there is no strap to set: the neck width and the sleeve top (yoke properties) shape the top of the yoke.</p>
      </>
    );
  }
  const gives = strap?.gives ?? 'neck';
  const sizeName = project.sizes.find((s) => s.id === sizeId)?.name ?? '';
  const scope = buildScope(project, sizeId);
  const set = (next: { width?: typeof width; gives?: StrapGives }, key: string | null) => update((p) => setStrap(p, { width: next.width ?? width!, gives: next.gives ?? gives }), key);
  return (
    <>
      <h4>Shoulders</h4>
      <ExprField
        label="Strap width"
        value={width!}
        // Not set yet, the per-size values only show what each size has now: a typed width is for every size.
        onChange={(d, key) => set({ width: !strap && key === 'width' ? { ...d, overrides: {} } : d }, `strap.${key}`)}
        fieldKey="width"
        sizeId={sizeId}
        sizeName={sizeName}
        scope={scope}
        units={project.units}
      />
      <div className="field">
        <label>Strap gives at</label>
        <select value={gives} onChange={(e) => set({ gives: e.target.value as StrapGives }, null)}>
          {GIVES.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
        </select>
        <div className="hint">{GIVES.find((g) => g.id === gives)![kind === 'yoke' ? 'yoke' : 'hint']}</div>
      </div>
      {strap ? (
        <p className="hint">
          The linked fields read the strap (marked “from strap width”); typing in one unlinks it.{' '}
          <button className="link" onClick={() => update((p) => setStrap(p, null))} title="Each field keeps its own value; nothing moves">Stop linking</button>
        </p>
      ) : (
        <p className="hint">
          {kind === 'yoke'
            ? 'Not set yet: shown is the shoulder seam the yoke has now. Change the width or what gives to link the yoke’s neck width (or back width) to it (one undo step).'
            : 'Not set yet: shown is the strap the pieces have now. Change the width or what gives to link the neck and shoulder widths to it (one undo step).'}
        </p>
      )}
      {kind === 'yoke'
        ? project.panels.filter(isStrapYoke).map((x) => <YokeStrapLine key={x.id} project={project} panel={x} sizeId={sizeId} units={project.units} update={update} named />)
        : strapPieces(project).map((x) => <StrapLine key={x.id} project={project} panel={x} sizeId={sizeId} units={project.units} update={update} named />)}
    </>
  );
}

/** "Back: strap 3.0 cm (7 sts) · neck 38.5 cm · shoulder 44.5 cm", and what was typed over, with Re-link. */
export function StrapLine({ project, panel, sizeId, units, update, named }: { project: Project; panel: Panel; sizeId: Id; units: Units; update: Update; named?: boolean }) {
  if (!isStrapPiece(panel) || strapScope(project) !== 'panels') return null;
  const r = strapReadout(project, panel, sizeId);
  const { unlinked } = strapLinks(project, panel);
  const cm = (x: number) => len(Math.round(x * 10) / 10, units);
  return (
    <div className="strap-line hint">
      {named && <strong>{panel.name}: </strong>}
      {r ? (
        <>
          strap {cm(r.strapCm)} ({sts(r.strapSts)}) · neck {cm(r.neckCm)} · shoulder {cm(r.shoulderCm)}
        </>
      ) : (
        'strap: can’t be computed in this size'
      )}
      {unlinked.length > 0 && (
        <div className="hint warn">
          Typed over, no longer from the strap: {unlinked.map((f) => STRAP_FIELD_LABELS[f]).join(', ')}.{' '}
          <button className="link" onClick={() => update((p) => relinkStrap(p, panel.id))}>Re-link to strap</button>
        </div>
      )}
    </div>
  );
}

/** "Yoke: strap (shoulder seam) 3.0 cm · 9 rows · neck 38.5 cm · back at the end of the shoulders 37.3 cm", with Re-link. */
export function YokeStrapLine({ project, panel, sizeId, units, update, named }: { project: Project; panel: Panel; sizeId: Id; units: Units; update: Update; named?: boolean }) {
  const r = useMemo(() => yokeStrapReadout(project, panel, sizeId), [project, panel, sizeId]);
  if (!r) return null;
  const { unlinked } = strapLinks(project, panel);
  const cm = (x: number) => len(Math.round(x * 10) / 10, units);
  return (
    <div className="strap-line hint">
      {named && <strong>{panel.name}: </strong>}
      Strap (shoulder seam) {cm(r.strapCm)} · {r.rows} rows · neck {cm(r.neckCm)} · back at the end of the shoulders {cm(r.backCm)}
      {unlinked.length > 0 && (
        <div className="hint warn">
          Typed over, no longer from the strap: {unlinked.map((f) => STRAP_FIELD_LABELS[f]).join(', ')}.{' '}
          <button className="link" onClick={() => update((p) => relinkStrap(p, panel.id))}>Re-link to strap</button>
        </div>
      )}
    </div>
  );
}

/** The mark for a field the strap drives. */
export function strapNote(project: Project, panel: Panel, field: StrapField): string | undefined {
  return strapLinks(project, panel).linked.includes(field) ? 'from strap width' : undefined;
}
