// The issue catalogue: every code the engine reports is in it (and docs/issues.md), every error and warning has a fix,
// the plan's examples name their field with now/need, and Apply clears them. `UPDATE_ISSUES_DOC=1 npx vitest run
// src/engine/issueCatalogue.test.ts` rewrites docs/issues.md from the catalogue.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyAcrossSizes, applyFix, applySummary, sizesText } from './applyFix';
import { projectChecks } from './checks';
import { defaultEdges } from './edgeTreatments';
import { buildGarment, type GarmentSpec } from './garmentSetup';
import { ISSUE_CATALOGUE } from './issueCatalogue';
import { YOKE_LABELS } from './issues';
import { dim, type Project, type YokeSpec } from './model';
import { defaultOffShoulder } from './raglan';
import { fixtureProject, sizeId } from './testFixtures';

const ENGINE = join(__dirname);
const DOC = join(__dirname, '../../docs/issues.md');

// ---------- the catalogue against the source ----------

/** Codes in the engine's source: `code: '…'`, the checks' push(…, 'code') and the knock-on / source codes. */
function sourceCodes(): Set<string> {
  const prefixes = new Set(Object.keys(ISSUE_CATALOGUE).map((c) => c.split('.')[0]));
  const out = new Set<string>();
  for (const f of readdirSync(ENGINE).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts') && !['issueCatalogue.ts', 'strap.ts'].includes(x))) {
    const src = readFileSync(join(ENGINE, f), 'utf8');
    for (const m of src.matchAll(/'([a-z]+(?:-on)?)\.([a-z]+(?:-[a-z]+)*)'(?!\s*:)/g)) if (prefixes.has(m[1]) && !/_/.test(m[2])) out.add(`${m[1]}.${m[2]}`);
  }
  // `source.*` codes are made from the knock-on codes (no yoke / armhole / edge to measure).
  for (const k of ['knock-on.yoke', 'knock-on.armhole', 'knock-on.edge']) if (out.has(k)) out.add(k.replace('knock-on.', 'source.'));
  // Not issue codes: a yoke name (strap.ts, left out above, names fields 'neckline.width' etc.).
  for (const n of ['yoke.depth']) out.delete(n);
  return out;
}

/** docs/issues.md, from the catalogue. */
function issuesDoc(): string {
  const groups: Record<string, string> = {
    panel: 'Panels', waypoint: 'Panels', section: 'Panels', segment: 'Segments', neckline: 'Necklines', body: 'Necklines', paint: 'Painted stitches',
    'knock-on': 'Values from other pieces', source: 'Values from other pieces', bust: 'Bust shaping', line: 'Shaping lines', yoke: 'Contiguous yoke (and the raglan necks)',
    raglan: 'Raglan', joins: 'Joins', join: 'Joins', fit: 'Fit checks', sleeve: 'Short sleeves', bands: 'Bands and buttons', buttons: 'Bands and buttons',
  };
  const lines = [
    '# Checks: every issue code',
    '',
    '_Generated from `src/engine/issueCatalogue.ts` by `src/engine/issueCatalogue.test.ts` (run it with `UPDATE_ISSUES_DOC=1` after adding a code); the test fails when a code is missing._',
    '',
    'Severity: **error** = can\'t be knitted as written (no chart or pattern); **warning** = can be knitted, but probably not what you want (fit, rounding that changes a width, a false-looking shape); **info** = how it will be worked, or a choice the app made. Knock-ons take their root\'s severity and are counted once.',
    '',
    'Every error and warning has a **Fix** naming the field as the properties show it, this size\'s value (now) and what it needs, with *Go to field*; *Apply* marks a one-click change (per-size overrides for the failing sizes, or the expression when every size needs the same value; one undo step).',
  ];
  let last = '';
  for (const [code, e] of Object.entries(ISSUE_CATALOGUE)) {
    const g = groups[code.split('.')[0]] ?? 'Other';
    if (g !== last) {
      lines.push('', `## ${g}`, '', '| Code | Severity | Message | Cause | Fix |', '|---|---|---|---|---|');
      last = g;
    }
    const cell = (s: string | undefined) => (s ?? '—').replace(/\|/g, '\\|');
    lines.push(`| \`${code}\` | ${e.severity} | ${cell(e.message)} | ${cell(e.cause)} | ${cell(e.fix)} |`);
  }
  return lines.join('\n') + '\n';
}

describe('issue catalogue', () => {
  it('has every code the engine reports, and no stale ones', () => {
    const src = sourceCodes();
    expect([...src].filter((c) => !(c in ISSUE_CATALOGUE)).sort()).toEqual([]);
    expect(Object.keys(ISSUE_CATALOGUE).filter((c) => !src.has(c)).sort()).toEqual([]);
  });

  it('gives every error and warning a fix', () => {
    for (const [code, e] of Object.entries(ISSUE_CATALOGUE)) if (e.severity !== 'info') expect(e.fix, code).toBeTruthy();
  });

  it('docs/issues.md is up to date', () => {
    const want = issuesDoc();
    if (process.env.UPDATE_ISSUES_DOC) writeFileSync(DOC, want);
    expect(readFileSync(DOC, 'utf8')).toBe(want);
  });

  it('names yoke fields as the properties label them', () => {
    const ui = ['YokeProps.tsx', 'RaglanProps.tsx'].map((f) => readFileSync(join(__dirname, '../ui/components', f), 'utf8')).join('\n');
    for (const [key, label] of Object.entries(YOKE_LABELS)) expect(ui.includes(label), `${key}: ${label}`).toBe(true);
  });
});

// ---------- every issue in a range of garments ----------

const base = () => ({ ...fixtureProject(), panels: [], joins: [] });
const sleeveFor = (m: GarmentSpec['method']): GarmentSpec['sleeve'] => (m === 'seamed' || m === 'top-down' ? 'set-in' : m === 'contiguous' || m === 'modified-raglan' ? 'contiguous' : 'raglan');
const build = (method: GarmentSpec['method'], neckline: GarmentSpec['neckline'] = 'round', opening: GarmentSpec['opening'] = 'closed') =>
  buildGarment(base(), { method, opening, neckline, sleeve: sleeveFor(method), ease: 'standard', edges: defaultEdges() });
const editYoke = (p: Project, edit: (y: YokeSpec) => void): Project => ({
  ...p,
  panels: p.panels.map((x) => (x.yoke ? { ...x, yoke: (() => { const y = structuredClone(x.yoke!); edit(y); return y; })() } : x)),
});
const withFront = (p: Project, edit: (f: Project['panels'][number]) => Project['panels'][number]): Project => ({ ...p, panels: p.panels.map((x) => (x.name === 'Front' ? edit(x) : x)) });

/** Garments that work and garments that fail in the ways the plan describes. */
function garments(): [string, Project][] {
  const out: [string, Project][] = [];
  for (const method of ['seamed', 'top-down', 'contiguous', 'raglan', 'modified-raglan'] as const) {
    for (const neck of ['round', 'v', 'boat'] as const) {
      if (method === 'modified-raglan' && neck === 'v') continue;
      for (const opening of ['closed', 'cardigan'] as const) out.push([`${method} ${neck} ${opening}`, build(method, neck, opening)]);
    }
  }
  out.push(['raglan off-shoulder', build('raglan', 'off-shoulder')]);
  out.push(['seamed neck +4 cm', withFront(build('seamed'), (f) => ({ ...f, neckline: { ...f.neckline!, width: dim(`${f.neckline!.width.expr} + 4`) } }))]);
  out.push(['seamed neck 1 cm deep', withFront(build('seamed'), (f) => ({ ...f, neckline: { ...f.neckline!, depth: dim(1) } }))]);
  out.push(['contiguous no shoulders', editYoke(build('contiguous'), (y) => void (y.shoulder.backWidth = dim(5)))]);
  out.push(['modified raglan 15 cm', editYoke(build('modified-raglan'), (y) => void (y.neck.depth = dim(15)))]);
  out.push(['modified raglan 20 pairs', editYoke(build('modified-raglan'), (y) => void (y.shortRows!.pairs = dim(20)))]);
  out.push(['raglan shallow', editYoke(build('raglan'), (y) => void (y.depth.backLength = dim(10)))]);
  out.push(['off-shoulder band ease', editYoke(build('raglan', 'off-shoulder'), (y) => void (y.offShoulder = { ...(y.offShoulder ?? defaultOffShoulder()), bandEase: dim(-0.03) }))]);
  return out;
}
const ALL = garments().map(([name, p]) => [name, p, projectChecks(p)] as const);

describe('every issue', () => {
  it('has a catalogued code; errors and warnings have a fix with a field', () => {
    const bad: string[] = [];
    for (const [name, , checks] of ALL) {
      for (const { issue: i, panelName } of checks) {
        const where = `${name} · ${panelName}: ${i.message}`;
        if (!i.code || !(i.code in ISSUE_CATALOGUE)) bad.push(`no code: ${where}`);
        else if (!ISSUE_CATALOGUE[i.code].severity.includes(i.severity)) bad.push(`severity ${i.severity} not ${ISSUE_CATALOGUE[i.code].severity}: ${where}`);
        if (i.severity !== 'info' && !i.fix?.text) bad.push(`no fix: ${where}`);
        if (i.severity !== 'info' && !i.causedBy && !i.fix?.fields.length) bad.push(`no field: ${where}`);
        if (/Unknown name|yoke\.\*|neck_side/.test(i.message + (i.fix?.text ?? ''))) bad.push(`internal name: ${where}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---------- the plan's examples: Fix line, field with now/need, Apply clears it ----------

/** The check groups with this code (all sizes), and the project after applying the group's fix. */
function applyCode(p: Project, code: string) {
  const all = projectChecks(p);
  const checks = all.filter((c) => c.issue.code === code);
  const a = checks.length ? applyAcrossSizes(all, checks[0].panelId, checks[0].issue) : null;
  return { checks, a, after: a ? applyFix(p, a.field, a.values) : null };
}

describe('plan examples', () => {
  const examples: [string, () => Project, string, string, boolean][] = [
    ['seamed neckline width +4 cm only', () => ALL.find(([n]) => n === 'seamed neck +4 cm')![1], 'neckline.wider-than-top', 'Opening width', true],
    ['contiguous shoulder phase with no rows', () => ALL.find(([n]) => n === 'contiguous no shoulders')![1], 'yoke.shoulder-phase', 'Back width after the markers move', true],
    ['modified raglan, 20 short-row pairs', () => ALL.find(([n]) => n === 'modified raglan 20 pairs')![1], 'yoke.short-rows-fit', 'Short-row pairs', true],
    ['raglan shallow split', () => ALL.find(([n]) => n === 'raglan shallow')![1], 'raglan.shallow-split', 'Extra depth', true],
    ['band ease', () => ALL.find(([n]) => n === 'off-shoulder band ease')![1], 'raglan.band-ease-loose', 'Band ease', true],
  ];
  for (const [title, make, code, label, applies] of examples) {
    it(`${title}: Fix names ${label} with now / need${applies ? ', and Apply clears it in one change' : ''}`, () => {
      const p = make();
      const { checks, a, after } = applyCode(p, code);
      expect(checks.length).toBeGreaterThan(0);
      const fix = checks[0].issue.fix!;
      expect(fix.fields[0].label).toBe(label);
      expect(fix.fields[0].panelId).toBeTruthy();
      expect(fix.now).toBeTruthy();
      expect(fix.need).toBeTruthy();
      expect(fix.text).toContain(label);
      if (!applies) return;
      expect(a).toBeTruthy();
      expect(after).toBeTruthy();
      expect(projectChecks(after!).filter((c) => c.issue.code === code)).toEqual([]);
    });
  }

  it('yoke extra depth: the armhole-short fix deepens the yoke', () => {
    const p = editYoke(build('contiguous'), (y) => {
      y.shoulder.mode = 'length';
      y.shoulder.length = dim(40);
      y.depth.deepen = false;
    });
    const { checks, a, after } = applyCode(p, 'yoke.armhole-short');
    expect(checks.length).toBeGreaterThan(0);
    expect(a!.field.key).toBe('extraDepth');
    expect(projectChecks(after!).filter((c) => c.issue.code === 'yoke.armhole-short')).toEqual([]);
  });

  it('neckline depth: a round neck too shallow for its width gets a deeper neck', () => {
    const p = ALL.find(([n]) => n === 'seamed neck 1 cm deep')![1];
    const { checks, a, after } = applyCode(p, 'neckline.fit');
    expect(checks.length).toBeGreaterThan(0);
    expect(a!.field).toMatchObject({ target: 'neckline', key: 'depth' });
    expect(projectChecks(after!).filter((c) => c.issue.code === 'neckline.fit')).toEqual([]);
  });
});

// ---------- Apply ----------

describe('applyFix', () => {
  const p = build('contiguous');
  const yoke = p.panels.find((x) => x.yoke)!;
  const f = { target: 'yoke' as const, panelId: yoke.id, key: 'extraDepth', label: 'Extra depth' };
  const ids = p.sizes.map((s) => s.id);

  it('overrides only the failing sizes', () => {
    const after = applyFix(p, f, [{ sizeId: ids[0], value: 2 }, { sizeId: ids[1], value: 2.5 }])!;
    const d = after.panels.find((x) => x.id === yoke.id)!.yoke!.depth.extra;
    expect(d.expr).toBe(yoke.yoke!.depth.extra.expr);
    expect(d.overrides).toEqual({ [ids[0]]: 2, [ids[1]]: 2.5 });
  });

  it('sets the expression when every size needs the same value', () => {
    const after = applyFix(p, f, ids.map((sizeId) => ({ sizeId, value: 1.5 })))!;
    expect(after.panels.find((x) => x.id === yoke.id)!.yoke!.depth.extra).toEqual({ expr: '1.5', overrides: {} });
  });

  it("won't touch a field it can't set", () => {
    expect(applyFix(p, { target: 'settings', key: 'strap', label: 'Strap width' }, [{ sizeId: ids[0], value: 3 }])).toBeNull();
  });

  it('says what it set, in which sizes', () => {
    expect(sizesText(p, ids.slice(0, 4))).toBe(`${p.sizes[0].name}–${p.sizes[3].name}`);
    expect(sizesText(p, [ids[0], ids[2]])).toBe(`${p.sizes[0].name}, ${p.sizes[2].name}`);
    expect(sizesText(p, ids)).toBe('all sizes');
    expect(applySummary(p, f, 'cm', [{ sizeId: ids[0], value: 5.7 }], (v) => `${v} cm`)).toBe(`Set Extra depth to 5.7 cm in ${p.sizes[0].name}`);
  });
});

// ---------- severities changed in M2 ----------

describe('severity review', () => {
  it('joined panels with different rounds below the join are an error (they cannot be joined as written)', () => {
    const p = build('seamed');
    const front = p.panels.find((x) => x.name === 'Front')!;
    const back = p.panels.find((x) => x.name === 'Back')!;
    const joined = { ...p, panels: p.panels.map((x) => (x === front || x === back ? { ...x, joinAt: x.waypoints.find((w) => w.name === 'underarm')!.id, inTheRound: false } : x)) };
    const moved = { ...joined, panels: joined.panels.map((x) => (x.name === 'Front' ? { ...x, waypoints: x.waypoints.map((w) => (w.name === 'underarm' ? { ...w, height: dim(`${w.height.expr} + 2`) } : w)) } : x)) };
    const c = projectChecks(moved).find((x) => x.issue.code === 'joins.rounds-differ');
    expect(c?.issue.severity).toBe('error');
  });

  it("a knock-on on a join takes its root's severity", () => {
    const p = withFront(build('seamed'), (f) => ({ ...f, waypoints: f.waypoints.map((w, i) => (i === 0 ? { ...w, width: dim('no_such_name') } : w)) }));
    const k = projectChecks(p).filter((c) => c.issue.code === 'knock-on.join');
    expect(k.length).toBeGreaterThan(0);
    expect(k.every((c) => c.issue.severity === 'error')).toBe(true);
  });

  it('a princess line position that falls back to the edges is a warning; an any-row rhythm note is info', () => {
    expect(ISSUE_CATALOGUE['segment.princess-expr'].severity).toBe('warning');
    expect(ISSUE_CATALOGUE['segment.any-row'].severity).toBe('info');
  });

  it('M is the base size of the fixture (examples above run in every size)', () => {
    expect(sizeId(base(), 'M')).toBeTruthy();
  });
});
