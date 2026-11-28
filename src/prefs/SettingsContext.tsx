import { localeOf } from "../i18n/strings";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  loadLocale,
  localeLoaded,
  resolveStrings,
  type Strings,
} from "../i18n/strings";
import { readBoot } from "../storage/boot";
import type { Settings } from "./settings-types";
import { setCurrentLanguage } from "../i18n/current";
import {
  loadSettings,
  persist,
  readLocalSettings,
  remoteVersion,
  subscribeRemote,
  WINDOW_OWN,
  writeLocalSettings,
} from "./settings-store";
export {
  type ShortcutAction,
  type HeadingAction,
  type Shortcuts,
  defaultShortcuts,
} from "./shortcut-defaults";
export { type Settings } from "./settings-types";
export {
  type ThemeMode,
  type AiProvider,
  type ContentWidth,
  type ImageAlign,
  type EmbedDisplay,
  type ProxyType,
  THEME_MODES,
  UI_TEXT_SCALES,
  DOC_TEXT_SIZES,
  DOC_LINE_SPACINGS,
  DOC_LINE_HEIGHTS,
  DOC_LETTER_SPACINGS,
  LETTER_SPACING_BY,
  type DocLetterSpacing,
  type DocTextSize,
  type DocLineSpacing,
  type DiagramEngine,
  type ColorSwatchMode,
  REVISION_DISPLAYS,
  type RevisionDisplay,
  type AiChangeMode,
  type CompletionTone,
  COMPLETION_TONES,
  type SearchService,
  SEARCH_SERVICES,
  type GrammarStrictness,
  type UserThemeMeta,
  type ImageStorageMode,
  type ImageHost,
  type ImageNamingMode,
  type AgentMode,
  type PanelMode,
  storedAgentMode,
} from "./settings-values";
export { normaliseSettings } from "./settings-normalise";
export { loadSettings, resetSettingsStoreForTests } from "./settings-store";

interface SettingsContextValue {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  t: Strings;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/** What changes the whole window's look. */
const LOOK: (keyof Settings)[] = ["theme", "themeId"];

type CommitLook = (change: () => void) => void;
const atOnce: CommitLook = (change) => change();
let commitLook = atOnce;

/** How a change of the whole window's look is committed: at once, unless
 *  the layer that draws the look (theme/apply-appearance.ts) hands its
 *  cross-fade here. Returns the function that takes it back. */
export function commitLookChangesWith(run: CommitLook): () => void {
  commitLook = run;
  return () => {
    if (commitLook === run) commitLook = atOnce;
  };
}

/** The changes made so far, for each to land after the ones before it. */
interface Order {
  /** What the window ends on once every change made so far has landed. A
   *  change is judged against this, not against what is drawn: a fade
   *  draws a pick a frame or more after it is made, and a pick back to the
   *  drawn look meanwhile is still a change, after the one waiting. */
  wanted: Settings;
  /** Changes handed to commitLook that have not landed yet. While one
   *  waits, every later change waits behind it, so they land in the order
   *  made and a fade's late change never overwrites a later one. */
  queued: number;
}

/** Commits `change`, which brings the window to `next`: through commitLook
 *  when it changes the look, or when one before it still waits there. */
function commit(order: Order, change: () => void, next: Settings) {
  const now = order.wanted;
  order.wanted = next;
  if (!order.queued && LOOK.every((key) => next[key] === now[key]))
    return change();
  order.queued++;
  commitLook(() => {
    order.queued--;
    change();
  });
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  // Read in the same render as the state above.
  const renderedVersion = useRef(remoteVersion);
  const wantedLanguage = useRef<string | null>(null);
  const order = useRef<Order>({ wanted: settings, queued: 0 });

  useEffect(() => {
    // A first launch writes the whole set of defaults at once, so the next
    // launch reads the same, not a partial write's.
    if (!readBoot() && readLocalSettings() === null)
      writeLocalSettings({ ...loadSettings() });
    // Another window changed something. The file store keeps this window's
    // own fields (WINDOW_OWN) itself; localStorage, shared by all, doesn't.
    const adopt = () => {
      const incoming = loadSettings();
      const merged = (prev: Settings): Settings =>
        readBoot()
          ? incoming
          : {
              ...incoming,
              ...Object.fromEntries(WINDOW_OWN.map((key) => [key, prev[key]])),
            };
      commit(
        order.current,
        () => setSettingsState(merged),
        merged(order.current.wanted),
      );
    };
    // Another window's language, once its strings are here too.
    const adoptStore = () => {
      const { language } = loadSettings();
      if (localeLoaded(language)) adopt();
      else
        void loadLocale(language)
          .catch(() => {})
          .then(adopt);
    };
    const unsubscribe = subscribeRemote(adoptStore);
    // This effect runs a task after the first render; a change landing in
    // between reached the store with nobody subscribed. Catch up now.
    if (remoteVersion !== renderedVersion.current) adoptStore();
    return unsubscribe;
  }, []);

  // Read as the tree draws (counted(), the numbers' format): set before it
  // does, not after, or a switch draws plurals in the language left.
  setCurrentLanguage(settings.language);
  useEffect(() => {
    // The CSS :lang() font stacks key off it; the boot script sets the same.
    document.documentElement.lang = localeOf(settings.language);
  }, [settings.language]);

  function setSettings(patch: Partial<Settings>) {
    const apply = () => {
      commit(
        order.current,
        () => setSettingsState((prev) => ({ ...prev, ...patch })),
        { ...order.current.wanted, ...patch },
      );
      persist(patch);
    };
    // A language switched to takes effect once its strings have loaded, so
    // nothing draws in it meanwhile with English. One that fails shows in
    // English. Only the last one picked: an earlier one loading late
    // doesn't take its place.
    if (patch.language) wantedLanguage.current = patch.language;
    if (patch.language && !localeLoaded(patch.language)) {
      const lang = patch.language;
      void loadLocale(lang)
        .catch(() => {})
        .then(() => {
          if (wantedLanguage.current === lang) apply();
        });
    } else apply();
  }

  const t = resolveStrings(settings.language);

  const value = useMemo(() => ({ settings, setSettings, t }), [settings, t]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

/** The settings where a provider gives them; null outside one (a part
 *  drawn on its own, as in its tests). */
export function useSettingsIfAny(): SettingsContextValue | null {
  return useContext(SettingsContext);
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
