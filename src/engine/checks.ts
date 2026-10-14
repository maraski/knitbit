// Project-wide checks: every panel in every size, collected for the check panel.

import { joinReport, sameEdge, type PanelCache } from './joins';
import { fitChecks } from './fitChecks';
import type { Id, Project } from './model';
import { computePanel, type Issue } from './panel';

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
    for (const { panel, c } of computed) {
      for (const issue of c.issues) if (!replaced.has(issue)) out.push({ panelId: panel.id, panelName: panel.name, sizeId: size.id, sizeName: size.name, issue });
    }
    // Panels joined in the round below a waypoint are knitted together there: their rounds must match.
    const joined = computed.filter(({ panel, c }) => panel.joinAt && !panel.inTheRound && c.ok && c.roundRows);
    if (joined.length >= 2) {
      const rounds = joined.map(({ c }) => c.roundRows!.to - c.roundRows!.from + 1);
      if (new Set(rounds).size > 1) {
        const text = joined.map(({ panel }, i) => `${panel.name} ${rounds[i]}`).join(', ');
        for (const { panel } of joined) {
          out.push({ panelId: panel.id, panelName: panel.name, sizeId: size.id, sizeName: size.name, issue: { severity: 'warning', message: `Panels joined in the round have different numbers of rounds below the join (${text}).`, ref: { kind: 'panel' } } });
        }
      } else {
        // Same rounds: note when side shaping falls on different rounds (fine to knit, worth seeing).
        const shapingRounds = joined.map(({ c }) => {
          const rows = new Set<number>();
          for (const seg of c.segments) for (const e of [...seg.left.events, ...seg.right.events]) if (e.row >= c.roundRows!.from && e.row <= c.roundRows!.to) rows.add(c.topDown ? e.row - c.roundRows!.from : e.row);
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
  sizes: { id: Id; name: string; message: string }[];
}

/** Group checks that point at the same place with the same kind of message, so one problem in ten sizes is one row. */
export function groupChecks(checks: Check[]): CheckGroup[] {
  const groups = new Map<string, CheckGroup>();
  for (const c of checks) {
    const pattern = c.issue.message.replace(/-?\d+(\.\d+)?/g, '#');
    const key = `${c.panelId}|${JSON.stringify(c.issue.ref)}|${c.issue.severity}|${pattern}`;
    let g = groups.get(key);
    if (!g) {
      g = { key, panelId: c.panelId, panelName: c.panelName, issue: c.issue, sizes: [] };
      groups.set(key, g);
    }
    g.sizes.push({ id: c.sizeId, name: c.sizeName, message: c.issue.message });
  }
  const rank = { error: 0, warning: 1, info: 2 };
  return [...groups.values()].sort((a, b) => rank[a.issue.severity] - rank[b.issue.severity]);
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
      if (!m.ok) out.push({ ...base, issue: { severity: 'warning', message: `${join.name}: ${m.label}: ${m.error}`, ref } });
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
