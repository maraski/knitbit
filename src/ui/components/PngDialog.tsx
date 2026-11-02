import { useEffect, useState } from 'react';
import type { PngScale } from '../../export/png';
import type { PngSpec } from '../../export/pngViews';
import { downloadBlob } from '../fileio';
import './ExportDialog.css';

const KEY = 'knitbit.png.v1';

function readScale(): number {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}').scale;
    return v === 1 || v === 3 ? v : 2;
  } catch {
    return 2;
  }
}

function saveScale(scale: number): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ scale }));
  } catch {
    /* ignore: private mode or storage blocked */
  }
}

interface Props {
  /** What's on screen (the pane's size and the chart's collapse setting are read here). */
  view: Omit<PngSpec, 'width' | 'height' | 'collapse'>;
  onClose: () => void;
}

/** The view state plus the drawing pane's size (the image is drawn at it) and the Chart tab's collapse setting. */
function specFor(view: Props['view']): PngSpec {
  const pane = document.querySelector('section.center > .canvas, section.center > .chart-view')?.getBoundingClientRect();
  let collapse = false;
  try {
    collapse = !!JSON.parse(localStorage.getItem('knitbit.chart.v1') ?? '{}').collapse;
  } catch {
    /* ignore */
  }
  return { ...view, width: pane?.width || 1000, height: pane?.height || 700, collapse };
}

/** Save the view on screen as a PNG at 1×, 2× or 3×. */
export function PngDialog({ view, onClose }: Props) {
  // Taken once, when the dialog opens: what was on screen then.
  const [spec] = useState(() => specFor(view));
  const [scale, setScaleState] = useState(readScale);
  const [sizes, setSizes] = useState<PngScale[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [what, setWhat] = useState('The view');

  // The image's size at each scale, and whether the canvas limit lowers it.
  useEffect(() => {
    let live = true;
    import('../../export/png')
      .then(async (m) => {
        if (live) setWhat(m.describe(spec));
        const s = await m.pngSizes(spec);
        if (live) setSizes(s);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [spec]);

  const setScale = (s: number) => {
    setScaleState(s);
    saveScale(s);
  };
  const chosen = sizes?.find((_, i) => i + 1 === scale);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      const { buildPng } = await import('../../export/png');
      const r = await buildPng(spec, scale);
      downloadBlob(r.fileName, r.blob);
      // The scale had to drop: say so and leave the dialog open; otherwise done.
      if (r.note) setNote(r.note);
      else onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal export-dialog png-dialog" role="dialog" aria-label="Export PNG">
        <div className="modal-head">
          <h3>Export PNG</h3>
          <button className="icon" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </div>
        <div className="modal-body">
          <p className="hint">
            {what}, as on screen, on a white background{spec.view === 'chart' && spec.mode !== 'grid' && !(spec.yoke === 'top' && spec.project.panels.find((p) => p.id === spec.panelId)?.yoke) ? ': the whole chart, every row, with its key' : ''}.
          </p>
          <div className="field">
            <label>Resolution</label>
            <div className="segmented">
              {[1, 2, 3].map((s) => (
                <button key={s} className={scale === s ? 'active' : ''} onClick={() => setScale(s)} disabled={busy}>
                  {s}×
                </button>
              ))}
            </div>
            <span className="muted small">
              {chosen ? `${chosen.width} × ${chosen.height} px` : sizes ? '' : 'Measuring…'}
            </span>
          </div>
          {chosen?.limited && !note && (
            <p className="hint warn" role="status">
              At {scale}× this image would be bigger than the browser can draw: it will be saved at {+chosen.scale.toFixed(1)}× instead.
            </p>
          )}
          {note && <p className="hint warn" role="status">Saved. {note}</p>}
          {error && <p className="err small">Export failed: {error}</p>}
        </div>
        <div className="modal-foot pad">
          {busy && <span className="muted small">Drawing the image…</span>}
          <span className="spacer" />
          <button onClick={onClose} disabled={busy}>{note ? 'Close' : 'Cancel'}</button>
          {!note && (
            <button className="primary" onClick={() => void run()} disabled={busy || !sizes}>
              Export PNG
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
