import { storage } from "../platform/ipc";
import { legacyImportSettled, readBoot } from "./boot";
import { trackWrite } from "./pending-writes";

/**
 * Small bits of UI remembered between launches - not settings the user
 * picks, just where they left things. Kept by Rust in ui-state.json
 * (docs/STORAGE.md); before the move each was its own localStorage key,
 * which is still what the fallback (no Rust boot snapshot) reads and writes.
 *
 * Remembered for the next window or launch, never pushed into windows
 * already open - same as when they were localStorage keys read at mount.
 * Values come back untrusted (an older build, a hand edit); each caller
 * validates its own.
 */
export interface UiState {
  /** The onboarding tour's step (onboarding/useTutorial.ts). */
  tutorialProgress: unknown;
  agentPanelOpen: boolean;
  agentPanelWidth: number;
  /** The sidebar's width as last dragged (app/sidebar-width.ts). */
  sidebarWidth: number;
  /** iOS: recently opened documents, newest first (platform/ios-files.ts). */
  iosRecentDocuments: unknown;
  /** iOS: the document list's layout (mobile/DocumentList.tsx). */
  documentListView: string;
  /** The chrome colours last derived from the selected imported theme
   *  (theme/theme-chrome.ts), so the boot script (src-tauri/src/boot.js)
   *  can paint the next window's first frame with them - deriving them
   *  takes a CSS engine, which Rust doesn't have. A cache: the frontend
   *  derives them again on every load and replaces both copies. */
  themeChrome: ThemeChromeCache;
  /** The skills last run from the composer, newest first - the `/` menu
   *  lists them first (ai/chat/skill-picker.ts). */
  recentSkills: string[];
}

export interface ThemeChromeCache {
  /** The imported theme (`Settings.themeId`) they were derived from. */
  id: string;
  /** For its dark appearance, or its light one. */
  dark: boolean;
  /** The length of the theme stylesheet they were derived from: the UI
   *  never rewrites an imported theme, but a hand-edited file shouldn't
   *  get the old colours painted over its first frame either. */
  sourceLength: number;
  /** The stylesheet applyThemeChrome applied. */
  css: string;
}

export type UiStateKey = keyof UiState;

/** Each field's localStorage key before the move, and how it was encoded
 *  there - for the fallback and for the one-time import. A field without
 *  one is kept in the file only (themeChrome: only Rust's boot script reads
 *  it). */
const LEGACY: {
  [K in UiStateKey]?: {
    key: string;
    decode: (raw: string) => unknown;
    encode: (value: UiState[K]) => string;
  };
} = {
  tutorialProgress: {
    key: "levis-tutorial-progress",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  agentPanelOpen: {
    key: "levis-agent-panel-open",
    decode: (raw) => raw === "1",
    encode: (value) => (value ? "1" : "0"),
  },
  agentPanelWidth: {
    key: "levis-agent-panel-width",
    decode: (raw) => Number(raw),
    encode: (value) => String(Math.round(value)),
  },
  // Newer than the move: no build ever wrote this key, it is only where
  // the fallback keeps the width.
  sidebarWidth: {
    key: "textus-sidebar-width",
    decode: (raw) => Number(raw),
    encode: (value) => String(Math.round(value)),
  },
  iosRecentDocuments: {
    key: "levis-ios-recent-documents",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  documentListView: {
    key: "levis.documentListView",
    decode: (raw) => raw,
    encode: (value) => value,
  },
  recentSkills: {
    key: "levis-recent-skills",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
};

function readLegacy(key: UiStateKey): unknown {
  const legacy = LEGACY[key];
  if (!legacy) return undefined;
  try {
    const raw = localStorage.getItem(legacy.key);
    return raw === null ? undefined : legacy.decode(raw);
  } catch {
    return undefined;
  }
}

/** Every field localStorage holds, for the one-time import. */
export function readLegacyUiState(): Record<string, unknown> {
  const state: Record<string, unknown> = {};
  for (const key of Object.keys(LEGACY) as UiStateKey[]) {
    const value = readLegacy(key);
    if (value !== undefined) state[key] = value;
  }
  return state;
}

let cache: Record<string, unknown> | null = null;
/** Fields written in this page since it loaded: newer than any re-read. */
const written = new Set<string>();
let refreshed: Promise<void> | null = null;

function fileCache(): Record<string, unknown> | null {
  const boot = readBoot();
  if (!boot) return null;
  if (!cache) {
    // Before the import has reached Rust, the snapshot is empty and
    // localStorage is still where the values are.
    cache = boot.legacyImport ? readLegacyUiState() : { ...boot.uiState };
    refreshed = legacyImportSettled()
      .then(() => storage.uiStateGet())
      .then((live) => {
        const local = cache ?? {};
        cache = { ...live };
        for (const key of written) cache[key] = local[key];
      })
      .catch(() => {});
  }
  return cache;
}

export function getUiState<K extends UiStateKey>(key: K): unknown {
  const file = fileCache();
  return file ? file[key] : readLegacy(key);
}

export function setUiState<K extends UiStateKey>(
  key: K,
  value: UiState[K],
): void {
  const file = fileCache();
  if (file) {
    file[key] = value;
    written.add(key);
    trackWrite(storage.uiStatePatch({ [key]: value })).catch(() => {});
    return;
  }
  const legacy = LEGACY[key];
  if (!legacy) return;
  try {
    localStorage.setItem(legacy.key, legacy.encode(value));
  } catch {
    // Storage unavailable: it just won't be remembered.
  }
}

/** Resolves once the live values have replaced the boot snapshot - for a
 *  read-modify-write (the iOS recents list) that must not build on a
 *  snapshot a page reload left stale. */
export function uiStateReady(): Promise<void> {
  fileCache();
  return refreshed ?? Promise.resolve();
}

/** Drops the cache, for tests that install a different boot snapshot. */
export function resetUiStateForTests(): void {
  cache = null;
  refreshed = null;
  written.clear();
}
