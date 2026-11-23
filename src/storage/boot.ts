import { isRecord } from "../utils/is-record";
import type { DetachedTabDoc } from "../document/doc-tabs";

/** The snapshot Rust hands every webview before the page loads (boot_script
 *  in src-tauri/src/settings/app.rs), so settings and UI state are there
 *  synchronously. A reload replays an old one, so stores
 *  re-read live values; with no snapshot they fall back to localStorage. */
interface Boot {
  settings: Record<string, unknown>;
  rev: number;
  uiState: Record<string, unknown>;
  /** settings.json didn't exist at launch: the settings hold only what Rust
   *  seeds a new profile with, not a user's choices. */
  newProfile: boolean;
  /** This window's label, to recognise the events its own changes cause. */
  label: string;
  /** Windows 10, whose window the page draws the edge of. */
  windows10: boolean;
  /** Something may open in this window as it starts (window_restores). */
  restoring: boolean;
  /** The tab dragged out into this window, unless too large to copy here;
   *  as take_detached_tab gives it (its help guide a HelpDoc id). */
  detachedTab: DetachedTabDoc | null;
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
          windows10: raw.windows10 === true,
          restoring: raw.restoring !== false,
          detachedTab:
            isRecord(raw.detachedTab) &&
            typeof raw.detachedTab.content === "string"
              ? (raw.detachedTab as unknown as DetachedTabDoc)
              : null,
        }
      : null;
  return cached;
}

/** Forgets the parsed snapshot, for tests that install a different one. */
export function resetBootForTests(): void {
  cached = undefined;
}
