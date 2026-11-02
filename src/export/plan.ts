// What goes in the PDF, in what order: the header, notes and size tables once, then a block per ticked size
// (schematics, yoke top view, layout, joins, then charts). Pure. A new kind of page is a new section here plus its renderer in pdf.ts (`RENDERERS`).

import type { Id, Project } from '../engine/model';

export type SectionId = 'notes' | 'body' | 'finished' | 'pieces' | 'schematics' | 'yoke' | 'layout' | 'joins' | 'charts';

export interface SectionDef {
  id: SectionId;
  label: string;
  /** 'once': in the front matter after the header; 'perSize': repeated for each ticked size. */
  scope: 'once' | 'perSize';
  /** Built yet: only these are offered in the dialog and planned. */
  ready: boolean;
  /** Its renderer starts its own pages (and picks their orientation), so the plan doesn't start one. */
  ownPages?: boolean;
  /** Flows on after this section (same size) when it's planned, instead of starting a page. */
  follows?: SectionId;
  /** Only for projects that have something to print here (absent = every project). */
  applies?: (project: Project) => boolean;
}

const hasNotes = (p: Project) => !!p.notes?.trim();
const hasYoke = (p: Project) => p.panels.some((x) => x.yoke);
const hasJoins = (p: Project) => (p.joins ?? []).length > 0;

export const SECTIONS: SectionDef[] = [
  { id: 'notes', label: 'Notes', scope: 'once', ready: true, applies: hasNotes },
  { id: 'body', label: 'Body measurements', scope: 'once', ready: true },
  { id: 'finished', label: 'Finished measurements', scope: 'once', ready: true },
  { id: 'pieces', label: 'Key numbers per piece', scope: 'once', ready: true },
  { id: 'schematics', label: 'Schematics', scope: 'perSize', ready: true },
  { id: 'yoke', label: 'Yoke top view', scope: 'perSize', ready: false, ownPages: true, applies: hasYoke },
  { id: 'layout', label: 'Layout', scope: 'perSize', ready: false, ownPages: true },
  { id: 'joins', label: 'Joins', scope: 'perSize', ready: true, follows: 'layout', applies: hasJoins },
  { id: 'charts', label: 'Stitch charts', scope: 'perSize', ready: true, ownPages: true },
];

/** The sections built so far that have something to print for `project` (all built ones without a project). */
export const availableSections = (project?: Project): SectionDef[] => SECTIONS.filter((s) => s.ready && (!project || !s.applies || s.applies(project)));
export const readySections = (project?: Project): SectionId[] => availableSections(project).map((s) => s.id);

export type Paper = 'a4' | 'letter';

export interface ExportOptions {
  sizeIds: Id[];
  paper: Paper;
  sections: SectionId[];
  /** Charts: fold long runs of plain columns, as the Chart tab's "Collapse plain middle". */
  collapse?: boolean;
}

/**
 * One block of the document. `newPage`: starts on a fresh page (otherwise it flows on after the previous block).
 * `sizeId` is set for per-size blocks.
 */
export interface Part {
  section: SectionId | 'header';
  sizeId?: Id;
  newPage: boolean;
}

/** The ticked sizes in the project's order (unknown ids dropped). */
export function orderedSizes(project: Project, sizeIds: Id[]): Id[] {
  return project.sizes.map((s) => s.id).filter((id) => sizeIds.includes(id));
}

export function planExport(project: Project, opts: ExportOptions): Part[] {
  const want = availableSections(project).filter((s) => opts.sections.includes(s.id));
  const parts: Part[] = [{ section: 'header', newPage: true }];
  for (const s of want.filter((s) => s.scope === 'once')) parts.push({ section: s.id, newPage: false });
  const flowsOn = (s: SectionDef) => !!s.follows && want.some((x) => x.id === s.follows);
  for (const sizeId of orderedSizes(project, opts.sizeIds)) {
    for (const s of want.filter((s) => s.scope === 'perSize')) parts.push({ section: s.id, sizeId, newPage: !s.ownPages && !flowsOn(s) });
  }
  return parts;
}
