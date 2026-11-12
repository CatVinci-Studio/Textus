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
  /** The width a panel keeps (the AI's, Settings', a plugin page's;
   *  an iPad's docked AI), in interface pixels before its scale. */
  panelWidth: number;
  /** The sidebar's width as last dragged. */
  sidebarWidth: number;
  /** Whether the sidebar was left open. */
  sidebarOpen: boolean;
  /** The sidebar tab last shown: files, outline or clipboard. */
  sidebarTab: string;
  /** The sidebar's tabs as the user dragged them, by id. */
  sidebarTabOrder: string[];
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
  /** What each external agent last offered to set and its commands, for
   *  its menus before its session starts. A cache; validated on read. */
  agentOffers: unknown;
  /** The folder last opened in the sidebar, or null after Close Folder; the
   *  session's first window opens it again. */
  openFolder: string | null;
  /** The AI project folder that Open Folder set, so a later Open or Close
   *  Folder may change it but leaves one the user chose alone. */
  agentRootFromFolder: string;
  /** Where each recent document was left (its caret, the place it was
   *  read at), by path, least recent first, with the file's modified time
   *  then. */
  lastCarets: Record<
    string,
    {
      mtime: number;
      offset?: number;
      pos?: number;
      scroll?: { block: number; into: number };
    }
  >;
  /** The Files tab's filter: documents only, or every file. */
  fileSearchScope: string;
  /** The file tree's order: "name" or "modified". */
  fileTreeSort: string;
  /** "1" when the file tree shows hidden files. */
  fileTreeHidden: string;
  /** The documents left read-only (View › Read Only), by path. */
  readOnlyPaths: string[];
  /** Files Textus AI left something in, by path: revisions waiting, a file
   *  it made waiting to be kept, a file it wrote straight in. */
  aiFileMarks: Record<string, AiFileMark>;
  /** The note embeds folded, by the document they are in and what they
   *  show, oldest first. */
  foldedEmbeds: string[];
  /** The drawn blocks folded (editor/fold/block-fold.ts), by document and
   *  place, oldest first. */
  foldedBlocks: string[];
  /** The drawn blocks opened by hand, so one folded in a narrow column
   *  stays open. */
  openedBlocks: string[];
  /** With embeds shown as cards, the ones opened, the same way. */
  openedEmbeds: string[];
  /** The plugin suggestion card's answers by situation: how many times
   *  Later put it off, or "never" (plugins/store/plugin-card.ts). */
  pluginCardAnswers: Record<string, number | "never">;
  /** The plugins whose first scheduled job brought up the notice about
   *  background mode, once each. */
  pluginsToldOfSchedule: string[];
  /** Features that left the core for an official plugin, each offered to
   *  those who used it once (plugins/store/moved-offer.ts). */
  movedToPluginsOffered: string[];
  /** "plugin key" pairs whose manifest key was someone else's, told once. */
  pluginKeysTold: string[];
  /** The split the window was left in, its panes by their documents'
   *  paths (app/layout/restore.ts); null when it showed one. Read
   *  loosely: earlier versions kept a pair. */
  splitLayout: { tree: unknown } | null;
  /** Settings › Extensions: the kinds whose Available list is folded. */
  extensionsFolded: string[];
  /** The folder a document was last saved into with Save As, where the
   *  next untitled one is offered to go when no folder is open. */
  lastSaveFolder: string;
  /** Each project's tabs as it was left, by folder, the one in front last
   *  (app/start-project.ts). */
  projectTabs: Record<string, string[]>;
  /** Each folder's plugin settings, by folder: used, or left out - asked
   *  the first time one is opened with any (plugins/store/plugin-settings). */
  pluginFolders: Record<string, "use" | "skip">;
  /** The composer's Deep thinking and web search, as last left. */
  deepThinking: boolean;
  webSearch: boolean;
  /** The Agent mode last picked. */
  lastAgentMode: { mode: string } | null;
  /** Web page tabs' address bar folded away. */
  webPageBarHidden: boolean;
  /** Plugins' floating views: where each was and whether it was open. */
  floatingViews: Record<string, unknown>;
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

/** What Textus AI left in one file. */
export interface AiFileMark {
  /** Revisions waiting for the writer, there or still to place. */
  pending?: number;
  /** Made by it, waiting to be kept. */
  created?: boolean;
  /** Written straight in, its text before kept for the marks. */
  changed?: boolean;
}

type UiStateKey = keyof UiState;

/** Each field's localStorage key without Rust, and its encoding. A field
 *  without one is kept in the file only. */
const LOCAL: {
  [K in UiStateKey]?: {
    key: string;
    decode: (raw: string) => unknown;
    encode: (value: UiState[K]) => string;
  };
} = {
  projectTabs: {
    key: "textus-project-tabs",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  lastSaveFolder: {
    key: "textus-last-save-folder",
    decode: (raw) => raw,
    encode: (value) => value,
  },
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
  panelWidth: {
    key: "textus-panel-width",
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
  sidebarTabOrder: {
    key: "textus-sidebar-tab-order",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
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
  agentOffers: {
    key: "textus-agent-offers",
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
  pluginFolders: {
    key: "textus-plugin-folders",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
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
  pluginCardAnswers: {
    key: "textus-plugin-card-answers",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  aiFileMarks: {
    key: "textus-ai-file-marks",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  readOnlyPaths: {
    key: "textus-read-only-paths",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  foldedBlocks: {
    key: "textus-folded-blocks",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  openedBlocks: {
    key: "textus-opened-blocks",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  foldedEmbeds: {
    key: "textus-folded-embeds",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  openedEmbeds: {
    key: "textus-opened-embeds",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  lastCarets: {
    key: "textus-last-carets",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  deepThinking: {
    key: "textus-agent-deep-thinking",
    decode: (raw) => raw === "1",
    encode: (value) => (value ? "1" : "0"),
  },
  webSearch: {
    key: "textus-agent-web-search",
    decode: (raw) => raw === "1",
    encode: (value) => (value ? "1" : "0"),
  },
  lastAgentMode: {
    key: "textus-agent-last-mode",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
  webPageBarHidden: {
    key: "textus.webPageBarHidden",
    decode: (raw) => raw === "1",
    encode: (value) => (value ? "1" : "0"),
  },
  floatingViews: {
    key: "textus.floatingViews",
    decode: (raw) => JSON.parse(raw),
    encode: (value) => JSON.stringify(value),
  },
};

/** Fields once kept only in localStorage: carried into the file the first
 *  time it lacks them, then let go there. */
const FROM_LOCAL: UiStateKey[] = [
  "deepThinking",
  "webSearch",
  "lastAgentMode",
  "webPageBarHidden",
  "floatingViews",
];

function carryFromLocal(file: Record<string, unknown>): void {
  for (const key of FROM_LOCAL) {
    if (file[key] !== undefined) continue;
    const kept = readLocal(key);
    if (kept === undefined) continue;
    file[key] = kept;
    written.add(key);
    trackWrite(storage.uiStatePatch({ [key]: kept })).catch(() => {});
    try {
      localStorage.removeItem(LOCAL[key]!.key);
    } catch {
      // Left there: read again next time, harmlessly.
    }
  }
}

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
    carryFromLocal(cache);
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
  // After this window's last update of it: two at once read the same live
  // value and the second's patch dropped the first's change.
  const next = (updating.get(key) ?? Promise.resolve()).then(() =>
    storage.uiStateGet().then((live) => {
      const value = change(live[key]);
      // The cache may have been replaced by the refresh meanwhile.
      const cached = fileCache();
      if (cached) cached[key] = value;
      return storage.uiStatePatch({ [key]: value });
    }),
  );
  updating.set(
    key,
    next.then(
      () => undefined,
      () => undefined,
    ),
  );
  trackWrite(next).catch(() => {});
}

/** The fields that are lists of names. */
type ListKey = {
  [K in UiStateKey]: UiState[K] extends string[] ? K : never;
}[UiStateKey];

const names = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

/** A list of names kept here, its valid entries only. */
export function uiList(key: ListKey): string[] {
  return names(getUiState(key));
}

/** `item` into list `key` (`on`), at its `newest` end, or out of it; at
 *  most `max` kept, the oldest going. Built on the live list, so another
 *  window's change to it stays. */
export function keepInList(
  key: ListKey,
  item: string,
  on: boolean,
  {
    max = Infinity,
    newest = "last",
  }: { max?: number; newest?: "first" | "last" } = {},
): void {
  updateUiState(key, (live) => {
    const rest = names(live).filter((k) => k !== item);
    if (!on) return rest;
    return newest === "first"
      ? [item, ...rest].slice(0, max)
      : [...rest, item].slice(-max);
  });
}

/** Each field's updates in this window, one after another. */
const updating = new Map<string, Promise<void>>();

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
