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
import { ai } from "../platform/ipc";
import { readBoot } from "../storage/boot";
import type { Raw } from "./settings-sync";
import { useApplyAppearance } from "../theme/apply-appearance";
import type { Settings } from "./settings-types";
import { htmlLang } from "./settings-normalise";
import { setCurrentLanguage } from "../i18n/current";
import {
  loadSettings,
  persist,
  readLocalSettings,
  remoteVersion,
  subscribeRemote,
  writeLocalSettings,
} from "./settings-store";
export {
  type ShortcutAction,
  type HeadingAction,
  type Shortcuts,
  defaultShortcuts,
} from "./shortcut-defaults";
export {
  type ThemeMode,
  type AiProvider,
  type NewDocumentMode,
  type ContentWidth,
  type ProxyType,
  THEME_MODES,
  UI_TEXT_SCALES,
  type UiTextScale,
  DIAGRAM_ENGINES,
  type DiagramEngine,
  COLOR_SWATCH_MODES,
  type ColorSwatchMode,
  REVISION_DISPLAYS,
  type RevisionDisplay,
  type CompletionTone,
  COMPLETION_TONES,
  type SearchService,
  SEARCH_SERVICES,
  type GrammarStrictness,
  type UserThemeMeta,
  type GalleryOrigin,
  type ImageStorageMode,
  type ImageHost,
  type ImageNamingMode,
  type AgentMode,
  AGENT_MODES,
  storedAgentMode,
  type Settings,
} from "./settings-types";
export { htmlLang, normaliseSettings } from "./settings-normalise";
export { loadSettings, resetSettingsStoreForTests } from "./settings-store";

interface SettingsContextValue {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  t: Strings;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  // Read in the same render as the state above.
  const renderedVersion = useRef(remoteVersion);

  useEffect(() => {
    // Without Rust, a first launch writes the whole set of defaults out at
    // once - the OS's language it guessed among them - so the next launch
    // reads the same, not a partial write's (see normaliseSettings). With
    // Rust, the store does the same (fileStore).
    if (!readBoot() && readLocalSettings() === null)
      writeLocalSettings(loadSettings() as unknown as Raw);
    // Cross-window sync: another window changed something. `zoom` stays
    // this window's own (see its field comment) - everything else adopts
    // the incoming value.
    const adopt = () => {
      const incoming = loadSettings();
      setSettingsState((prev) => ({ ...incoming, zoom: prev.zoom }));
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
    // React runs this effect in a later task than the first render, and the
    // live re-read or another window's change can land in between - reaching the store while nobody is subscribed.
    // Catch up on those now.
    if (remoteVersion !== renderedVersion.current) adoptStore();
    return unsubscribe;
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(settings.language);
    setCurrentLanguage(settings.language);
  }, [settings.language]);

  // An unparseable proxy is rejected by the backend (and requests fall back
  // to a direct connection), so a half-typed host while editing the setting
  // can't wedge anything.
  useEffect(() => {
    const host = settings.proxyHost.trim();
    const port = settings.proxyPort.trim();
    const proxy =
      settings.proxyType !== "none" && host
        ? `${settings.proxyType}://${host}${port ? `:${port}` : ""}`
        : null;
    ai.setAiProxy(proxy).catch(() => {});
  }, [settings.proxyType, settings.proxyHost, settings.proxyPort]);

  // How it looks: appearance, text width, the theme and Custom CSS.
  useApplyAppearance(settings, setSettings);

  function setSettings(patch: Partial<Settings>) {
    const apply = () => {
      setSettingsState((prev) => ({ ...prev, ...patch }));
      persist(patch);
    };
    // A language switched to takes effect once its strings have loaded
    // (i18n/strings.ts), so nothing draws in it meanwhile with English.
    // One that fails to load shows in English.
    if (patch.language && !localeLoaded(patch.language))
      void loadLocale(patch.language)
        .catch(() => {})
        .then(apply);
    else apply();
  }

  const t = resolveStrings(settings.language);

  const value = useMemo(() => ({ settings, setSettings, t }), [settings, t]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
