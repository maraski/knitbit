// Project-wide checks: every panel in every size, collected for the check panel.

import { joinReport, sameEdge, type PanelCache } from './joins';
import { fitChecks } from './fitChecks';
import { bandChecks } from './buttons';
import { contiguousChecks } from './contiguousChecks';
import { sleeveChecks } from './sleeveChecks';
import type { Id, Project } from './model';
import { computePanel, type Issue } from './panel';
import { issueKey, type IssueFix } from './issues';

export interface Check {
  panelId: Id;
  panelName: string;
  sizeId: Id;
  sizeName: string;
  issue: Issue;
}

export function projectChecks(project: Project): Check[] {
  const out: Check[] = [];
  for (const size of project.sizes) {
    const computed = project.panels.map((panel) => ({ panel, c: computePanel(project, panel, size.id) }));
    const cache: PanelCache = new Map(computed.map(({ panel, c }) => [`${panel.id}|${size.id}`, c]));
    out.push(...joinChecks(project, size.id, size.name, cache));
    const fit = fitChecks(project, size.id, computed, cache);
    const replaced = new Set(fit.flatMap((f) => (f.replaces ? [f.replaces] : [])));
    for (const { replaces: _, ...f } of fit) out.push({ ...f, sizeId: size.id, sizeName: size.name });
    for (const b of bandChecks(project, size.id, cache)) out.push({ ...b, sizeId: size.id, sizeName: size.name });
    for (const k of contiguousChecks(project, size.id, cache)) out.push({ ...k, sizeId: size.id, sizeName: size.name });
    for (const k of sleeveChecks(project, size.id, computed)) out.push({ ...k, sizeId: size.id, sizeName: size.name });
    for (const { panel, c } of computed) {
      for (const issue of c.issues) if (!replaced.has(issue)) out.push({ panelId: panel.id, panelName: panel.name, sizeId: size.id, sizeName: size.name, issue });
    }
    // Panels joined in the round below a waypoint are knitted together there: their rounds must match. Top-down, a
    // front neck below the join keeps the body flat until it closes, so rounds count from the last panel's first round.
    const joined = computed.filter(({ panel, c }) => panel.joinAt && !panel.inTheRound && c.ok && c.roundRows);
    if (joined.length >= 2) {
      const from = joined.every(({ c }) => c.topDown) ? Math.max(...joined.map(({ c }) => c.roundRows!.from)) : null;
      const rounds = joined.map(({ c }) => c.roundRows!.to - (from ?? c.roundRows!.from) + 1);
      if (new Set(rounds).size > 1) {
        const text = joined.map(({ panel }, i) => `${panel.name} ${rounds[i]}`).join(', ');
        for (const { panel } of joined) {
          out.push({ panelId: panel.id, panelName: panel.name, sizeId: size.id, sizeName: size.name, issue: { severity: 'warning', message: `Panels joined in the round have different numbers of rounds below the join (${text}).`, ref: { kind: 'panel' } } });
        }
      } else {
        // Same rounds: note when side shaping falls on different rounds (fine to knit, worth seeing).
        const shapingRounds = joined.map(({ c }) => {
          const rows = new Set<number>();
          for (const seg of c.segments) for (const e of [...seg.left.events, ...seg.right.events]) if (e.row >= (from ?? c.roundRows!.from) && e.row <= c.roundRows!.to) rows.add(c.topDown ? e.row - (from ?? c.roundRows!.from) : e.row);
          return [...rows].sort((a, b) => a - b).join(',');
        });
        if (new Set(shapingRounds).size > 1) {
          const { panel } = joined[0];
          out.push({ panelId: panel.id, panelName: panel.name, sizeId: size.id, sizeName: size.name, issue: { severity: 'info', message: `Joined panels shape their side seams on different rounds (${joined.map(({ panel }) => panel.name).join(', ')}).`, ref: { kind: 'panel' } } });
        }
      }
    }
  }
  return out;
}

export interface CheckGroup {
  key: string;
  panelId: Id;
  panelName: string;
  issue: Issue; // representative (first size)
  sizes: { id: Id; name: string; message: string; fix?: IssueFix }[];
  /** Problems caused by this one (in other panels and joins), grouped the same way. */
  knockOns: CheckGroup[];
}

/**
 * Group checks that point at the same place with the same kind of message, so one problem in ten sizes is one row.
 * A knock-on (`causedBy`) is nested under its root's group when the root is in the list.
 */
export function groupChecks(checks: Check[]): CheckGroup[] {
  const groups = new Map<string, CheckGroup>();
  for (const c of checks) {
    const key = issueKey(c.panelId, c.issue) + (c.issue.causedBy ? `<${c.issue.causedBy}` : '');
    let g = groups.get(key);
    if (!g) {
      g = { key, panelId: c.panelId, panelName: c.panelName, issue: c.issue, sizes: [], knockOns: [] };
      groups.set(key, g);
    }
    g.sizes.push({ id: c.sizeId, name: c.sizeName, message: c.issue.message, ...(c.issue.fix && { fix: c.issue.fix }) });
  }
  const top: CheckGroup[] = [];
  for (const g of groups.values()) {
    const root = g.issue.causedBy ? groups.get(g.issue.causedBy) : undefined;
    if (root) root.knockOns.push(g);
    else top.push(g);
  }
  const rank = { error: 0, warning: 1, info: 2 };
  const bySeverity = (a: CheckGroup, b: CheckGroup) => rank[a.issue.severity] - rank[b.issue.severity];
  for (const g of top) g.knockOns.sort(bySeverity);
  return top.sort(bySeverity);
}

/** The checks that are root causes: knock-ons whose root is in the same size's checks are left out (for counting). */
export function rootChecks(checks: Check[]): Check[] {
  const keys = new Set(checks.map((c) => `${c.sizeId}|${issueKey(c.panelId, c.issue)}`));
  return checks.filter((c) => !c.issue.causedBy || !keys.has(`${c.sizeId}|${c.issue.causedBy}`));
}

function joinChecks(project: Project, sizeId: Id, sizeName: string, cache: PanelCache): Check[] {
  const out: Check[] = [];
  const panelName = (id: Id) => project.panels.find((p) => p.id === id)?.name ?? '?';
  for (const join of project.joins ?? []) {
    const first = join.edges[0] ?? join.partner[0];
    if (!first) continue;
    const base = { panelId: first.panelId, panelName: panelName(first.panelId), sizeId, sizeName };
    const ref = { kind: 'join' as const, id: join.id };
    const r = joinReport(project, join, sizeId, cache);
    for (const m of [...r.a.measures, ...(r.b?.measures ?? [])]) {
      if (!m.ok) {
        // A panel that can't be computed: a knock-on of its root cause.
        out.push({ ...base, issue: m.cause ? { severity: 'warning', code: 'knock-on.join', message: `${join.name}: ${m.label} can't be measured until that panel can be computed.`, ref, causedBy: m.cause.key } : { severity: 'warning', message: `${join.name}: ${m.label}: ${m.error}`, ref } });
      }
    }
    if (join.tag === 'seam') {
      if (!join.partner.length || !join.edges.length) {
        out.push({ ...base, issue: { severity: 'info', message: `${join.name}: seam has only one side; add the edge it is sewn to.`, ref } });
      } else if (r.a.ok && r.b?.ok && !r.withinTolerance) {
        out.push({
          ...base,
          issue: {
            severity: 'warning',
            message: `${join.name}: the sides differ by ${Math.abs(r.diffCm).toFixed(1)} cm (${Math.abs(r.diffRows)} rows), more than the ${project.settings.seamToleranceCm} cm tolerance.`,
            ref,
          },
        });
      }
    }
  }
  // The same edge tagged in two different ways.
  const all = (project.joins ?? []).flatMap((j) => [...j.edges, ...j.partner].map((e) => ({ j, e })));
  for (let i = 0; i < all.length; i++) {
    for (let k = i + 1; k < all.length; k++) {
      if (all[i].j.id !== all[k].j.id && all[i].j.tag !== all[k].j.tag && sameEdge(all[i].e, all[k].e)) {
        out.push({
          panelId: all[i].e.panelId,
          panelName: panelName(all[i].e.panelId),
          sizeId,
          sizeName,
          issue: { severity: 'info', message: `The same edge is in "${all[i].j.name}" (${all[i].j.tag}) and "${all[k].j.name}" (${all[k].j.tag}).`, ref: { kind: 'join', id: all[i].j.id } },
        });
      }
    }
  }
  return out;
}
