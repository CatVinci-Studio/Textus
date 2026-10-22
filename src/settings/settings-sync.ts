/**
 * This window's copy of the settings Rust holds (src-tauri/src/settings.rs),
 * and the bookkeeping that decides, field by field, which value wins when
 * this window's own changes, other windows' changes and full re-reads
 * arrive in whatever order IPC delivers them.
 *
 * Every change in Rust bumps one revision counter, so each field's value
 * here is tagged with the revision it was current at:
 *
 *  - a local change wins until Rust has confirmed it (it's newer than
 *    anything Rust can have sent), then carries the revision Rust gave it;
 *  - another window's change applies to a field only if its revision is
 *    newer than that field's;
 *  - a full snapshot (settings_get, the legacy import) covers every field
 *    up to its revision, so it replaces only fields not changed since.
 *
 * Plain data, no IPC or React - SettingsContext.tsx wires it up.
 */
export type Raw = Record<string, unknown>;

export function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class SettingsSync {
  raw: Raw;
  /** Revision of the last full snapshot adopted. */
  private baseRev: number;
  /** Per field: the revision its value is from, when newer than baseRev. */
  private fieldRev = new Map<string, number>();
  /** Per field: the latest local change not yet confirmed by Rust. */
  private pending = new Map<string, number>();
  private nextSeq = 1;

  constructor(raw: Raw, rev: number) {
    this.raw = { ...raw };
    this.baseRev = rev;
  }

  private revOf(key: string): number {
    if (this.pending.has(key)) return Infinity;
    return Math.max(this.baseRev, this.fieldRev.get(key) ?? 0);
  }

  /** Records a change made in this window. Returns a ticket to pass to
   *  `confirm` once Rust has acknowledged sending these fields. */
  local(patch: Raw): Map<string, number> {
    this.raw = { ...this.raw, ...patch };
    const ticket = new Map<string, number>();
    for (const key of Object.keys(patch)) {
      const seq = this.nextSeq++;
      this.pending.set(key, seq);
      ticket.set(key, seq);
    }
    return ticket;
  }

  /** Rust stored the fields in `ticket` at revision `rev`. A field changed
   *  again since stays pending - that newer change is still on its way. A
   *  failed send passes no revision: the field just stops being pending. */
  confirm(ticket: Map<string, number>, rev?: number): void {
    for (const [key, seq] of ticket) {
      if (this.pending.get(key) !== seq) continue;
      this.pending.delete(key);
      if (rev !== undefined)
        this.fieldRev.set(key, Math.max(rev, this.fieldRev.get(key) ?? 0));
    }
  }

  /** Another window's change. Returns the fields that took effect, or null
   *  when none did. */
  remote(patch: Raw, rev: number): Raw | null {
    const applied: Raw = {};
    let any = false;
    for (const [key, value] of Object.entries(patch)) {
      if (rev <= this.revOf(key)) continue;
      this.fieldRev.set(key, rev);
      applied[key] = value;
      any = true;
    }
    if (!any) return null;
    this.raw = { ...this.raw, ...applied };
    return applied;
  }

  /** A full re-read. Returns whether anything here changed. */
  snapshot(value: Raw, rev: number): boolean {
    if (rev <= this.baseRev) return false;
    const next: Raw = {};
    // Fields changed here or by a newer event keep their value; everything
    // else comes from the snapshot, including fields it no longer has.
    for (const key of new Set([
      ...Object.keys(this.raw),
      ...Object.keys(value),
    ])) {
      const keep = this.revOf(key) > rev;
      const source = keep ? this.raw : value;
      if (key in source) next[key] = source[key];
    }
    this.baseRev = rev;
    for (const [key, fieldRev] of this.fieldRev)
      if (fieldRev <= rev) this.fieldRev.delete(key);
    const changed = JSON.stringify(next) !== JSON.stringify(this.raw);
    this.raw = next;
    return changed;
  }
}
