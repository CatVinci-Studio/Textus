/**
 * The snapshot Rust hands every app webview before the page loads
 * (src-tauri/src/settings.rs's boot_script, which also applies the theme to
 * the first frame). Settings, UI state and the histories live in JSON files
 * Rust owns (docs/dev/storage.md); this is how the frontend gets the first two
 * synchronously.
 *
 * The snapshot is taken when the window is BUILT, so a page reload replays
 * an old one: the stores treat it as a first-paint hint and re-read the
 * live values once running.
 *
 * No snapshot - the browser dev shim, vitest, a webview Rust didn't build -
 * means no backend to talk to, and every store falls back to localStorage.
 */
export interface Boot {
  settings: Record<string, unknown>;
  rev: number;
  uiState: Record<string, unknown>;
  /** settings.json didn't exist at launch: the settings hold only what Rust
   *  seeds a new profile with (settings/stores.rs), not a user's choices. */
  newProfile: boolean;
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
      : (window as Window & { __BOOT__?: unknown }).__BOOT__;
  cached =
    isRecord(raw) && isRecord(raw.settings)
      ? {
          settings: raw.settings,
          rev: typeof raw.rev === "number" ? raw.rev : 0,
          uiState: isRecord(raw.uiState) ? raw.uiState : {},
          newProfile: raw.newProfile === true,
          label: typeof raw.label === "string" ? raw.label : "",
        }
      : null;
  return cached;
}

/** Forgets the parsed snapshot, for tests that install a different one. */
export function resetBootForTests(): void {
  cached = undefined;
}
