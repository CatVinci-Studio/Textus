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
  detectLang,
  isLang,
  localeOf,
  resolveStrings,
  type Lang,
  type Strings,
} from "../i18n/strings";
import { ai, storage } from "../platform/ipc";
import {
  UPDATE_CHANNELS,
  type UpdateChannel,
} from "../platform/update-channel";
import { readBoot, readLocalJson } from "../storage/boot";
import { importLegacyStorage } from "../storage/legacy-import";
import { trackWrite } from "../storage/pending-writes";
import { listenToThisWindow } from "../utils/tauri-events";
import { SettingsSync, type Raw } from "./settings-sync";
import { useApplyAppearance } from "../theme/apply-appearance";

/// Light/dark, orthogonal to which content theme is selected: `themeId`
/// picks the palette, this picks which of its two forms is shown. Every
/// theme defines BOTH (see content-themes.css) - one that only has a single
/// design defines the same values twice - so the two axes compose without
/// any combination being undefined.
export type ThemeMode = "system" | "light" | "dark";
/// A provider catalog id (src-tauri/src/ai/catalog.rs) - "openai",
/// "anthropic", "google", "custom", etc. Not a closed union: the catalog is
/// the source of truth for which providers exist, fetched at runtime.
export type AiProvider = string;
export type NewDocumentMode = "window" | "tab";
/** What a copy from the editor puts in the clipboard's plain text, the part
 *  apps like WeChat read: the words as they read ("readable") or the
 *  Markdown source ("markdown"). The formatted (HTML) flavor is the same
 *  either way. */
export type CopyTextMode = "readable" | "markdown";
/** How wide the text column runs: "auto" widens with the window, "standard"
 *  keeps the classic fixed measure, "full" uses the whole pane. Applied as
 *  `data-content-width` on the root (app/editor-column.css). */
export type ContentWidth = "auto" | "standard" | "full";
export type ProxyType = "none" | "http" | "https" | "socks5";

/// Keyboard-triggerable actions. Each maps to a normalized combo string
/// (see ../utils/shortcuts) - empty string means "unbound".
export type ShortcutAction =
  | "triggerCompletion"
  | "triggerGrammarCheck"
  | "toggleFloatingChat"
  | "toggleSidebar"
  | "toggleAgentPanel"
  | "toggleSplitView"
  | "toggleZenMode"
  | "toggleSourceMode"
  | "toggleTypewriterMode"
  | "findReplace";

export type Shortcuts = Record<ShortcutAction, string>;

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

const DEFAULT_SHORTCUTS: Shortcuts = {
  triggerCompletion: "mod+shift+space",
  triggerGrammarCheck: "mod+shift+g",
  toggleFloatingChat: "mod+shift+k",
  toggleSidebar: "mod+\\",
  toggleAgentPanel: "mod+shift+l",
  toggleSplitView: "mod+shift+e",
  toggleZenMode: "mod+shift+j",
  toggleSourceMode: "mod+/",
  toggleTypewriterMode: "",
  findReplace: "mod+f",
};

/// Settings.revisionDisplay's values.
export const REVISION_DISPLAYS = [
  "inline",
  "original",
  "new",
  "final",
] as const;
export type RevisionDisplay = (typeof REVISION_DISPLAYS)[number];

/// Tone presets for AI completion - resolved to an English style directive
/// appended to the completion prompt (see ../ai/completion-style).
export type CompletionTone =
  "default" | "formal" | "casual" | "academic" | "concise";

export const COMPLETION_TONES: CompletionTone[] = [
  "default",
  "formal",
  "casual",
  "academic",
  "concise",
];

export type GrammarStrictness = "typos" | "standard" | "strict";

/// A user-imported (Typora-style) theme. The actual CSS lives on disk under
/// the app's theme directory (see ../utils/theme-import and the Rust
/// save_theme_css/load_theme_css commands) - only small metadata is kept
/// here in the settings.
export interface UserThemeMeta {
  id: string;
  name: string;
  hasDark: boolean;
  /// Set when the theme was installed from the theme gallery
  /// (theme/theme-gallery.ts): which one, and the version installed, so a
  /// newer one shows as an update. Rust reads only `id` and `hasDark`.
  gallery?: GalleryOrigin;
}

export interface GalleryOrigin {
  /// The gallery's theme id (`GalleryTheme.id`).
  id: string;
  /// `GalleryTheme.updated` of the installed copy.
  updated: string;
  source: string;
}

export type ImageStorageMode = "local" | "image-host";
/** Mirrors `ImageHost` in src-tauri/src/commands/image_host.rs. */
export type ImageHost = "picgo" | "smms" | "imgur" | "custom";
const IMAGE_HOSTS: ImageHost[] = ["picgo", "smms", "imgur", "custom"];
export type ImageNamingMode = "auto" | "original" | "ask";
/** The AI conversation's mode: Write only adds text, Review only reads and
 *  comments, Revise changes the text that is there. Mirrors `AgentMode` in
 *  src-tauri/src/ai/agent.rs. */
export type AgentMode = "write" | "review" | "revise";
export const AGENT_MODES: readonly AgentMode[] = ["write", "review", "revise"];

/** A stored mode as one of today's: Ask and Edit were renamed Review and
 *  Revise in 1.1, and Plan, removed then, opens in Review. Anything else
 *  is null. */
export function migrateAgentMode(value: unknown): AgentMode | null {
  if (value === "ask" || value === "plan") return "review";
  if (value === "edit") return "revise";
  return AGENT_MODES.includes(value as AgentMode) ? (value as AgentMode) : null;
}

export interface Settings {
  language: Lang;
  /** False only on a fresh install, until the language welcome screen is
   *  confirmed. Existing installations are migrated to true. */
  languageChosen: boolean;
  /** The first-launch offer to import a Levis installation was answered
   *  (or the import ran) - settings/levis-import.ts. */
  levisImportOffered: boolean;
  /// Appearance: follow the OS, or pin light/dark. Independent of `themeId`.
  theme: ThemeMode;
  enableCompletion: boolean;
  enableGrammarCheck: boolean;
  /// How aggressive the grammar check is - from confident typos only up to
  /// style and clarity nits. Sent with every ai_grammar_check request.
  grammarStrictness: GrammarStrictness;
  enableAskAi: boolean;
  enableMath: boolean;
  enableMermaid: boolean;
  /** Where newly pasted images go. Existing markdown image references are
   *  never migrated when this changes. */
  imageStorageMode: ImageStorageMode;
  /** The folder a saved document's images go in when they are stored
   *  locally, relative to the document (#147): "assets", "./",
   *  "${filename}.assets" or the user's own path. Resolved by fs.rs's
   *  ImageFolder. */
  imageFolder: string;
  /** Where uploaded images go: a PicGo or PicList app on this computer
   *  (the services set up in it), SM.MS, Imgur, or the user's endpoint. */
  imageHost: ImageHost;
  /** Filename policy used only by the remote image-host uploader. */
  imageNamingMode: ImageNamingMode;
  /** The PicGo / PicList server's upload address; loopback only. */
  imagePicgoEndpoint: string;
  /** A user-owned multipart endpoint. It receives the image in `file`. */
  imageUploadEndpoint: string;
  /** Dot-separated path to the public URL in the endpoint's JSON response. */
  imageUploadUrlField: string;
  aiProvider: AiProvider;
  /// Shared model for inline completion and grammar checking, per provider.
  /// Missing/"" keeps the provider's low-cost writing default.
  writingModels: Record<string, string>;
  /// Agent chat model per provider id; missing/"" uses the provider's
  /// default. Keyed by catalog id, so adding a provider needs no Settings
  /// shape change.
  agentModels: Record<string, string>;
  /** Initial mode shown in a newly mounted Agent composer. */
  agentDefaultMode: AgentMode;
  /// How a pending rewrite shows in the document, as Word's markup views:
  /// "inline" (struck original and new text in the text), "original" (the
  /// original struck in the text, the new text in the margin), "new" (the
  /// new text in the text, the original in the margin) or "final" (only
  /// the result, unmarked). The margin views fall back to "inline" where
  /// there is no room for a margin.
  revisionDisplay: RevisionDisplay;
  /// Tone preset for inline completion suggestions.
  completionTone: CompletionTone;
  /// Settings > Textus AI > Writing Assistance > Writing conventions:
  /// "automatic", or a profile such as "zh-Hans-CN/fiction" that the AI
  /// and the checks follow for documents in that language (Rust reads it;
  /// settings/writing-conventions.ts lists the values). A project's style
  /// profile overrides it.
  writingConventions: string;
  /// Offer the active provider's native server-side web search to Agent;
  /// providers without a compatible search API safely ignore it.
  enableWebSearch: boolean;
  /// Whether an agent edit's green in-document preview streams/types itself
  /// in (pending-edit-plugin's typewriter) or appears complete at once.
  enableEditAnimation: boolean;
  /// Where Quick Ask's "open full conversation" goes: the docked panel on
  /// the right (default), or the detached window - for a second monitor.
  /// The panel's own header pops out to the window either way.
  agentExpandToWindow: boolean;
  /// Whether the detached Agent window floats above other windows. Kept
  /// here rather than per-window so the choice survives closing it.
  pinAgentWindow: boolean;
  /// The chosen project folder (in code, the workspace root), or "" for
  /// the default: the folder of the document being edited. One setting for
  /// every document. It is the folder whose `.textus/` (style profile,
  /// library, agent.md, skills) is read AND the sandbox boundary of the
  /// agent's list_files/read_file tools, so setting it is what lets the
  /// agent reach reference material that doesn't live next to the draft.
  /// See docs/design/ai-concepts.md.
  agentWorkspaceRoot: string;
  /// Proxy all AI provider requests route through, as type + host + port
  /// ("none" or an empty host means direct connection). Handed to Rust as a
  /// URL (see the effect below), which is what sends the requests.
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  typewriterMode: boolean;
  contentWidth: ContentWidth;
  /// Typing "*", "**", "~~", "==" or "`" puts the closing mark in at once
  /// (an empty span to type into). Off, the marks are typed by hand and a
  /// complete "**text**" still turns into bold (#136).
  autoCloseMarks: boolean;
  /// The user's own CSS, applied on top of whichever theme is selected -
  /// for small changes (indent, line spacing, a font) without writing a
  /// whole theme. Injected last, so it wins ties with the theme (#13).
  customCss: string;
  /// Whole-page zoom factor (1 = 100%), driven by pinch / mod+wheel / the
  /// View menu (see ../utils/useZoom). Saved here so it survives restarts;
  /// each window applies it independently on mount.
  zoom: number;
  shortcuts: Shortcuts;
  /// Either a built-in theme id (theme/builtin-themes.ts) or a
  /// `UserThemeMeta.id`.
  themeId: string;
  userThemes: UserThemeMeta[];
  /// "window" (default): opening another document spawns a new OS window,
  /// unchanged from the original behavior. "tab": opening another document
  /// opens a tab in the current window instead. Read by Rust straight from
  /// the settings file (commands/prefs.rs), since window-vs-tab is decided
  /// there, often before any webview exists.
  newDocumentMode: NewDocumentMode;
  /// Whether startup reopens last session's documents (default) or starts
  /// blank. Read by Rust straight from the settings file, since the decision
  /// is made in setup() before any webview exists; this is also what lets an
  /// app-update relaunch (which starts with no file arguments at all) reopen
  /// whatever was open before it.
  restoreSessionOnStartup: boolean;
  /** Suggest an H1 or first content line as a draft's Save As filename. */
  autoSuggestFilename: boolean;
  /** Settings › General › Save Automatically (#133): write a document that
   *  has a file back to it once typing rests (document/autosave.ts). Off by
   *  default. */
  autosave: boolean;
  copyTextMode: CopyTextMode;
  /** File > Export as PDF numbers each page in its bottom margin
   *  (commands/pdf_page_numbers.rs). Off by default (#68). */
  pdfPageNumbers: boolean;
  /** Which releases the in-app updater offers (Settings › General › About
   *  Textus): "stable", or "beta" for release candidates as well. Sent with
   *  each check (src-tauri/src/commands/update.rs). */
  updateChannel: UpdateChannel;
  /// Set once the first-run tutorial has been shown (or skipped) - belt and
  /// suspenders alongside `isFreshInstall` below, in case a window closes
  /// mid-tutorial before the user reaches the end.
  onboardingShown: boolean;
  /// Privacy toggles (Settings > Privacy) - each independently disables one
  /// kind of locally-stored history/recovery data going forward. Turning
  /// one off does not retroactively clear what's already stored; the
  /// section's own "Clear" button does that explicitly.
  enableChatHistory: boolean;
  enableClipboardHistory: boolean;
  enableDraftRecovery: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  language: "en",
  languageChosen: false,
  levisImportOffered: false,
  theme: "system",
  enableCompletion: true,
  enableGrammarCheck: true,
  grammarStrictness: "standard",
  enableAskAi: true,
  enableMath: true,
  enableMermaid: true,
  imageStorageMode: "local",
  imageFolder: "assets",
  imageHost: "picgo",
  imageNamingMode: "auto",
  imagePicgoEndpoint: "http://127.0.0.1:36677/upload",
  imageUploadEndpoint: "",
  imageUploadUrlField: "url",
  aiProvider: "openai",
  writingModels: {},
  agentModels: {},
  agentDefaultMode: "review",
  revisionDisplay: "original",
  completionTone: "default",
  writingConventions: "automatic",
  enableWebSearch: false,
  enableEditAnimation: true,
  agentExpandToWindow: false,
  pinAgentWindow: false,
  agentWorkspaceRoot: "",
  proxyType: "none",
  proxyHost: "",
  proxyPort: "",
  typewriterMode: false,
  contentWidth: "auto",
  autoCloseMarks: true,
  customCss: "",
  zoom: 1,
  shortcuts: DEFAULT_SHORTCUTS,
  themeId: "default",
  userThemes: [],
  newDocumentMode: "window",
  restoreSessionOnStartup: true,
  autoSuggestFilename: true,
  autosave: false,
  copyTextMode: "readable",
  pdfPageNumbers: false,
  updateChannel: "stable",
  onboardingShown: false,
  enableChatHistory: true,
  enableClipboardHistory: true,
  enableDraftRecovery: true,
};

const STORAGE_KEY = "catvinci-settings";

interface SettingsContextValue {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  t: Strings;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

/// Maps a pre-catalog-expansion provider id to its new catalog id - "codex"
/// and "apikey" both become "openai" (now one entry with two auth methods).
const LEGACY_PROVIDER_IDS: Record<string, string> = {
  codex: "openai",
  claude: "anthropic",
  apikey: "openai",
};

/// Old settings blobs kept one model field per provider id
/// (`${provider}AgentModel`); folds those into the new `agentModels` map,
/// translating ids through `LEGACY_PROVIDER_IDS`.
function migrateAgentModels(
  parsed: Record<string, unknown>,
): Record<string, string> {
  const models: Record<string, string> = {
    ...(parsed.agentModels as Record<string, string> | undefined),
  };
  for (const legacyId of ["codex", "claude", "apikey"]) {
    const value = parsed[`${legacyId}AgentModel`];
    if (typeof value === "string" && value)
      models[LEGACY_PROVIDER_IDS[legacyId]] = value;
  }
  return models;
}

/** The `lang` attribute for the UI language, which the CSS `:lang()` font
 *  stacks key off (Chinese needs its region to pick Simplified or
 *  Traditional glyphs). Kept in step with the boot script
 *  (src-tauri/src/boot.js). */
export function htmlLang(language: Lang): string {
  return localeOf(language);
}

/** A new installation starts in the OS's language, when the app has it. */
function guessLanguage(): Lang {
  return detectLang(typeof navigator === "undefined" ? "" : navigator.language);
}

function isRecord(value: unknown): value is Raw {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Stored settings -> a complete, valid `Settings`: defaults for what's
 * missing, and the migrations of older shapes. Nothing stored at all (null,
 * or an empty object) is a brand-new installation; a stored object that is
 * merely missing a field is an existing one from before that field.
 */
export function normaliseSettings(parsed: Raw | null): Settings {
  if (!parsed || Object.keys(parsed).length === 0)
    return { ...DEFAULT_SETTINGS, language: guessLanguage() };
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Existing installations created before the newcomer guide had no
      // field at all and must not suddenly receive first-run onboarding
      // after an update. A genuinely new install starts from DEFAULT_SETTINGS
      // (false); once shown, the explicit true value persists normally.
      onboardingShown:
        typeof parsed.onboardingShown === "boolean"
          ? parsed.onboardingShown
          : true,
      languageChosen:
        typeof parsed.languageChosen === "boolean"
          ? parsed.languageChosen
          : true,
      aiProvider:
        LEGACY_PROVIDER_IDS[parsed.aiProvider as string] ??
        (parsed.aiProvider as string | undefined) ??
        DEFAULT_SETTINGS.aiProvider,
      agentModels: migrateAgentModels(parsed),
      writingModels: {
        ...(parsed.writingModels as Record<string, string> | undefined),
      },
      agentDefaultMode:
        migrateAgentMode(parsed.agentDefaultMode) ??
        DEFAULT_SETTINGS.agentDefaultMode,
      revisionDisplay: REVISION_DISPLAYS.includes(
        parsed.revisionDisplay as RevisionDisplay,
      )
        ? (parsed.revisionDisplay as RevisionDisplay)
        : DEFAULT_SETTINGS.revisionDisplay,
      shortcuts: {
        ...DEFAULT_SETTINGS.shortcuts,
        ...((parsed.shortcuts as Partial<Shortcuts> | undefined) ?? {}),
      },
      // An unknown language (a newer build's, a hand edit) is English, not
      // a string table that isn't there.
      language: isLang(parsed.language) ? parsed.language : "en",
      theme: THEME_MODES.includes(parsed.theme as ThemeMode)
        ? (parsed.theme as ThemeMode)
        : DEFAULT_SETTINGS.theme,
      updateChannel: UPDATE_CHANNELS.includes(
        parsed.updateChannel as UpdateChannel,
      )
        ? (parsed.updateChannel as UpdateChannel)
        : DEFAULT_SETTINGS.updateChannel,
      // Before the presets, the one image host was the user's endpoint: an
      // installation that set one up keeps it.
      imageHost: IMAGE_HOSTS.includes(parsed.imageHost as ImageHost)
        ? (parsed.imageHost as ImageHost)
        : typeof parsed.imageUploadEndpoint === "string" &&
            parsed.imageUploadEndpoint.trim()
          ? "custom"
          : DEFAULT_SETTINGS.imageHost,
      // Any profile string is kept - a newer build's may not be in this
      // build's list - but it has to be one.
      writingConventions:
        typeof parsed.writingConventions === "string" &&
        parsed.writingConventions
          ? parsed.writingConventions
          : DEFAULT_SETTINGS.writingConventions,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** The settings blob localStorage held before the move - still the store
 *  without Rust (the browser dev shim, vitest), and what the one-time
 *  import reads. Left in place after the import, so a downgrade to 0.9.6
 *  still finds it. */
function readLocalSettings(): Raw | null {
  const parsed = readLocalJson(STORAGE_KEY);
  return isRecord(parsed) ? parsed : null;
}

function writeLocalSettings(patch: Raw) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...readLocalSettings(), ...patch }),
    );
  } catch {
    // Storage unavailable: the change holds for this session only.
  }
}

// ---------------------------------------------------------------------------
// The store. With Rust behind the page (src/storage/boot.ts), the settings
// live in settings.json, held by Rust: read here from the boot snapshot,
// changed by sending only the fields that changed, and kept in step with
// other windows through "settings-changed" (see settings-sync.ts for who
// wins when). Without it, localStorage, as before the move.
// ---------------------------------------------------------------------------

/** Mirrors SettingsChanged in src-tauri/src/settings.rs. */
interface SettingsChanged {
  rev: number;
  patch: Raw;
  from: string;
}

let sync: SettingsSync | null = null;
let normalised: { raw: Raw; settings: Settings } | null = null;
const remoteListeners = new Set<() => void>();

/** The file-backed store, set up on first use; null without Rust. */
function fileStore(): SettingsSync | null {
  if (sync) return sync;
  const boot = readBoot();
  if (!boot) return null;

  if (boot.legacyImport) {
    // First launch since the move: Rust has nothing yet, localStorage has
    // everything. Use it right away and hand it over; Rust answers with
    // what it kept (another window may have got there first).
    const legacy = normaliseSettings(readLocalSettings()) as unknown as Raw;
    sync = new SettingsSync(legacy, boot.rev);
    void importLegacyStorage(legacy).then((result) => {
      if (result) adopt(result.value, result.rev);
    });
  } else {
    sync = new SettingsSync(boot.settings, boot.rev);
    // The snapshot is from when the window was built - a reload replays an
    // old one, and a change made meanwhile by another window was sent
    // before this page could hear it - so the live values replace it.
    const live =
      Object.keys(boot.settings).length === 0
        ? // Nothing stored (a corrupt settings.json was moved aside, or
          // one Rust can't read is being left alone): write the fresh
          // defaults out now, as a first launch always has, so the next
          // launch doesn't read a half-written file as an old install.
          // Only into fields still missing, though: reloaded later, this
          // window replays the same empty snapshot, and must not put the
          // defaults back over everything changed since.
          trackWrite(
            storage.settingsFillDefaults(
              normaliseSettings(null) as unknown as Raw,
            ),
          )
        : storage.settingsGet();
    live.then((s) => adopt(s.value, s.rev)).catch(() => {});
  }

  void listenToThisWindow<SettingsChanged>("settings-changed", (event) => {
    const { rev, patch, from } = event.payload;
    if (from === boot.label || !sync) return;
    // Zoom is each window's own (see its field comment): saved for the
    // next window to open with, never pushed into ones already open.
    const shared = { ...patch };
    delete shared.zoom;
    if (sync.remote(shared, rev)) notifyRemote();
  });
  return sync;
}

/** Adopts a full snapshot from Rust, keeping this window's zoom. */
function adopt(value: Raw, rev: number) {
  if (!sync) return;
  const next = { ...value };
  if (sync.raw.zoom !== undefined) next.zoom = sync.raw.zoom;
  if (sync.snapshot(next, rev)) notifyRemote();
}

/** Counts the changes notifyRemote has announced, so a provider can tell
 *  whether one came between its first render and its subscription. */
let remoteVersion = 0;

function notifyRemote() {
  remoteVersion += 1;
  for (const fn of remoteListeners) fn();
}

function send(ticket: Map<string, number>) {
  const store = sync;
  if (!store) return;
  const patch: Raw = {};
  for (const key of ticket.keys()) patch[key] = store.raw[key];
  trackWrite(storage.settingsPatch(patch)).then(
    (rev) => store.confirm(ticket, rev),
    () => store.confirm(ticket),
  );
}

/** Saves the fields in `patch` that differ from what's stored.
 *
 *  Every change goes to Rust at once, keystrokes in Custom CSS included:
 *  Rust holds it in memory, coalesces the disk writes (FLUSH_DELAY in
 *  settings.rs) and writes whatever is pending when the app exits. A
 *  debounce here lost the last keystrokes of a quick Cmd+Q, window close or
 *  Dock Quit on macOS: the window was gone before the timer fired, and a
 *  flush from pagehide didn't reach Rust either. The IPC is still
 *  asynchronous, so every close path the app owns waits for the patches
 *  on their way before the window is destroyed (send's trackWrite,
 *  storage/pending-writes.ts). */
function persist(patch: Partial<Settings>) {
  const store = fileStore();
  if (!store) {
    writeLocalSettings(patch);
    return;
  }
  // A field not stored at all reads as its default, so setting it to the
  // default changes nothing either.
  const current = loadSettings() as unknown as Raw;
  const changed: Raw = {};
  for (const [key, value] of Object.entries(patch)) {
    if (JSON.stringify(current[key]) !== JSON.stringify(value))
      changed[key] = value;
  }
  if (Object.keys(changed).length === 0) return;
  send(store.local(changed));
}

/** Calls `fn` whenever another window (or a re-read) changes the settings.
 *  Returns the unsubscribe. */
function subscribeRemote(fn: () => void): () => void {
  if (fileStore()) {
    remoteListeners.add(fn);
    return () => remoteListeners.delete(fn);
  }
  // Fallback: another window's write to the same localStorage key.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && e.newValue !== null) fn();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

/** The current settings, outside React - exported so small standalone
 *  stores (chat-history.ts, clipboard-history.ts) can read a privacy
 *  toggle's current value without depending on context. Includes this
 *  window's latest changes, whether or not they've reached Rust yet. */
export function loadSettings(): Settings {
  const store = fileStore();
  // The fallback re-reads every time: other tabs write it too.
  if (!store) return normaliseSettings(readLocalSettings());
  if (normalised?.raw !== store.raw)
    normalised = { raw: store.raw, settings: normaliseSettings(store.raw) };
  return normalised.settings;
}

/** Forgets the store, for tests that install a different boot snapshot. */
export function resetSettingsStoreForTests(): void {
  sync = null;
  normalised = null;
  remoteListeners.clear();
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettingsState] = useState<Settings>(loadSettings);
  // Read in the same render as the state above.
  const renderedVersion = useRef(remoteVersion);

  useEffect(() => {
    // Without Rust, a first launch writes the whole set of defaults out at
    // once, as it always did: a later partial write must not make the next
    // launch mistake this for an old installation (see normaliseSettings).
    // With Rust, the store does the same (fileStore).
    if (!readBoot() && readLocalSettings() === null)
      writeLocalSettings(loadSettings() as unknown as Raw);
    // Cross-window sync: another window changed something. `zoom` stays
    // this window's own (see its field comment) - everything else adopts
    // the incoming value.
    const adoptStore = () => {
      const incoming = loadSettings();
      setSettingsState((prev) => ({ ...incoming, zoom: prev.zoom }));
    };
    const unsubscribe = subscribeRemote(adoptStore);
    // React runs this effect in a later task than the first render, and the
    // live re-read, the legacy import's answer or another window's change
    // can land in between - reaching the store while nobody is subscribed.
    // Catch up on those now.
    if (remoteVersion !== renderedVersion.current) adoptStore();
    return unsubscribe;
  }, []);

  useEffect(() => {
    document.documentElement.lang = htmlLang(settings.language);
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
    setSettingsState((prev) => ({ ...prev, ...patch }));
    persist(patch);
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
