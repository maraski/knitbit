import { CONTIGUOUS_CREDIT } from '../../engine/garment';
export const SIZING_CREDIT = 'Body measurements adapted from Ysolda Teague’s designer size chart, ysolda.com/designer-size-chart';

export function AboutBox({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal about" role="dialog" aria-label="About Knitbit">
        <div className="modal-head">
          <h3>About Knitbit</h3>
          <button className="icon" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">
          <p>A local-only panel and shaping visualizer for knitted women’s tops. Nothing leaves this browser.</p>
          <h4>Sizing data</h4>
          <p>
            Body measurements adapted from Ysolda Teague’s designer size chart,{' '}
            <a href="https://ysolda.com/designer-size-chart" target="_blank" rel="noreferrer">ysolda.com/designer-size-chart</a>. The sample table (sizes 4XS to 4X, centimetres) averages pairs of grade columns from the 2026, 5 cm grade
            version of the chart; the 4XS row is an estimate and is marked “est”.
          </p>
          <p className="hint">
            The adapted table is for personal use only and should not be redistributed as a chart.
          </p>
          <h4>Contiguous method</h4>
          <p>
            The contiguous construction follows the contiguous sleeve method developed by Susie Myers, SusieM on Ravelry (
            <a href="http://www.ravelry.com/people/SusieM" target="_blank" rel="noreferrer">ravelry.com/people/SusieM</a>): a top-down yoke worked in one piece from the
            back neck, with set-in-look sleeves. Knitbit models its phases; it is her method, not a pattern.
          </p>
          <p className="hint">Projects using it are tagged “contiguous”, and exports carry: “{CONTIGUOUS_CREDIT}”.</p>
          <div className="modal-foot">
            <button className="primary" onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}
