import { useMemo, useState } from 'react';
import type { Id, Project } from '../../engine/model';
import { pdfFileName } from '../../export/fileName';
import { orderedSizes, readySections, SECTIONS, type Paper, type SectionId } from '../../export/plan';
import { unprintable } from '../../export/text';
import { downloadBlob } from '../fileio';
import './ExportDialog.css';

const KEY = 'knitbit.export.v1';

function readPaper(): Paper {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}').paper;
    return v === 'letter' ? 'letter' : 'a4';
  } catch {
    return 'a4';
  }
}

function savePaper(paper: Paper): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ paper }));
  } catch {
    /* ignore: private mode or storage blocked */
  }
}

/** Text the PDF prints that Helvetica can't draw: where it is and which characters. */
function printProblems(project: Project): { where: string; chars: string[] }[] {
  const items: { where: string; text: string }[] = [
    { where: 'Project name', text: project.name },
    ...project.sizes.map((s) => ({ where: `Size “${s.name}”`, text: s.name })),
    ...project.panels.map((p) => ({ where: `Piece “${p.name}”`, text: p.name })),
    ...project.measurements.map((m) => ({ where: `Measurement “${m.name}”`, text: m.label })),
    ...(project.symbols ?? []).map((s) => ({ where: `Symbol “${s.label}”`, text: `${s.label} ${s.abbr}` })),
  ];
  return items.map((i) => ({ where: i.where, chars: unprintable(i.text) })).filter((i) => i.chars.length);
}

interface Props {
  project: Project;
  sizeId: Id;
  onClose: () => void;
}

/** Export a PDF to knit from: the sizes to include, the paper and the sections. */
export function ExportDialog({ project, sizeId, onClose }: Props) {
  const [sizes, setSizes] = useState<Id[]>([sizeId]);
  const [paper, setPaperState] = useState<Paper>(readPaper);
  const [sections, setSections] = useState<SectionId[]>(readySections);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const problems = useMemo(() => printProblems(project), [project]);
  const ticked = orderedSizes(project, sizes);

  const setPaper = (p: Paper) => {
    setPaperState(p);
    savePaper(p);
  };
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);

  const run = async () => {
    setError(null);
    setBusy('Loading…');
    try {
      const { buildPdf } = await import('../../export/pdf');
      const blob = await buildPdf(project, { sizeIds: ticked, paper, sections }, { onProgress: (d, t) => setBusy(`Building the PDF (${d} of ${t})…`) });
      downloadBlob(pdfFileName(project.name, ticked.map((id) => project.sizes.find((s) => s.id === id)!.name)), blob);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal export-dialog" role="dialog" aria-label="Export PDF">
        <div className="modal-head">
          <h3>Export PDF</h3>
          <button className="icon" onClick={onClose} aria-label="Close" disabled={!!busy}>×</button>
        </div>
        <div className="modal-body">
          <p className="hint">A working copy to knit from: the gauge, the size tables and a schematic of every piece for the sizes you tick.</p>
          <div className="export-grid">
            <div className="field">
              <label>Sizes</label>
              <div className="export-sizes">
                {project.sizes.map((s) => (
                  <label key={s.id} className="check">
                    <input type="checkbox" checked={sizes.includes(s.id)} onChange={() => setSizes(toggle(sizes, s.id))} />
                    {s.name}
                    {s.id === project.baseSizeId && <span className="muted small"> (base)</span>}
                  </label>
                ))}
              </div>
              <span className="inline small">
                <button className="link" onClick={() => setSizes(project.sizes.map((s) => s.id))}>All</button>
                <button className="link" onClick={() => setSizes([sizeId])}>Just this size</button>
              </span>
            </div>
            <div>
              <div className="field">
                <label>Paper</label>
                <div className="segmented">
                  {(['a4', 'letter'] as const).map((p) => (
                    <button key={p} className={paper === p ? 'active' : ''} onClick={() => setPaper(p)}>
                      {p === 'a4' ? 'A4' : 'US Letter'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label>Sections</label>
                <label className="check">
                  <input type="checkbox" checked disabled /> Header (name, gauge, units, sizes)
                </label>
                {SECTIONS.filter((s) => s.ready).map((s) => (
                  <label key={s.id} className="check">
                    <input type="checkbox" checked={sections.includes(s.id)} onChange={() => setSections(toggle(sections, s.id))} />
                    {s.label}
                  </label>
                ))}
                <span className="hint">Stitch charts are coming next.</span>
              </div>
            </div>
          </div>
          {problems.length > 0 && (
            <div className="hint warn export-warn" role="status">
              Some characters can’t be printed with the PDF’s font and will show as “?”:
              <ul>
                {problems.map((p, i) => (
                  <li key={i}>
                    {p.where}: {p.chars.join(' ')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {error && <p className="err small">Export failed: {error}</p>}
        </div>
        <div className="modal-foot pad">
          {busy && <span className="muted small">{busy}</span>}
          <span className="spacer" />
          <button onClick={onClose} disabled={!!busy}>Cancel</button>
          <button className="primary" onClick={() => void run()} disabled={!!busy || ticked.length === 0}>
            Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}
