/**
 * The snapshot Rust hands every app webview before the page loads
 * (src-tauri/src/settings.rs's boot_script, which also applies the theme to
 * the first frame). Settings, UI state and the histories live in JSON files
 * Rust owns (docs/dev/storage.md); this is how the frontend gets the first two
 * synchronously, where it used to read localStorage.
 *
 * The snapshot is taken when the window is BUILT, so a page reload replays
 * an old one: the stores treat it as a first-paint hint and re-read the
 * live values once running.
 *
 * No snapshot - the browser dev shim, vitest, a webview Rust didn't build -
 * means no backend to talk to, and every store falls back to localStorage,
 * exactly as before the move.
 */
export interface Boot {
  settings: Record<string, unknown>;
  rev: number;
  uiState: Record<string, unknown>;
  /** settings.json didn't exist at launch: this is the first launch since
   *  the move, and localStorage still holds the user's data - the first
   *  window to load hands it to Rust (SettingsContext's legacy import). */
  legacyImport: boolean;
  /** This window's label, to recognise the events its own changes cause. */
  label: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let cached: Boot | null | undefined;

export function readBoot(): Boot | null {
  if (cached !== undefined) return cached;
  const raw =
    typeof window === "undefined"
      ? undefined
      : (window as unknown as { __BOOT__?: unknown }).__BOOT__;
  cached =
    isRecord(raw) && isRecord(raw.settings)
      ? {
          settings: raw.settings,
          rev: typeof raw.rev === "number" ? raw.rev : 0,
          uiState: isRecord(raw.uiState) ? raw.uiState : {},
          legacyImport: raw.legacyImport === true,
          label: typeof raw.label === "string" ? raw.label : "",
        }
      : null;
  return cached;
}

/** Forgets the parsed snapshot, for tests that install a different one. */
export function resetBootForTests(): void {
  cached = undefined;
  settled = null;
}

let settled: { promise: Promise<void>; resolve: () => void } | null = null;

function settledHandle() {
  if (!settled) {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    settled = { promise, resolve };
    // Nothing to wait for without an import pending. With one, a bound on
    // the wait all the same: the import starts from the settings store, and
    // a window that somehow never read settings must not keep its histories
    // empty forever.
    if (!readBoot()?.legacyImport) resolve();
    else setTimeout(resolve, 5000);
  }
  return settled;
}

/** Resolves once this window's legacy import (if it booted with one) has
 *  been answered, so the histories and UI state aren't read from Rust before
 *  what localStorage held has reached it. */
export function legacyImportSettled(): Promise<void> {
  return settledHandle().promise;
}

export function markLegacyImportSettled(): void {
  settledHandle().resolve();
}
