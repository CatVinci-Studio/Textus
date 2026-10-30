import { storage } from "../platform/ipc";
import { readBoot } from "./boot";
import { trackWrite } from "./pending-writes";

/**
 * Small bits of UI remembered between launches: where the user left things.
 * Kept by Rust in ui-state.json, else one localStorage key each. Never pushed
 * into open windows; values come back untrusted, so callers validate.
 */
export interface UiState {
  /** The onboarding tour's step. */
  tutorialProgress: unknown;
  agentPanelOpen: boolean;
  agentPanelWidth: number;
  /** The sidebar's width as last dragged. */
  sidebarWidth: number;
  /** Whether the sidebar was left open. */
  sidebarOpen: boolean;
  /** The sidebar tab last shown: files, outline or clipboard. */
  sidebarTab: string;
  /** iOS: recently opened documents, newest first. */
  iosRecentDocuments: unknown;
  /** iOS: the document list's layout. */
  documentListView: string;
  /** The chrome colours last derived from the selected imported theme, so the
   *  boot script can paint the next window's first frame: deriving them takes a
   *  CSS engine, which Rust lacks. A cache, refreshed on every load. */
  themeChrome: ThemeChromeCache;
  /** The skills last run from the composer, newest first. */
  recentSkills: string[];
  /** The folder last opened in the sidebar, or null after Close Folder; the
   *  session's first window opens it again. */
  openFolder: string | null;
  /** The AI project folder that Open Folder set, so a later Open or Close
   *  Folder may change it but leaves one the user chose alone. */
  agentRootFromFolder: string;
  /** Where the caret was in each recent document, by path, least recent
   *  first, with the file's modified time then. */
  lastCarets: Record<
    string,
    { mtime: number } & ({ offset: number } | { pos: number })
  >;
  /** The Files tab's filter: documents only, or every file. */
  fileSearchScope: string;
  /** The file tree's order: "name" or "modified". */
  fileTreeSort: string;
  /** "1" when the file tree shows hidden files. */
  fileTreeHidden: string;
  /** The documents left read-only (View › Read Only), by path. */
  readOnlyPaths: string[];
  /** The kinds (contributes.suggestFor) a plugin was offered for, once each. */
  pluginsOfferedFor: string[];
  /** The split the window was left in, its panes by their documents'
   *  paths (app/split/split-restore.ts); null when it showed one. Read
   *  loosely: earlier versions kept a pair. */
  splitLayout: { tree: unknown } | null;
  /** Settings › Extensions: the kinds whose Available list is folded. */
  extensionsFolded: string[];
}

export interface ThemeChromeCache {
  /** The imported theme (`Settings.themeId`) they were derived from. */
  id: string;
  /** For its dark appearance, or its light one. */
  dark: boolean;
  /** The length of the theme stylesheet they were derived from, so a
   *  hand-edited file doesn't get the old colours on its first frame. */
  sourceLength: number;
  /** The stylesheet applyThemeChrome applied. */
  css: string;
}

export type UiStateKey = keyof UiState;

/** Each field's localStorage key without Rust, and its encoding. A field
 *  without one is kept in the file only. */
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
  splitLayout: {
    key: "textus-split-layout",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  fileTreeSort: {
    key: "textus-file-tree-sort",
    decode: (raw) => raw,
    encode: (value) => value,
  },
  pluginsOfferedFor: {
    key: "textus-plugins-offered-for",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  readOnlyPaths: {
    key: "textus-read-only-paths",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
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

/** Changes a field from its live value, for one every window adds to: this
 *  page's copy may miss another window's writes. The read and write are
 *  tracked together, so a closing window waits for both. */
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

/** Resolves once the live values have replaced the boot snapshot, for a
 *  read-modify-write that must not build on a stale one. */
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
