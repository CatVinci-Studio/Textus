import { atMedium } from "../utils/at-medium";
import { storage } from "../platform/ipc";
import { readBoot } from "./boot";
import { trackWrite } from "./pending-writes";
import type { AiFileMark, ThemeChromeCache, UiState } from "./ui-state-types";

/**
 * Small bits of UI remembered between launches: where the user left things.
 * Kept by Rust in ui-state.json, else one localStorage key each. Never pushed
 * into open windows; values come back untrusted, so callers validate.
 */
export type { AiFileMark, ThemeChromeCache, UiState };

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
  panelPx: {
    key: "textus-panel-px",
    decode: (raw) => Number(raw),
    encode: (value) => String(Math.round(value)),
  },
  sidebarPx: {
    key: "textus-sidebar-px",
    decode: (raw) => Number(raw),
    encode: (value) => String(Math.round(value)),
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

/** Widths kept before 1.4.1 in the first design's pixels, read once into
 *  Medium's until the new field is written. */
const BEFORE_MEDIUM: { [K in UiStateKey]?: UiStateKey } = {
  panelPx: "panelWidth",
  sidebarPx: "sidebarWidth",
};

export function getUiState<K extends UiStateKey>(key: K): unknown {
  const file = fileCache();
  const value = file ? file[key] : readLocal(key);
  const before = BEFORE_MEDIUM[key];
  if (value !== undefined || !before) return value;
  const old = Number(file ? file[before] : readLocal(before));
  return old > 0 ? atMedium(old) : undefined;
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
