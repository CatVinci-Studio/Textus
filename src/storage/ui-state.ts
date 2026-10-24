import { storage } from "../platform/ipc";
import { readBoot } from "./boot";
import { trackWrite } from "./pending-writes";

/**
 * Small bits of UI remembered between launches - not settings the user
 * picks, just where they left things. Kept by Rust in ui-state.json
 * (docs/dev/storage.md); without Rust (no boot snapshot) each is a
 * localStorage key of its own.
 *
 * Remembered for the next window or launch, never pushed into windows
 * already open. Values come back untrusted (a hand edit, a value this
 * version no longer uses); each caller validates its own.
 */
export interface UiState {
  /** The onboarding tour's step (onboarding/useTutorial.ts). */
  tutorialProgress: unknown;
  agentPanelOpen: boolean;
  agentPanelWidth: number;
  /** The sidebar's width as last dragged (app/sidebar-width.ts). */
  sidebarWidth: number;
  /** Whether the sidebar was left open (app/useSidePanels.ts). */
  sidebarOpen: boolean;
  /** The sidebar tab last shown: files, outline or clipboard
   *  (app/sidebar-tab.ts). */
  sidebarTab: string;
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
  /** The folder last opened in the sidebar (File > Open Folder…), or null
   *  after Close Folder - the session's first window opens it again
   *  (app/useOpenFolder.ts). */
  openFolder: string | null;
  /** The AI project folder (Settings.agentWorkspaceRoot) that Open Folder
   *  set, so a later Open or Close Folder knows it may change it - and
   *  leaves one the user chose alone (sidebar/tree-root.ts). */
  agentRootFromFolder: string;
  /** Where the caret was in each document left recently, by path, least
   *  recent first, with the file's modified time then
   *  (document/last-carets.ts). */
  lastCarets: Record<
    string,
    { mtime: number } & ({ offset: number } | { pos: number })
  >;
  /** The Files tab's filter, for the tree and its search: documents
   *  only, or every file (sidebar/FileTree.tsx). */
  fileSearchScope: string;
  /** The file tree's order: "name" or "modified" (sidebar/FileTree.tsx). */
  fileTreeSort: string;
  /** "1" when the file tree shows hidden files (#357). */
  fileTreeHidden: string;
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

/** Each field's localStorage key without Rust, and how it is encoded
 *  there. A field without one is kept in the file only (themeChrome: only
 *  Rust's boot script reads it). */
const LOCAL: {
  [K in UiStateKey]?: {
    key: string;
    decode: (raw: string) => unknown;
    encode: (value: UiState[K]) => string;
  };
} = {
  tutorialProgress: {
    key: "textus-tutorial-progress",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  agentPanelOpen: {
    key: "textus-agent-panel-open",
    decode: (raw) => raw === "1",
    encode: (value) => (value ? "1" : "0"),
  },
  agentPanelWidth: {
    key: "textus-agent-panel-width",
    decode: (raw) => Number(raw),
    encode: (value) => String(Math.round(value)),
  },
  sidebarWidth: {
    key: "textus-sidebar-width",
    decode: (raw) => Number(raw),
    encode: (value) => String(Math.round(value)),
  },
  sidebarOpen: {
    key: "textus-sidebar-open",
    decode: (raw) => raw === "1",
    encode: (value) => (value ? "1" : "0"),
  },
  sidebarTab: {
    key: "textus-sidebar-tab",
    decode: (raw) => raw,
    encode: (value) => value,
  },
  iosRecentDocuments: {
    key: "textus-ios-recent-documents",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  documentListView: {
    key: "textus.documentListView",
    decode: (raw) => raw,
    encode: (value) => value,
  },
  recentSkills: {
    key: "textus-recent-skills",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  openFolder: {
    key: "textus-open-folder",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  agentRootFromFolder: {
    key: "textus-agent-root-from-folder",
    decode: (raw) => raw,
    encode: (value) => value,
  },
  fileSearchScope: {
    key: "textus-file-search-scope",
    decode: (raw) => raw,
    encode: (value) => value,
  },
  fileTreeHidden: {
    key: "textus-file-tree-hidden",
    decode: (raw) => raw,
    encode: (value) => value,
  },
  fileTreeSort: {
    key: "textus-file-tree-sort",
    decode: (raw) => raw,
    encode: (value) => value,
  },
  lastCarets: {
    key: "textus-last-carets",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
};

function readLocal(key: UiStateKey): unknown {
  const local = LOCAL[key];
  if (!local) return undefined;
  try {
    const raw = localStorage.getItem(local.key);
    return raw === null ? undefined : local.decode(raw);
  } catch {
    return undefined;
  }
}

let cache: Record<string, unknown> | null = null;
/** Fields written in this page since it loaded: newer than any re-read. */
const written = new Set<string>();
let refreshed: Promise<void> | null = null;

function fileCache(): Record<string, unknown> | null {
  const boot = readBoot();
  if (!boot) return null;
  if (!cache) {
    cache = { ...boot.uiState };
    refreshed = storage
      .uiStateGet()
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
  return file ? file[key] : readLocal(key);
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
  const local = LOCAL[key];
  if (!local) return;
  try {
    localStorage.setItem(local.key, local.encode(value));
  } catch {
    // Storage unavailable: it just won't be remembered.
  }
}

/**
 * Changes a field from its live value, for one every window adds to (the
 * last carets): setUiState from this page's copy would drop what another
 * window wrote since this one loaded. The read and the write go out at
 * once and are tracked together, so a closing window waits for both.
 */
export function updateUiState<K extends UiStateKey>(
  key: K,
  change: (current: unknown) => UiState[K],
): void {
  const file = fileCache();
  if (!file) {
    setUiState(key, change(readLocal(key)));
    return;
  }
  written.add(key);
  trackWrite(
    storage.uiStateGet().then((live) => {
      const value = change(live[key]);
      // The cache may have been replaced by the refresh meanwhile.
      const cached = fileCache();
      if (cached) cached[key] = value;
      return storage.uiStatePatch({ [key]: value });
    }),
  ).catch(() => {});
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
