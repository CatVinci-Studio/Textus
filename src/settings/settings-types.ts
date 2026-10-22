import type { Lang } from "../i18n/strings";
import type { McpServer } from "./mcp";
import type { UpdateChannel } from "../platform/update-channel";
import { DEFAULT_IMAGE_SUBFOLDER } from "./image-folder";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUTS_REVISION,
  type Shortcuts,
} from "./shortcut-defaults";

/**
 * What the settings are: every option's type and choices, and the
 * defaults a new install starts from (SettingsContext.tsx).
 */

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
/** How wide the text column runs: "auto" widens with the window, "standard"
 *  keeps the classic fixed measure, "full" uses the whole pane. Applied as
 *  `data-content-width` on the root (app/editor-column.css). */
export type ContentWidth = "auto" | "standard" | "full";
export type ProxyType = "none" | "http" | "https" | "socks5";

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

/// Settings.uiTextScale's values: Settings › Editor & Appearance ›
/// Interface Text Size, as a factor on the UI's type scale.
export const UI_TEXT_SCALES = [0.9, 1, 1.1, 1.25] as const;
export type UiTextScale = (typeof UI_TEXT_SCALES)[number];

/// Settings.diagramEngine's values: Settings › Editor & Appearance ›
/// Diagram engine (editor/diagram-engine.ts). Mermaid is the default and
/// every diagram's fallback; Pele (pele.run) draws the same syntax faster,
/// in a layout of its own, and is only ever the user's choice.
export const DIAGRAM_ENGINES = ["mermaid", "pele"] as const;
export type DiagramEngine = (typeof DIAGRAM_ENGINES)[number];

/// Settings.colorSwatches' values (editor/marks/color-swatch-plugin.ts):
/// none; in code - inline code that is a colour and colour literals in
/// code blocks; everywhere - that and colour codes in the text itself.
export const COLOR_SWATCH_MODES = ["off", "code", "everywhere"] as const;
export type ColorSwatchMode = (typeof COLOR_SWATCH_MODES)[number];

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

/// Settings > Textus AI > Search service: what Textus's own web_search uses
/// when the chat model can't search by itself. "auto" takes the first of
/// the DeepSeek, Zhipu and Kimi keys already saved. Mirrors `Backend` in
/// src-tauri/src/ai/web/search.rs.
export type SearchService =
  | "auto"
  | "deepseek"
  | "zhipu"
  | "kimi"
  | "bocha"
  | "tavily"
  | "brave"
  | "exa"
  | "searxng";

export const SEARCH_SERVICES: SearchService[] = [
  "auto",
  "deepseek",
  "zhipu",
  "kimi",
  "bocha",
  "tavily",
  "brave",
  "exa",
  "searxng",
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
export const IMAGE_HOSTS: ImageHost[] = ["picgo", "smms", "imgur", "custom"];
export type ImageNamingMode = "auto" | "original" | "ask";
/** The AI conversation's mode: Write only adds text, Review only reads and
 *  comments, Revise changes the text that is there. Mirrors `AgentMode` in
 *  src-tauri/src/ai/agent/prompt.rs. */
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
  /** Settings › Textus AI › Enable Textus AI, and the window bar's switch
   *  (#196): off, Textus AI does nothing at all - no completion, grammar
   *  check, conversation or any other request to an AI service - whatever
   *  the features below are set to. They keep their own values, and apply
   *  again once it is back on (textus-ai.ts). Rust reads it too, as
   *  TEXTUS_AI_SETTING in src-tauri/src/ai/mod.rs. On by default. */
  textusAi: boolean;
  /** When a pause from the window bar's AI button ends (ms since the
   *  epoch): Textus AI is off until then and comes back on by itself
   *  (ai/TextusAiSwitch.tsx). Null while it is on, or off until turned
   *  back on. */
  textusAiResumeAt: number | null;
  enableCompletion: boolean;
  enableGrammarCheck: boolean;
  /// How aggressive the grammar check is - from confident typos only up to
  /// style and clarity nits. Sent with every ai_grammar_check request.
  grammarStrictness: GrammarStrictness;
  enableAskAi: boolean;
  enableMath: boolean;
  enableMermaid: boolean;
  /** Who draws ```mermaid blocks first; Mermaid draws what Pele can't. */
  diagramEngine: DiagramEngine;
  /** Settings › Editor & Appearance › Line numbers in code blocks: a
   *  gutter of line numbers beside each code block, whose lines then
   *  scroll sideways instead of wrapping. Off by default. */
  codeLineNumbers: boolean;
  /** Settings › Editor & Appearance › Colour swatches (#146): where a
   *  small square of the colour shows before a colour code. Off by
   *  default. */
  colorSwatches: ColorSwatchMode;
  /** Where newly pasted images go. Existing markdown image references are
   *  never migrated when this changes. */
  imageStorageMode: ImageStorageMode;
  /** The folder a saved document's images go in when they are stored
   *  locally (#147): "./" for the document's own folder, or the name of a
   *  subfolder of it ("assets" by default). Resolved by fs.rs's
   *  ImageFolder; settings/image-folder.ts has the rules. */
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
  /// The composer's Web search button starts on. The provider's own
  /// search where it has one, else Textus's web_search on `searchService`.
  enableWebSearch: boolean;
  /// Settings > Textus AI > Image model: the service ("" for none, the
  /// default - a picture costs money), its model ("" for its default) and,
  /// for an OpenAI-compatible endpoint, its address. What generate_image
  /// uses (ai/image-models.ts, src-tauri ai/images.rs).
  imageModelProvider: string;
  imageModel: string;
  /** At most this many pictures per request (ai/images.rs per_send). */
  imagesPerRequest: number;
  imageModelEndpoint: string;
  searchService: SearchService;
  /// The SearXNG server `searchService: "searxng"` sends queries to.
  searxngUrl: string;
  /// The proposal card's "Add sources as footnotes": a proposal's web
  /// citations become Markdown footnotes when it is accepted (off: they
  /// are left out). Remembered from the last card, not set in Settings.
  sourcesAsFootnotes: boolean;
  /// Settings > Textus AI > Remember automatically: Textus AI may keep
  /// requirements, preferences, style and facts it learns in a
  /// conversation (the memory pass, src-tauri ai/memory/pass.rs, which reads
  /// this field from settings.json as REMEMBER_SETTING). On by default.
  rememberAutomatically: boolean;
  /// The MCP servers Textus AI may use (Settings › Extensions › MCP),
  /// read by Rust from the settings file (src-tauri mcp/mod.rs).
  mcpServers: McpServer[];
  /// Settings > Textus AI > Suggest your next message: after each reply,
  /// what you will probably say next, grey in the empty message box for
  /// Tab to take (ai/chat/next-message.ts). On by default.
  suggestNextMessage: boolean;
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
  /// agent's find_files/read_file tools, so setting it is what lets the
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
  /// Typing "(", "[", "{", a quote or a full-width bracket ("（", "【",
  /// "「"...) puts its partner in after the caret, as in Typora.
  autoCloseBrackets: boolean;
  /// The user's own CSS, applied on top of whichever theme is selected -
  /// for small changes (indent, line spacing, a font) without writing a
  /// whole theme. Injected last, so it wins ties with the theme (#13).
  customCss: string;
  /// Whole-page zoom factor (1 = 100%), driven by pinch / mod+wheel / the
  /// View menu (see ../utils/useZoom). Saved here so it survives restarts;
  /// each window applies it independently on mount.
  zoom: number;
  /// The size of the app's own text - sidebar, outline, AI panel, tabs,
  /// menus, Settings - as a factor on the type scale (1 = 100%), for every
  /// window. Published as `--ui-text-scale` (theme/apply-appearance.ts);
  /// the document has its own zoom, above.
  uiTextScale: UiTextScale;
  shortcuts: Shortcuts;
  /// The SHORTCUTS_REVISION `shortcuts` was last saved under, so a later
  /// build can tell an action left unbound on purpose from one that had no
  /// default yet (migrateShortcuts). 0 for shortcuts saved before it.
  shortcutsRevision: number;
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
  /** Settings › General › App: closing the last window leaves the process
   *  running, with a tray (menu bar) icon. Off by default, desktop only;
   *  Rust reads it (src-tauri/src/background/). */
  runInBackground: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  languageChosen: false,
  levisImportOffered: false,
  theme: "system",
  textusAi: true,
  textusAiResumeAt: null,
  enableCompletion: true,
  enableGrammarCheck: true,
  grammarStrictness: "standard",
  enableAskAi: true,
  enableMath: true,
  enableMermaid: true,
  diagramEngine: "mermaid",
  codeLineNumbers: false,
  colorSwatches: "off",
  imageStorageMode: "local",
  imageFolder: DEFAULT_IMAGE_SUBFOLDER,
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
  imageModelProvider: "chat",
  imageModel: "",
  imagesPerRequest: 2,
  imageModelEndpoint: "",
  searchService: "auto",
  searxngUrl: "",
  sourcesAsFootnotes: false,
  rememberAutomatically: true,
  mcpServers: [],
  suggestNextMessage: true,
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
  autoCloseBrackets: true,
  customCss: "",
  zoom: 1,
  uiTextScale: 1,
  shortcuts: DEFAULT_SHORTCUTS,
  shortcutsRevision: SHORTCUTS_REVISION,
  themeId: "default",
  userThemes: [],
  newDocumentMode: "window",
  restoreSessionOnStartup: true,
  autoSuggestFilename: true,
  autosave: false,
  pdfPageNumbers: false,
  updateChannel: "stable",
  onboardingShown: false,
  enableChatHistory: true,
  enableClipboardHistory: true,
  enableDraftRecovery: true,
  runInBackground: false,
};
