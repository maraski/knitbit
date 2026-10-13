import { describe, expect, it } from 'vitest';
import { joinReport } from './joins';
import { newId, type EdgeRef, type Join, type Panel } from './model';
import { armholeLength, computePanel } from './panel';
import { bodice, sleeve } from './templates';
import { fixtureProject, sizeId } from './testFixtures';

const wp = (panel: Panel, n: string) => panel.waypoints.find((w) => w.name === n)!.id;
const side = (panel: Panel, s: 'left' | 'right', a: string, b: string): EdgeRef => ({ panelId: panel.id, edge: { kind: 'side', side: s, from: wp(panel, a), to: wp(panel, b) } });

function garment(direction: 'bottom-up' | 'top-down' = 'bottom-up') {
  const p = fixtureProject();
  const back = bodice('back', { direction });
  const front = bodice('front', { direction });
  const sl = sleeve('set-in', direction);
  p.panels = [back, front, sl];
  const seam: Join = {
    id: newId('join'),
    name: 'Sleeve',
    tag: 'seam',
    edges: [side(sl, 'left', 'underarm', 'cap_top'), side(sl, 'right', 'underarm', 'cap_top')],
    partner: [side(front, 'left', 'underarm', 'shoulder'), side(back, 'right', 'underarm', 'shoulder')],
    ratio: null,
    note: '',
  };
  return { p, back, front, sl, seam };
}

describe('sleeve cap follows the armhole', () => {
  it('cap edges ≈ armhole + cap_ease (1.5 cm) within 1 cm, every size, both directions', () => {
    for (const dir of ['bottom-up', 'top-down'] as const) {
      const { p, seam } = garment(dir);
      for (const s of p.sizes) {
        const r = joinReport(p, seam, s.id);
        expect(Math.abs(r.diffCm - 1.5), `${dir} ${s.name}: ${r.diffCm}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('measures Front + Back armholes when there is no seam join', () => {
    const { p, sl, front, back } = garment();
    const M = sizeId(p, 'M');
    const a = armholeLength(p, sl, M);
    expect('value' in a && a.source).toBe('Front + Back armholes');
    const f = computePanel(p, front, M);
    const b = computePanel(p, back, M);
    const r = joinReport(p, { ...garment().seam, edges: [side(front, 'left', 'underarm', 'shoulder')], partner: [side(back, 'left', 'underarm', 'shoulder')] }, M);
    expect('value' in a && a.value).toBeCloseTo(r.a.lengthCm + r.b!.lengthCm, 6);
    void f;
    void b;
  });

  it('prefers the seam join the sleeve belongs to', () => {
    const { p, sl, front, seam } = garment();
    const M = sizeId(p, 'M');
    p.joins = [{ ...seam, partner: [side(front, 'left', 'underarm', 'shoulder')] }]; // only the front armhole
    const a = armholeLength(p, sl, M);
    expect('value' in a && a.source).toBe('seam "Sleeve"');
    const front1 = joinReport(p, { ...seam, edges: [side(front, 'left', 'underarm', 'shoulder')], partner: [] }, M).a.lengthCm;
    expect('value' in a && a.value).toBeCloseTo(front1, 6);
  });

  it('a sleeve on its own uses an estimate and says so', () => {
    const p = fixtureProject();
    const sl = sleeve('set-in');
    p.panels = [sl];
    const c = computePanel(p, sl, sizeId(p, 'M'));
    expect(c.ok).toBe(true);
    expect(c.issues.some((i) => i.severity === 'info' && /armhole_len = .* from an estimate/.test(i.message))).toBe(true);
  });

  it('refuses a panel measuring itself', () => {
    const { p, front } = garment();
    front.waypoints.find((w) => w.name === 'armhole_end')!.height.expr = 'underarm.height + armhole_len * 0';
    const c = computePanel(p, front, sizeId(p, 'M'));
    expect(c.issues.some((i) => /armhole_len/.test(i.message))).toBe(true);
  });
});
