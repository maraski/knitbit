// React state for the project: undo history over snapshots, plus debounced auto-save.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readAutosave, writeAutosave } from '../engine/autosave';
import { parseCsv } from '../engine/csv';
import { canRedo, canUndo, commit, createHistory, redo, undo, type History } from '../engine/history';
import type { Project } from '../engine/model';
import { projectFromTable } from '../engine/seed';
import { bodice, sleeve } from '../engine/templates';
import sampleCsv from '../../samples/sizing_table_cm.csv?raw';

export function sampleProject(): Project {
  const p = projectFromTable(parseCsv(sampleCsv), 'My top').project;
  p.panels = [bodice('back'), bodice('front'), sleeve('set-in')];
  return p;
}

export interface Notice {
  kind: 'error' | 'warning' | 'info';
  title: string;
  lines: string[];
}

function initial(): { project: Project; notice: Notice | null } {
  const saved = readAutosave(window.localStorage);
  if (!saved.found) return { project: sampleProject(), notice: null };
  if (saved.ok) {
    const lines = [...saved.warnings];
    return {
      project: saved.project,
      notice: lines.length ? { kind: 'warning', title: 'Restored auto-save with warnings', lines } : null,
    };
  }
  return {
    project: sampleProject(),
    notice: { kind: 'error', title: 'The auto-saved project could not be restored; started from the sample table', lines: saved.errors },
  };
}

export function useProjectStore() {
  const [init] = useState(initial);
  const [history, setHistory] = useState<History<Project>>(() => createHistory(init.project));
  const [notice, setNotice] = useState<Notice | null>(init.notice);
  const project = history.present;

  /** Apply an edit. `key` merges rapid edits of the same field into one undo step. */
  const update = useCallback((fn: (p: Project) => Project, key: string | null = null) => {
    setHistory((h) => commit(h, { ...fn(h.present), updatedAt: new Date().toISOString() }, key));
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
