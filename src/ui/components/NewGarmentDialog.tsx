import { useState } from 'react';
import { EDGE_STITCHES, EDGE_TREATMENTS, edgesForNeckline, edgesOf } from '../../engine/edgeTreatments';
import { OPENINGS } from '../../engine/garment';
import { buildGarment, EASE_PRESETS, easePresetOf, garmentChoice, isYokeMethod, lengthFor, lengthsFor, METHODS, NECKLINES, necklinesFor, offShoulderNote, SLEEVES, sleevesFor, type GarmentMethod, type GarmentSpec, type SleeveChoice } from '../../engine/garmentSetup';
import { SLEEVE_LENGTHS } from '../../engine/sleeveLength';
import type { Gauge } from '../../engine/gauge';
import type { EdgeStitch, EdgeTreatmentId, EdgeTreatments, Project } from '../../engine/model';
import { loadSample } from '../store';

type SizeSource = 'keep' | 'sample' | 'import';

interface Props {
  project: Project;
  /** First run: the project is an empty one on the sample table, so "keep" is the sample. */
  firstRun: boolean;
  onCancel: () => void;
  /** The new garment; `importTable` opens the sizing-table importer on it next. */
  onCreate: (project: Project, importTable: boolean) => void;
  onSample: () => void;
}

/** New garment: how it's built, front, neckline, sleeves, fit, edges, sizes and gauge, made in one undoable step. */
export function NewGarmentDialog({ project, firstRun, onCancel, onCreate, onSample }: Props) {
  const now = garmentChoice(project);
  const [method, setMethod] = useState<GarmentMethod>(now.method === 'custom' || firstRun ? 'top-down' : now.method);
  const [opening, setOpening] = useState(project.garment.opening);
  const [neckline, setNeckline] = useState(now.neckline);
  const [sleeve, setSleeve] = useState<SleeveChoice>(now.sleeve === 'contiguous' || now.sleeve === 'raglan' || now.sleeve === 'none' ? 'set-in' : now.sleeve);
  const [length, setLength] = useState(now.sleeveLength);
  const [ease, setEase] = useState(easePresetOf(project.ease) ?? 'standard');
  const [edges, setEdges] = useState<EdgeTreatments>(() => structuredClone(edgesOf(project)));
  const [sizes, setSizes] = useState<SizeSource>(firstRun ? 'sample' : 'keep');
  const [gauge, setGauge] = useState<Gauge>(project.gauge);
  const [busy, setBusy] = useState(false);

  const sleeves = sleevesFor(method);
  const sleeveChoice: SleeveChoice = sleeves.includes(sleeve) ? sleeve : sleeves[0] ?? 'none';
  const lengths = lengthsFor(sleeveChoice);
  const sleeveLength = lengthFor(sleeveChoice, length);
  const blank = method === 'blank';
  const necks = necklinesFor(method, opening);
  const neck = necks.includes(neckline) ? neckline : 'round';
  // Off-shoulder is a pullover only for now.
  const offShoulder = neck === 'off-shoulder';
  // One card per method, except a group (raglan): one card, with its choice below the cards.
  const cards = METHODS.filter((m, i) => !m.group || METHODS.findIndex((x) => x.group?.id === m.group!.id) === i);
  const group = METHODS.find((m) => m.id === method)?.group;
  const setEdge = (id: EdgeTreatmentId, patch: Partial<EdgeTreatments[EdgeTreatmentId]>) => setEdges({ ...edges, [id]: { ...edges[id], ...patch } });

  const create = async () => {
    setBusy(true);
    const base = sizes === 'keep' ? project : { ...(await loadSample()).sampleTable(), name: project.name };
    const spec: GarmentSpec = { method, opening, neckline: neck, sleeve: sleeveChoice, sleeveLength, ease, edges: blank ? undefined : edgesForNeckline(edges, neck, neck) };
    const name = firstRun || sizes !== 'keep' ? (opening === 'cardigan' ? 'My cardigan' : 'My top') : project.name;
    onCreate(buildGarment({ ...base, name, gauge }, spec), sizes === 'import');
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal new-garment" role="dialog" aria-label="New garment">
        <div className="modal-head">
          <h3>New garment</h3>
          <button className="icon" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <h4>How it’s built</h4>
          <div className="method-cards" role="radiogroup" aria-label="Construction method">
            {cards.map((m) => {
              const active = m.group ? group?.id === m.group.id : method === m.id;
              return (
                <button key={m.id} role="radio" aria-checked={active} className={`method-card${active ? ' active' : ''}`} onClick={() => !active && setMethod(m.id)}>
                  <MethodSketch method={m.id} />
                  <strong>{m.group?.label ?? m.label}</strong>
                  <span className="hint">{m.group ? 'Classic raglan lines, or a modified raglan (PetiteKnit style).' : m.description}</span>
                </button>
              );
            })}
          </div>
          {group && (
            <div className="field method-choice">
              <div className="segmented" role="radiogroup" aria-label={group.label}>
                {METHODS.filter((m) => m.group?.id === group.id).map((m) => (
                  <button key={m.id} role="radio" aria-checked={method === m.id} className={method === m.id ? 'active' : ''} onClick={() => setMethod(m.id)}>{m.group!.choice}</button>
                ))}
              </div>
              <div className="hint">{offShoulder ? offShoulderNote(method) : METHODS.find((m) => m.id === method)!.description}</div>
            </div>
          )}
          {isYokeMethod(method) && <p className="hint">The yoke’s {method === 'raglan' ? 'raglan lines, neck and depth' : 'neck and phases'} are set in its properties after it is made.</p>}

          <div className="new-garment-grid">
            <div>
              <div className="field">
                <label>Front</label>
                <div className="segmented">
                  {OPENINGS.map((o) => (
                    <button key={o.id} className={opening === o.id ? 'active' : ''} onClick={() => setOpening(o.id)} disabled={offShoulder && o.id === 'cardigan'} title={offShoulder && o.id === 'cardigan' ? 'An off-shoulder neckline is pullover only for now' : undefined}>
                      {o.id === 'closed' ? 'Pullover' : 'Cardigan'}
                    </button>
                  ))}
                </div>
              </div>
              {!blank && (
                <>
                  <div className="row2">
                    <div className="field">
                      <label>Neckline</label>
                      <select
                        value={neck}
                        onChange={(e) => {
                          const next = e.target.value as typeof neckline;
                          // Off-shoulder knits its band first with the yoke: the neckband is pre-set to it (and back).
                          setEdges(edgesForNeckline(edges, next, neck));
                          setNeckline(next);
                        }}
                      >
                        {NECKLINES.filter((n) => necks.includes(n.id)).map((n) => <option key={n.id} value={n.id}>{n.label}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Sleeves</label>
                      <select value={sleeveChoice} onChange={(e) => setSleeve(e.target.value as SleeveChoice)} disabled={sleeves.length < 2}>
                        {SLEEVES.filter((s) => sleeves.includes(s.id)).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="row2">
                    <div className="field">
                      <label>Sleeve length</label>
                      <select value={sleeveLength} onChange={(e) => setLength(e.target.value as typeof length)} disabled={!lengths.length}>
                        {!lengths.length && <option value={sleeveLength}>—</option>}
                        {SLEEVE_LENGTHS.filter((l) => lengths.includes(l.id)).reverse().map((l) => <option key={l.id} value={l.id}>{l.id === 'cap' ? 'Cap sleeve' : l.label}</option>)}
                      </select>
                    </div>
                    <div className="field">
                      <label>Fit (ease)</label>
                      <select value={ease} onChange={(e) => setEase(e.target.value as typeof ease)}>
                        {EASE_PRESETS.map((e) => <option key={e.id} value={e.id}>{e.label}: {e.global} cm around, bicep {e.bicep} cm</option>)}
                      </select>
                    </div>
                  </div>
                  <h4>Edges</h4>
                  {EDGE_TREATMENTS.filter((d) => d.id !== 'frontBands' || opening === 'cardigan').map((d) => (
                    <div key={d.id} className="edge-row">
                      <label className="check">
                        <input type="checkbox" checked={edges[d.id].enabled} onChange={(e) => setEdge(d.id, { enabled: e.target.checked })} />
                        {d.label}
                      </label>
                      <select value={edges[d.id].stitch} disabled={!edges[d.id].enabled} onChange={(e) => setEdge(d.id, { stitch: e.target.value as EdgeStitch })} aria-label={`${d.label} stitch`}>
                        {Object.entries(EDGE_STITCHES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        {edges[d.id].stitch === 'custom' && <option value="custom">Custom</option>}
                      </select>
                    </div>
                  ))}
                  <p className="hint">
                    {offShoulder ? 'The neckband is the off-shoulder band: 1×1 rib, 4 cm, knit first with the yoke. ' : ''}Depths, methods and buttons are in the Garment tab afterwards.
                  </p>
                </>
              )}
            </div>
            <div>
              <div className="field">
                <label>Sizes</label>
                {!firstRun && (
                  <label className="check">
                    <input type="radio" name="sizes" checked={sizes === 'keep'} onChange={() => setSizes('keep')} />
                    This project’s sizing table ({project.sizes.length} sizes)
                  </label>
                )}
                <label className="check">
                  <input type="radio" name="sizes" checked={sizes === 'sample'} onChange={() => setSizes('sample')} />
                  The sample table (Ysolda Teague’s size chart, cm)
                </label>
                <label className="check">
                  <input type="radio" name="sizes" checked={sizes === 'import'} onChange={() => setSizes('import')} />
                  Import my own table next (CSV or pasted)
                </label>
              </div>
              <div className="field">
                <label>Gauge</label>
                <span className="inline">
                  <input className="num tiny" type="number" step="0.25" min={0} value={gauge.stitches} onChange={(e) => setGauge({ ...gauge, stitches: Number(e.target.value) })} aria-label="Stitches" />
                  <span className="muted">sts ×</span>
                  <input className="num tiny" type="number" step="0.25" min={0} value={gauge.rows} onChange={(e) => setGauge({ ...gauge, rows: Number(e.target.value) })} aria-label="Rows" />
                  <span className="muted">rows over {gauge.basis === '4in' ? '4 in' : '10 cm'}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="modal-foot pad">
          <button className="link" onClick={onSample}>Open the sample project instead</button>
          <span className="spacer" />
          <button onClick={onCancel}>Cancel</button>
          <button className="primary" onClick={() => void create()} disabled={busy || !(gauge.stitches > 0 && gauge.rows > 0)}>
            Create garment
          </button>
        </div>
      </div>
    </div>
  );
}

/** A small line sketch of each method. */
function MethodSketch({ method }: { method: GarmentMethod }) {
  const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' as const };
  const arrow = (x: number, y1: number, y2: number) => (
    <g {...s} strokeWidth={1.2}>
      <path d={`M${x} ${y1} V${y2}`} />
      <path d={y2 < y1 ? `M${x - 3} ${y2 + 4} L${x} ${y2} L${x + 3} ${y2 + 4}` : `M${x - 3} ${y2 - 4} L${x} ${y2} L${x + 3} ${y2 - 4}`} />
    </g>
  );
  return (
    <svg className="method-sketch" viewBox="0 0 80 56" aria-hidden="true">
      {method === 'seamed' && (
        <>
          <path {...s} d="M6 52 V22 L10 14 H18 Q22 18 26 14 H34 L38 22 V52 Z" />
          <path {...s} d="M44 52 L48 20 Q56 10 64 20 L68 52 Z" />
          {arrow(74, 50, 26)}
        </>
      )}
      {method === 'top-down' && (
        <>
          <path {...s} d="M22 52 V24 L12 30 L6 24 L22 10 H32 Q40 16 48 10 H58 L74 24 L68 30 L58 24 V52 Z" />
          <path {...s} strokeDasharray="2 2" d="M22 24 H58" />
          {arrow(40, 22, 46)}
        </>
      )}
      {(method === 'contiguous' || method === 'modified-raglan') && (
        <>
          <ellipse {...s} cx="40" cy="22" rx="30" ry="14" />
          <ellipse {...s} cx="40" cy="20" rx="9" ry="5" />
          <path {...s} d="M24 34 V52 H56 V34" />
          {arrow(40, 27, 48)}
        </>
      )}
      {method === 'raglan' && (
        <>
          <ellipse {...s} cx="40" cy="22" rx="30" ry="14" />
          <ellipse {...s} cx="40" cy="20" rx="9" ry="5" />
          <path {...s} d="M33 23 L20 34 M47 23 L60 34 M33 17 L22 10 M47 17 L58 10" strokeDasharray="2 1.5" />
          <path {...s} d="M24 34 V52 H56 V34" />
          {arrow(40, 27, 48)}
        </>
      )}
      {method === 'blank' && <rect {...s} strokeDasharray="3 3" x="16" y="10" width="48" height="40" rx="3" />}
    </svg>
  );
}
