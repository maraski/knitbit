import { describe, expect, it } from 'vitest';
import { groupChecks, projectChecks, rootChecks, type Check } from './checks';
import { defaultEdges } from './edgeTreatments';
import { buildGarment, type GarmentSpec } from './garmentSetup';
import { issueKey } from './issues';
import { dim, type Project, type YokeSpec } from './model';
import { computePanel, type Issue } from './panel';
import { fixtureProject, sizeId } from './testFixtures';

const build = (method: GarmentSpec['method'], neckline: GarmentSpec['neckline'] = 'v') =>
  buildGarment({ ...fixtureProject(), panels: [], joins: [] }, { method, opening: 'closed', neckline, sleeve: method === 'seamed' || method === 'top-down' ? 'set-in' : method === 'contiguous' ? 'contiguous' : 'raglan', ease: 'standard', edges: defaultEdges() });
const editYoke = (p: Project, edit: (y: YokeSpec) => void): Project => ({
  ...p,
  panels: p.panels.map((x) => (x.yoke ? { ...x, yoke: (() => { const y = structuredClone(x.yoke!); edit(y); return y; })() } : x)),
});
// A yoke that fails in the smaller sizes: whole-neck short rows that end below the split (a deep front neck no longer
// fails: it continues into the front body).
const deepShortRows = (method: 'contiguous' | 'raglan') =>
  editYoke(build(method, 'round'), (y) => {
    y.start = 'neck';
    y.shortRows = { frontCo: dim(40), pairs: dim(34), first: dim(1), step: dim(1) };
  });
const yokeOf = (p: Project) => p.panels.find((x) => x.yoke)!;
const notInfo = (cs: Check[]) => cs.filter((c) => c.issue.severity !== 'info');

describe('knock-on folding: a yoke that cannot be computed', () => {
  for (const [method, failing] of [['contiguous', ['4XS', '3XS', '2XS']], ['raglan', ['4XS', '3XS', '2XS', 'XS', 'S', 'M']]] as const) {
    it(`${method}: short rows below the split are one error row (the yoke's), its knock-ons folded under it`, () => {
      const p = deepShortRows(method);
      const yoke = yokeOf(p);
      const checks = projectChecks(p);
      // No internal names reach the user.
      expect(checks.filter((c) => /Unknown name|yoke\.\*/.test(c.issue.message))).toEqual([]);
      const groups = groupChecks(notInfo(checks));
      const errorRows = groups.filter((g) => g.issue.severity === 'error');
      expect(errorRows).toHaveLength(1);
      const root = errorRows[0];
      expect(root.panelId).toBe(yoke.id);
      expect(root.issue.code).toBe('yoke.short-rows-below-split');
      expect(root.sizes.map((s) => s.name)).toEqual(failing);
      // Back, Front, both sleeves, and the joins that measure the yoke and the body.
      const where = root.knockOns.map((k) => (k.issue.ref.kind === 'join' ? 'join' : k.panelName));
      expect(new Set(where)).toEqual(new Set(['Back', 'Front', 'Left sleeve', 'Right sleeve', 'join']));
      expect(root.knockOns.every((k) => k.sizes.length === failing.length && k.issue.causedBy === root.key)).toBe(true);
      // Pills: one root error per failing size.
      expect(rootChecks(checks).filter((c) => c.issue.severity === 'error')).toHaveLength(failing.length);
    });

    it(`${method}: a piece waiting on the yoke reports one issue, without the "Unknown name" waypoint errors`, () => {
      const p = deepShortRows(method);
      const s = sizeId(p, '4XS');
      const yokeIssue = computePanel(p, yokeOf(p), s).issues.find((i) => i.severity === 'error')!;
      for (const name of ['Back', 'Front', 'Left sleeve', 'Right sleeve']) {
        const c = computePanel(p, p.panels.find((x) => x.name === name)!, s);
        expect(c.ok).toBe(false);
        expect(c.issues.filter((i) => i.severity === 'error')).toEqual([
          { severity: 'error', code: 'knock-on.yoke', message: `Waits on Yoke: ${yokeIssue.message}`, ref: { kind: 'panel' }, causedBy: issueKey(yokeOf(p).id, yokeIssue) },
        ]);
      }
    });
  }

  it('keeps an independent problem on the same piece as a root of its own', () => {
    const p0 = deepShortRows('contiguous');
    const p = { ...p0, panels: p0.panels.map((x) => (x.name === 'Back' ? { ...x, waypoints: x.waypoints.map((w, i) => (i === 0 ? { ...w, height: dim('no_such_name') } : w)) } : x)) };
    const back = computePanel(p, p.panels.find((x) => x.name === 'Back')!, sizeId(p, '4XS'));
    const errors = back.issues.filter((i) => i.severity === 'error');
    expect(errors.filter((i) => i.causedBy)).toHaveLength(1);
    expect(errors.filter((i) => !i.causedBy).map((i) => i.message)).toEqual([expect.stringMatching(/Unknown name "no_such_name"/)]);
    const top = groupChecks(notInfo(projectChecks(p))).filter((g) => g.issue.severity === 'error');
    expect(top.map((g) => g.panelName)).toEqual(['Yoke', 'Back']);
  });

  it('sizes where the yoke works have no knock-ons', () => {
    const p = deepShortRows('contiguous');
    expect(projectChecks(p).filter((c) => c.sizeName === 'M' && c.issue.causedBy)).toEqual([]);
  });
});

describe('knock-on folding: armhole_len and joins', () => {
  // A Front that can't be computed (an unknown name in its first waypoint).
  const brokenFront = () => {
    const p = build('seamed', 'round');
    return { ...p, panels: p.panels.map((x) => (x.name === 'Front' ? { ...x, waypoints: x.waypoints.map((w, i) => (i === 0 ? { ...w, width: dim('no_such_name') } : w)) } : x)) };
  };

  it("a sleeve whose armhole_len can't be measured waits on the Front's error", () => {
    const p = brokenFront();
    const s = sizeId(p, 'M');
    const front = p.panels.find((x) => x.name === 'Front')!;
    const frontError = computePanel(p, front, s).issues.find((i) => i.severity === 'error')!;
    const sleeves = p.panels.filter((x) => x.template?.startsWith('sleeve'));
    expect(sleeves.length).toBeGreaterThan(0);
    for (const sleeve of sleeves) {
      const errors = computePanel(p, sleeve, s).issues.filter((i) => i.severity === 'error');
      expect(errors).toEqual([expect.objectContaining({ code: 'knock-on.armhole', causedBy: issueKey(front.id, frontError), message: `Waits on Front: ${frontError.message}` })]);
    }
  });

  it("joins that can't measure the broken panel fold under its error", () => {
    const p = brokenFront();
    const checks = projectChecks(p).filter((c) => c.sizeName === 'M');
    const joinWarnings = checks.filter((c) => c.issue.ref.kind === 'join' && c.issue.severity === 'warning');
    expect(joinWarnings.length).toBeGreaterThan(0);
    expect(joinWarnings.every((c) => c.issue.code === 'knock-on.join' && c.issue.causedBy?.startsWith(`${p.panels.find((x) => x.name === 'Front')!.id}|`))).toBe(true);
    const groups = groupChecks(notInfo(checks));
    expect(groups.filter((g) => g.issue.severity === 'error').map((g) => g.panelName)).toEqual(['Front']);
    expect(rootChecks(notInfo(checks)).map((c) => c.panelName)).toEqual(['Front']);
  });
});

describe('groupChecks nesting', () => {
  const issue = (message: string, extra: Partial<Issue> = {}): Issue => ({ severity: 'error', message, ref: { kind: 'panel' }, ...extra });
  const check = (panelId: string, sizeName: string, i: Issue): Check => ({ panelId, panelName: panelId, sizeId: sizeName, sizeName, issue: i });
  const rootA = issue('Root on row 75 of 58.');
  const rootB = issue('Root on row 77 of 61.'); // the same problem in another size
  const key = issueKey('yoke', rootA);

  it('nests knock-ons under their root group, across sizes, and counts roots only', () => {
    const checks = [
      check('yoke', 'S', rootA),
      check('yoke', 'M', rootB),
      check('back', 'S', issue('Waits on Yoke: Root on row 75 of 58.', { causedBy: key })),
      check('back', 'M', issue('Waits on Yoke: Root on row 77 of 61.', { causedBy: key })),
      check('back', 'M', issue('Something else.')),
      check('front', 'S', { ...issue('Join: front edge cannot be measured.', { causedBy: key }), severity: 'warning' }),
    ];
    const groups = groupChecks(checks);
    expect(groups.map((g) => g.panelId)).toEqual(['yoke', 'back']);
    expect(groups[0].key).toBe(key);
    expect(groups[0].sizes.map((s) => s.name)).toEqual(['S', 'M']);
    expect(groups[0].knockOns.map((k) => [k.panelId, k.sizes.length])).toEqual([['back', 2], ['front', 1]]);
    expect(groups[1].knockOns).toEqual([]);
    expect(rootChecks(checks).map((c) => `${c.panelId} ${c.sizeName}`)).toEqual(['yoke S', 'yoke M', 'back M']);
  });

  it('shows a knock-on whose root is not in the list as a row of its own', () => {
    const checks = [check('back', 'S', issue('Waits on Yoke: Root on row 75 of 58.', { causedBy: key }))];
    expect(groupChecks(checks).map((g) => g.panelId)).toEqual(['back']);
    expect(rootChecks(checks)).toHaveLength(1);
  });
});

describe('fixes on the yoke and neckline errors', () => {
  const err = (p: Project, size: string, code: string) => computePanel(p, yokeOf(p), sizeId(p, size)).issues.find((i) => i.code === code);
  const needCm = (i: Issue | undefined) => Number(/([\d.]+) cm/.exec(i!.fix!.need!)![1]);

  for (const method of ['contiguous', 'raglan'] as const) {
    it(`${method}: short rows below the split name the pairs field and its limit, which works`, () => {
      const p = deepShortRows(method);
      const i = err(p, '4XS', 'yoke.short-rows-below-split')!;
      expect(i.fix).toMatchObject({ now: '34', fields: [{ target: 'yoke', key: 'srPairs', label: 'Short-row pairs' }, { key: 'extraDepth', label: 'Extra depth' }] });
      expect(i.fix!.text).toMatch(/^Make Short-row pairs at most \d+ \(now 34\), or add [\d.]+ cm to Extra depth\.$/);
      const most = Number(/≤ (\d+)/.exec(i.fix!.need!)![1]);
      const fixed = editYoke(p, (y) => void (y.shortRows!.pairs.overrides[sizeId(p, '4XS')] = most));
      expect(err(fixed, '4XS', 'yoke.short-rows-below-split')).toBeUndefined();
      expect(computePanel(fixed, yokeOf(fixed), sizeId(p, '4XS')).ok).toBe(true);
    });

    it(`${method}: a 25 cm V is no error: the neck continues into the front body`, () => {
      const p = editYoke(build(method), (y) => void (y.neck.depth = dim(25)));
      const i = computePanel(p, yokeOf(p), sizeId(p, '4XS')).issues.find((x) => x.code === 'yoke.neck-continues')!;
      expect(i.severity).toBe('info');
      expect(projectChecks(p).filter((c) => c.issue.severity === 'error')).toEqual([]);
    });
  }

  it('the shoulder phase names Back width after the markers move and its minimum, which works', () => {
    const p = editYoke(build('contiguous', 'round'), (y) => {
      y.start = 'back';
      y.shoulder.mode = 'cross-back';
      y.shoulder.backWidth = dim(5);
    });
    const i = err(p, 'M', 'yoke.shoulder-phase')!;
    expect(i.fix).toMatchObject({ now: '5 cm', fields: [{ key: 'backWidth', label: 'Back width after the markers move' }, { key: 'neckWidth' }] });
    const fixed = editYoke(p, (y) => void (y.shoulder.backWidth = dim(needCm(i))));
    expect(err(fixed, 'M', 'yoke.shoulder-phase')).toBeUndefined();
  });

  it('short rows: too many pairs name Short-row pairs and the most that fit', () => {
    const p = editYoke(build('modified-raglan', 'round'), (y) => void (y.shortRows!.pairs = dim(60)));
    const fit = err(p, 'M', 'yoke.short-rows-fit')!;
    expect(fit.fix).toMatchObject({ now: '60', fields: [{ key: 'srPairs', label: 'Short-row pairs' }, { key: 'srStep' }] });
    const most = Number(fit.fix!.need!.replace('≤ ', ''));
    const fixed = editYoke(p, (y) => void (y.shortRows!.pairs = dim(most)));
    expect(err(fixed, 'M', 'yoke.short-rows-fit')).toBeUndefined();
    expect(err(p, 'M', 'yoke.short-rows-below-split')?.fix?.fields[0].key).toBe('srPairs');
  });

  it('neck wider than the panel names the Opening width and its limit', () => {
    const p0 = build('seamed', 'round');
    const front = p0.panels.find((x) => x.name === 'Front')!;
    const p = { ...p0, panels: p0.panels.map((x) => (x.id === front.id ? { ...x, neckline: { ...x.neckline!, width: dim(`${x.neckline!.width.expr} + 4`) } } : x)) };
    const i = computePanel(p, p.panels.find((x) => x.id === front.id)!, sizeId(p, 'M')).issues.find((x) => x.code === 'neckline.wider-than-top')!;
    expect(i.message).toMatch(/^Neck wider than the panel/);
    expect(i.fix).toMatchObject({ fields: [{ target: 'neckline', panelId: front.id, key: 'width', label: 'Opening width' }] });
    expect(i.fix!.text).toMatch(/^Make the neckline's Opening width at most [\d.]+ cm \(now [\d.]+ cm\)/);
  });
});
