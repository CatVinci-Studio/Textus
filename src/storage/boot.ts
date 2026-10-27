/** The snapshot Rust hands every webview before the page loads, so settings
 *  and UI state are there synchronously. A reload replays an old one, so stores
 *  re-read live values; with no snapshot they fall back to localStorage. */
export interface Boot {
  settings: Record<string, unknown>;
  rev: number;
  uiState: Record<string, unknown>;
  /** settings.json didn't exist at launch: the settings hold only what Rust
   *  seeds a new profile with, not a user's choices. */
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
