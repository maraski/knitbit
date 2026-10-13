// SVG glyphs for chart cells, drawn in a unit square (0,0)–(1,1) and scaled by the caller.
// Shapes follow the common (Craft Yarn Council style) chart conventions.

import type { CustomSymbol } from '../engine/model';
import { HELD, HOLD, PLAIN } from '../engine/chart';

/** Background tint of a cell, by meaning. */
export function cellFill(id: string, custom: CustomSymbol[] = []): string {
  const c = custom.find((x) => x.id === id);
  if (c) return c.color;
  switch (id) {
    case 'bo':
      return 'var(--cell-bo)';
    case 'co':
      return 'var(--cell-co)';
    case HOLD:
      return 'var(--cell-hold)';
    case 'nostitch':
      return 'var(--cell-none)';
    case 'k2tog':
    case 'ssk':
    case 'sk2p':
    case 's2kp':
      return 'var(--cell-dec)';
    case 'm1l':
    case 'm1r':
    case 'kfb':
    case 'yo':
      return 'var(--cell-inc)';
    case 'turn-wt':
    case 'turn-german':
      return 'var(--cell-turn)';
    default:
      return 'var(--cell)';
  }
}

/** Strong colour used when the chart is zoomed too far out to draw glyphs. */
export function bandColor(id: string, custom: CustomSymbol[] = []): string | null {
  const c = custom.find((x) => x.id === id);
  if (c) return c.color;
  if (id === PLAIN || id === HELD || id === '' || id === 'knit') return null;
  if (id === 'bo') return 'var(--bo)';
  if (id === 'co' || id === 'm1l' || id === 'm1r' || id === 'kfb' || id === 'yo') return 'var(--inc)';
  if (id.startsWith('turn')) return 'var(--turn)';
  if (id === 'k2tog' || id === 'ssk' || id === 'sk2p' || id === 's2kp') return 'var(--dec)';
  return 'var(--muted)';
}

/** The glyph strokes for a symbol, in unit coordinates. */
export function Glyph({ id, custom = [] }: { id: string; custom?: CustomSymbol[] }) {
  const c = custom.find((x) => x.id === id);
  if (c) {
    return (
      <text x={0.5} y={0.68} textAnchor="middle" className="glyph-text" style={{ fontSize: c.abbr.length > 2 ? 0.34 : 0.5 }}>
        {c.abbr}
      </text>
    );
  }
  switch (id) {
    case PLAIN:
    case 'knit':
    case HELD:
      return null;
    case 'purl':
      return <circle cx={0.5} cy={0.5} r={0.12} className="glyph-fill" />;
    case 'yo':
      return <circle cx={0.5} cy={0.5} r={0.24} className="glyph" />;
    case 'k2tog':
      return <path d="M0.2,0.8 L0.8,0.2" className="glyph" />;
    case 'ssk':
      return <path d="M0.2,0.2 L0.8,0.8" className="glyph" />;
    case 'sk2p':
      return <path d="M0.2,0.8 L0.5,0.2 L0.8,0.8" className="glyph" />;
    case 's2kp':
      return <path d="M0.2,0.8 L0.5,0.2 L0.8,0.8 M0.5,0.2 L0.5,0.85" className="glyph" />;
    case 'm1l':
      return <path d="M0.25,0.8 L0.25,0.3 Q0.25,0.2 0.38,0.2 L0.75,0.2 M0.25,0.3 L0.62,0.62" className="glyph" />;
    case 'm1r':
      return <path d="M0.75,0.8 L0.75,0.3 Q0.75,0.2 0.62,0.2 L0.25,0.2 M0.75,0.3 L0.38,0.62" className="glyph" />;
    case 'kfb':
      return <path d="M0.25,0.25 L0.5,0.55 L0.75,0.25 M0.5,0.55 L0.5,0.82" className="glyph" />;
    case 'slip':
      return <path d="M0.25,0.25 L0.5,0.8 L0.75,0.25" className="glyph" />;
    case 'nostitch':
      return null;
    case 'turn-german':
      return <path d="M0.5,0.18 L0.82,0.5 L0.5,0.82 L0.18,0.5Z" className="glyph-fill" />;
    case 'turn-wt':
      return (
        <>
          <path d="M0.5,0.18 L0.82,0.5 L0.5,0.82 L0.18,0.5Z" className="glyph" />
          <circle cx={0.5} cy={0.5} r={0.08} className="glyph-fill" />
        </>
      );
    case 'bo':
      return <path d="M0.22,0.5 Q0.5,0.2 0.78,0.5" className="glyph" />;
    case 'co':
      return <path d="M0.22,0.5 Q0.5,0.8 0.78,0.5" className="glyph" />;
    case HOLD:
      return <path d="M0.3,0.25 L0.3,0.75 M0.7,0.25 L0.7,0.75 M0.3,0.5 L0.7,0.5" className="glyph" />;
    case 'buttonhole':
      return <rect x={0.22} y={0.36} width={0.56} height={0.28} rx={0.12} className="glyph" />;
    case 'c4f':
      return <path d="M0.15,0.8 L0.85,0.2 M0.15,0.2 L0.4,0.42 M0.6,0.58 L0.85,0.8" className="glyph" />;
    case 'c4b':
      return <path d="M0.15,0.2 L0.85,0.8 M0.85,0.2 L0.6,0.42 M0.4,0.58 L0.15,0.8" className="glyph" />;
    default:
      return (
        <text x={0.5} y={0.66} textAnchor="middle" className="glyph-text" style={{ fontSize: 0.34 }}>
          {id.slice(0, 3)}
        </text>
      );
  }
}

/** A legend swatch: one cell with its glyph. */
export function Swatch({ id, custom = [], size = 18 }: { id: string; custom?: CustomSymbol[]; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="-0.05 -0.05 1.1 1.1" className="swatch-cell">
      <rect x={0} y={0} width={1} height={1} fill={id === HELD ? 'url(#held-hatch-unit)' : cellFill(id, custom)} className="cell-border" />
      {id === HELD && (
        <defs>
          <pattern id="held-hatch-unit" patternUnits="userSpaceOnUse" width={0.25} height={0.25} patternTransform="rotate(45)">
            <rect width={0.25} height={0.25} fill="var(--cell-held)" />
            <line x1={0} y1={0} x2={0} y2={0.25} stroke="var(--line-strong)" strokeWidth={0.08} />
          </pattern>
        </defs>
      )}
      <Glyph id={id} custom={custom} />
    </svg>
  );
}
