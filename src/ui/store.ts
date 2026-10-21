// React state for the project: undo history over snapshots, plus debounced auto-save.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readAutosave, writeAutosave } from '../engine/autosave';
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from '../engine/history';
import type { Project } from '../engine/model';
import { syncFrontPairs } from '../engine/cardigan';

export interface Notice {
  kind: 'error' | 'warning' | 'info';
  title: string;
  lines: string[];
  /** An optional follow-up offered with the notice (handled by the app). */
  action?: { id: 'merge-sample'; label: string };
}

/** What the knitter is told after an old project was upgraded: every change, plus the offer to merge the new table. */
export function migrationNotice(title: string, from: number, notes: string[], warnings: string[]): Notice {
  return {
    kind: 'warning',
    title: `${title}: upgraded from schema ${from}. The changes:`,
    lines: [
      ...notes,
      ...warnings,
      'Values are unchanged. To use the new sizing table, merge it by size name: matching measurements take its values and its other columns are added (one undoable step).',
    ],
    action: { id: 'merge-sample', label: 'Merge the Ysolda sizing table by size name' },
  };
}

/** The sample project's code (see sample.ts), loaded on first use. */
export const loadSample = () => import('./sample');

export interface StartState {
  project: Project;
  notice: Notice | null;
  /** Nothing saved yet: the New garment dialog opens over an empty project on the sample sizing table. */
  firstRun?: boolean;
}

/**
 * The project to start with: the auto-save; on first run an empty project on the sample sizing table (with the New
 * garment dialog); the sample project when the auto-save can't be restored. Resolved before the first render, so
 * those only wait for the sample's code.
 */
export function startState(): StartState | Promise<StartState> {
  const saved = readAutosave(window.localStorage);
  if (!saved.found) return loadSample().then((m) => ({ project: m.sampleTable(), notice: null, firstRun: true }));
  if (saved.ok) {
    if (saved.migratedFrom !== null) return { project: saved.project, notice: migrationNotice('Restored auto-save', saved.migratedFrom, saved.migrationNotes, saved.warnings) };
    const lines = [...saved.warnings];
    return {
      project: saved.project,
      notice: lines.length ? { kind: 'warning', title: 'Restored auto-save with warnings', lines } : null,
    };
  }
  return loadSample().then((m) => ({
    project: m.sampleProject(),
    notice: { kind: 'error', title: 'The auto-saved project could not be restored; started from the sample table', lines: saved.errors },
  }));
}

export function useProjectStore(init: StartState) {
  const [history, setHistory] = useState<History<Project>>(() => createHistory(init.project));
  const [notice, setNotice] = useState<Notice | null>(init.notice);
  const project = history.present;

  /** Apply an edit. `key` merges rapid edits of the same field into one undo step. */
  const update = useCallback((fn: (p: Project) => Project, key: string | null = null) => {
    // Linked cardigan fronts follow each other: whichever was edited is copied to the other.
    setHistory((h) => commit(h, { ...syncFrontPairs(h.present, fn(h.present)), updatedAt: new Date().toISOString() }, key));
  }, []);

  /** Replace the whole project (open / new); undoable. */
  const replace = useCallback((p: Project) => setHistory((h) => commit(h, p)), []);

  const actions = useMemo(
    () => ({
      undo: () => setHistory(undo),
      redo: () => setHistory(redo),
    }),
    [],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      const err = writeAutosave(window.localStorage, project);
      if (err) setNotice({ kind: 'warning', title: err, lines: [] });
    }, 400);
    return () => window.clearTimeout(t);
  }, [project]);

  return { project, update, replace, ...actions, canUndo: canUndo(history), canRedo: canRedo(history), notice, setNotice };
}
