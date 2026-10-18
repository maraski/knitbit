// In-memory ProjectRemote for tests: behaves like the Firestore one (conditional saves, soft delete, server times).

import type { ProjectRemote, RemoteDoc, RemoteSummary, SaveResult } from './cloudSync';

interface Stored extends RemoteDoc {
  deleted: boolean;
  editedAt: number;
}

export class MemoryRemote implements ProjectRemote {
  readonly docs = new Map<string, Stored>();
  private clock = 0;
  /** Set to simulate network failures. */
  offline = false;
  /** Runs once before the next save is checked, e.g. to make another device save first. */
  beforeNextSave: (() => void) | null = null;

  private tick(): string {
    this.clock++;
    return `t${this.clock}`;
  }

  /** Server time of a write: one second per tick, so later saves list as newer. */
  private editedAt(): number {
    return Date.UTC(2026, 9, 18) + this.clock * 1000;
  }

  private check(): void {
    if (this.offline) throw new Error('offline');
  }

  async list(): Promise<RemoteSummary[]> {
    this.check();
    return [...this.docs.values()].filter((d) => !d.deleted).map(({ id, name, updatedAt, editedAt }) => ({ id, name, updatedAt, editedAt }));
  }

  async get(id: string): Promise<RemoteDoc | null> {
    this.check();
    const d = this.docs.get(id);
    if (!d || d.deleted) return null;
    const { deleted: _, editedAt: __, ...doc } = d;
    return doc;
  }

  async save(doc: Omit<RemoteDoc, 'updatedAt'>, ifUpdatedAt: string | null): Promise<SaveResult> {
    this.check();
    const hook = this.beforeNextSave;
    this.beforeNextSave = null;
    hook?.();
    const current = this.docs.get(doc.id)?.updatedAt ?? null;
    if (current !== ifUpdatedAt) return { ok: false, conflict: true, currentUpdatedAt: current };
    const updatedAt = this.tick();
    this.docs.set(doc.id, { ...doc, updatedAt, deleted: false, editedAt: this.editedAt() });
    return { ok: true, updatedAt };
  }

  async remove(id: string): Promise<void> {
    this.check();
    const d = this.docs.get(id);
    if (d) this.docs.set(id, { ...d, deleted: true, updatedAt: this.tick(), editedAt: this.editedAt() });
  }

  /** Writes directly, as another device or app version would, ignoring conditions. Returns the new updatedAt. */
  put(doc: Omit<RemoteDoc, 'updatedAt'>): string {
    const updatedAt = this.tick();
    this.docs.set(doc.id, { ...doc, updatedAt, deleted: false, editedAt: this.editedAt() });
    return updatedAt;
  }
}
