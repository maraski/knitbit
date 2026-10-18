import { ATTACH_LABELS, BAND_NAMES, cardiganOf, DEFAULT_CLOSING } from '../../engine/bands';
import { plugIn } from '../../engine/bust';
import { buttonPlan } from '../../engine/buttons';
import { applyEdgeTreatments } from '../../engine/edgeTreatments';
import { buildScope } from '../../engine/measurements';
import type { BandAttach, CardiganOptions, Id, Project } from '../../engine/model';
import { computePanel } from '../../engine/panel';
import { SYMBOLS } from '../../engine/symbols';
import { ExprField } from './ExprField';

interface Props {
  project: Project;
  sizeId: Id;
  update: (fn: (p: Project) => Project, key?: string | null) => void;
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Front bands (cardigan): separate or continuous, attachment, overlap, closing width, buttons and buttonholes. */
export function BandSettings({ project, sizeId, update }: Props) {
  const c = cardiganOf(project);
  const scope = buildScope(project, sizeId);
  const sizeName = project.sizes.find((s) => s.id === sizeId)?.name ?? '';
  const set = (patch: Partial<CardiganOptions>, key: string | null = null) => update((p) => applyEdgeTreatments({ ...p, cardigan: { ...cardiganOf(p), ...patch } }), key);
  const common = { sizeId, sizeName, scope, units: project.units };

  // The closing formula with this size's numbers, at the first front's lower edge.
  const front = project.panels.find((p) => p.half);
  const fc = front ? computePanel(project, front, sizeId) : null;
  const hem = fc?.ok ? fc.waypoints.find((w) => w.wholeCm !== undefined && w.name === 'hem') ?? fc.waypoints[0] : null;
  const plan = buttonPlan(project, sizeId);
  const spacing = plan && plan.positions.length > 1 ? (plan.positions[0] - plan.positions[plan.positions.length - 1]) / (plan.positions.length - 1) : null;
  const dragged = !!c.buttons.manual[sizeId];

  const attachSelect = (role: 'button' | 'buttonhole' | 'continuous') => (
    <div className="field" key={role}>
      <label>{BAND_NAMES[role]}</label>
      <select value={c.attach[role]} onChange={(e) => set({ attach: { ...c.attach, [role]: e.target.value as BandAttach } as CardiganOptions['attach'] })}>
        {(Object.keys(ATTACH_LABELS) as BandAttach[]).filter((a) => role !== 'continuous' || a !== 'integrated').map((a) => <option key={a} value={a}>{ATTACH_LABELS[a]}</option>)}
      </select>
    </div>
  );

  return (
    <div className="band-settings">
      <div className="row2">
        <div className="field">
          <label>Bands</label>
          <select value={c.bands} onChange={(e) => set({ bands: e.target.value as CardiganOptions['bands'] })}>
            <option value="separate">Button + buttonhole bands</option>
            <option value="continuous">One continuous band</option>
          </select>
        </div>
        <div className="field">
          <label>Buttonholes on</label>
          <select value={c.buttonholeSide} onChange={(e) => set({ buttonholeSide: e.target.value as 'left' | 'right' })}>
            <option value="right">Right front</option>
            <option value="left">Left front</option>
          </select>
        </div>
      </div>
      {c.bands === 'continuous' ? attachSelect('continuous') : [attachSelect('button'), attachSelect('buttonhole')]}
      {c.bands === 'continuous' && <p className="hint">Up the right front, around the back neck, down the left front.</p>}

      <ExprField label="Overlap when closed (cm) · band_overlap" value={c.overlap} {...common} fieldKey="cardigan.overlap" onChange={(overlap, key) => set({ overlap }, key)} />
      <ExprField label="Taken off the whole front (cm) · closing_r" value={c.closing} {...common} fieldKey="cardigan.closing" onChange={(closing, key) => set({ closing }, key)} />
      <div className="formula">
        <div>
          closing_r = <code>{c.closing.expr}</code> = {plugIn(c.closing.expr, scope)} = <b>{r2(scope.closing_r)} cm</b>
          {c.closing.expr !== DEFAULT_CLOSING && (
            <button className="link" onClick={() => set({ closing: { expr: DEFAULT_CLOSING, overrides: {} } })}> reset</button>
          )}
        </div>
        <div>Each front = (whole front − closing_r) / 2{c.attach.buttonhole === 'integrated' || c.attach.button === 'integrated' ? ', plus its integrated band' : ''}.</div>
        {hem?.wholeCm !== undefined && (
          <div>
            At the {hem.name} ({sizeName}): ({r2(hem.wholeCm)} − {r2(scope.closing_r)}) / 2 = {r2((hem.wholeCm - scope.closing_r) / 2)} cm → {hem.stitches} sts on {front!.name}
            {fc?.half?.bandSts ? ` (incl. ${fc.half.bandSts} band sts)` : ''}.
          </div>
        )}
        <div className="hint">Closed: 2 fronts + 2 × band_w − band_overlap = the whole front.</div>
      </div>

      <h5>Buttons</h5>
      <div className="row2">
        <div className="field">
          <label>Count</label>
          <input className="num" type="number" min={0} value={c.buttons.count} onChange={(e) => set({ buttons: { ...c.buttons, count: Math.max(0, Math.round(Number(e.target.value))), manual: {} } }, 'cardigan.count')} />
        </div>
        <div className="field">
          <label>Spacing</label>
          <span className="muted small">{spacing !== null ? `${r2(spacing)} cm${dragged ? ' (dragged)' : ''}` : '–'}</span>
        </div>
      </div>
      <ExprField label="Top of the front edge to the first button (cm)" value={c.buttons.top} {...common} fieldKey="cardigan.top" onChange={(top, key) => set({ buttons: { ...c.buttons, top } }, key)} />
      <ExprField label="Lower edge to the last button (cm)" value={c.buttons.bottom} {...common} fieldKey="cardigan.bottom" onChange={(bottom, key) => set({ buttons: { ...c.buttons, bottom } }, key)} />
      {dragged && (
        <p className="hint">
          Buttons dragged by hand in {sizeName}.{' '}
          <button className="link" onClick={() => { const { [sizeId]: _, ...rest } = c.buttons.manual; set({ buttons: { ...c.buttons, manual: rest } }); }}>Space evenly again</button>
        </p>
      )}
      {plan && plan.holes.length > 0 && (
        <p className="hint">
          Buttonholes on {project.panels.find((p) => p.id === plan.holes[0].panelId)?.name}:{' '}
          {plan.holeAttach === 'pickup' ? `row ${plan.holes[0].row}, ` : 'rows '}
          {plan.holeAttach === 'pickup' ? `${plan.spacingSts.length ? `${plan.spacingSts.join(', ')} sts between` : ''}` : plan.holes.map((h) => h.row).join(', ')}.
          Drag the buttons on a front's schematic (this size only).
        </p>
      )}

      <h5>Buttonhole</h5>
      <div className="row2">
        <div className="field">
          <label>Style</label>
          <select value={c.buttonhole.style} onChange={(e) => set({ buttonhole: { ...c.buttonhole, style: e.target.value as 'yo-k2tog' | 'symbol' } })}>
            <option value="yo-k2tog">One row: yo, k2tog</option>
            <option value="symbol">A symbol</option>
          </select>
        </div>
        {c.buttonhole.style === 'symbol' && (
          <div className="field">
            <label>Symbol × width</label>
            <span className="inline">
              <select value={c.buttonhole.symbol} onChange={(e) => set({ buttonhole: { ...c.buttonhole, symbol: e.target.value } })}>
                {Object.values(SYMBOLS).map((s) => <option key={s.id} value={s.id}>{s.abbr || s.id} – {s.label}</option>)}
                {(project.symbols ?? []).map((s) => <option key={s.id} value={s.id}>{s.abbr} – {s.label}</option>)}
              </select>
              <input className="num tiny" type="number" min={1} value={c.buttonhole.width} onChange={(e) => set({ buttonhole: { ...c.buttonhole, width: Math.max(1, Math.round(Number(e.target.value))) } }, 'cardigan.bhw')} />
            </span>
          </div>
        )}
      </div>
      <div className="field">
        <label>Note</label>
        <input type="text" value={c.buttonhole.note} placeholder="e.g. 2-st one-row buttonhole" onChange={(e) => set({ buttonhole: { ...c.buttonhole, note: e.target.value } }, 'cardigan.bhnote')} />
      </div>
    </div>
  );
}
