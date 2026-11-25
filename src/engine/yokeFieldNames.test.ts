import { describe, expect, it } from 'vitest';
import { yokeFieldNames } from './contiguous';
import { buildGarment, necklinesFor, sleevesFor, type GarmentSpec } from './garmentSetup';
import { buildScope, evaluateDim } from './measurements';
import { dim, type DimExpr } from './model';
import { computePanel } from './panel';
import { setStrap } from './strap';
import { fixtureProject } from './testFixtures';

describe('yoke property fields', () => {
  // The panels work each cm field with these names: every field that has no error in the generator has none there.
  for (const method of ['raglan', 'modified-raglan', 'contiguous'] as const) {
    for (const neckline of necklinesFor(method)) {
      for (const strap of [false, true]) {
        it(`${method} × ${neckline}${strap ? ' × strap' : ''}: every cm field works in every size`, () => {
          const spec: GarmentSpec = { method, opening: 'closed', neckline, sleeve: sleevesFor(method)[0], ease: 'standard' };
          let p = buildGarment({ ...fixtureProject(), panels: [], joins: [] }, spec);
          if (strap) p = setStrap(p, { width: dim(8), gives: 'neck' });
          const panel = p.panels.find((x) => x.yoke)!;
          const k = panel.yoke!;
          const fields: Record<string, DimExpr | undefined> = {
            neckWidth: k.neck.width, neckDepth: k.neck.depth, neckCentre: k.neck.centre, neckBackDepth: k.neck.backDepth,
            backLength: k.depth.backLength, extra: k.depth.extra, bodyWidth: k.body.width, sleeveWidth: k.sleeveWidth,
            underarmCo: k.underarm.castOn, backWidth: k.shoulder.backWidth, sleeveTop: k.raglan?.sleeveTop,
          };
          for (const s of p.sizes) {
            const y = computePanel(p, panel, s.id).yoke!;
            const scope = buildScope(p, s.id);
            for (const [name, d] of Object.entries(fields)) {
              if (!d) continue;
              const r = evaluateDim(d, s.id, { ...scope, ...yokeFieldNames(y, scope) });
              expect(r.ok, `${s.name} ${name}: ${r.ok ? '' : r.error}`).toBe(true);
              // The same value as the yoke is worked with.
              const worked = y.params[name]?.value;
              if (r.ok && worked !== undefined && y.params[name].unit === 'cm' && y.params[name].expr === d.expr) expect(r.value.value, `${s.name} ${name}`).toBeCloseTo(worked, 6);
            }
          }
        });
      }
    }
  }
});
