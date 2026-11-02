import type { Lang } from "../i18n/strings";
import type { McpServer } from "./mcp";
import type { UpdateChannel } from "../platform/update-channel";
import { DEFAULT_IMAGE_SUBFOLDER } from "./image-folder";
import { DEFAULT_SHORTCUTS, type Shortcuts } from "./shortcut-defaults";

/** Every setting's type and choices, and the defaults a new install starts from. */

/// Light/dark, orthogonal to `themeId`: every theme defines both forms, so
/// the two axes always compose.
export type ThemeMode = "system" | "light" | "dark";
/// A provider catalog id ("openai", "anthropic", "custom", ...). Not a closed
/// union: the catalog, fetched at runtime, decides which exist.
export type AiProvider = string;
export type NewDocumentMode = "window" | "tab";
/** How wide the text column runs: "auto" widens with the window, "standard"
 *  keeps the classic fixed measure, "full" uses the whole pane. */
export type ContentWidth = "auto" | "standard" | "full";
export type ImageAlign = "center" | "left";
/** How every document shows: the rich editor, its Markdown source, or the
 *  source beside a preview. One for all windows. */
export type ViewMode = "rich" | "source" | "split";
export type ProxyType = "none" | "http" | "https" | "socks5";

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

/// Interface Text Size, as a factor on the UI's type scale.
export const UI_TEXT_SCALES = [0.9, 1, 1.1, 1.25] as const;
export type UiTextScale = (typeof UI_TEXT_SCALES)[number];
/** The document's text size in px, or "auto" for the theme's own. */
export const DOC_TEXT_SIZES = ["auto", 14, 15, 16, 17, 18, 20, 22, 24] as const;
export type DocTextSize = (typeof DOC_TEXT_SIZES)[number];
/** The document's line spacing, or "auto" for the theme's own. */
export const DOC_LINE_SPACINGS = [
  "auto",
  "compact",
  "standard",
  "relaxed",
] as const;
export type DocLineSpacing = (typeof DOC_LINE_SPACINGS)[number];
/** Each spacing's line height. */
export const DOC_LINE_HEIGHTS: Record<
  Exclude<DocLineSpacing, "auto">,
  number
> = {
  compact: 1.55,
  standard: 1.8,
  relaxed: 2.05,
};

/// Mermaid is the default and every diagram's fallback; Pele draws the same
/// syntax faster, in its own layout, and only by the user's choice.
export const DIAGRAM_ENGINES = ["mermaid", "pele"] as const;
export type DiagramEngine = (typeof DIAGRAM_ENGINES)[number];

/// Colour swatches: none; in code (inline code and code-block literals);
/// everywhere (that and colour codes in the text).
export const COLOR_SWATCH_MODES = ["off", "code", "everywhere"] as const;
export type ColorSwatchMode = (typeof COLOR_SWATCH_MODES)[number];

/// In the order the menus list them, the default first.
export const REVISION_DISPLAYS = ["final", "original", "inline"] as const;
export type RevisionDisplay = (typeof REVISION_DISPLAYS)[number];

/// Tone presets for AI completion, each resolved to an English style
/// directive appended to the completion prompt.
export type CompletionTone =
  "default" | "formal" | "casual" | "academic" | "concise";

export const COMPLETION_TONES: CompletionTone[] = [
  "default",
  "formal",
  "casual",
  "academic",
  "concise",
];

/// What Textus's own web_search uses when the chat model can't search.
/// "auto" takes the first of the DeepSeek, Zhipu and Kimi keys saved.
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

/// A user-imported theme. Its CSS lives on disk in the app's theme
/// directory; only metadata is kept in the settings.
export interface UserThemeMeta {
  id: string;
  name: string;
  hasDark: boolean;
  /// Set when installed from the theme gallery, so a newer one shows as an
  /// update. Rust reads only `id`, `hasDark` and, to count an uninstall,
  /// `gallery` (commands/themes.rs).
  gallery?: GalleryOrigin;
}

export interface GalleryOrigin {
  id: string;
  /// The installed copy's `GalleryTheme.updated`.
  updated: string;
  source: string;
}

export type ImageStorageMode = "local" | "image-host";
/** Keep in step with the Rust `ImageHost`. */
export type ImageHost = "picgo" | "smms" | "imgur" | "custom";
export const IMAGE_HOSTS: ImageHost[] = ["picgo", "smms", "imgur", "custom"];
export type ImageNamingMode = "auto" | "original" | "ask";
/** The AI conversation's mode: Write adds and changes text, Review only
 *  reads and comments, Create makes a theme, plugin or skill. In composer order. */
export type AgentMode = "write" | "review" | "create";
export const AGENT_MODES: readonly AgentMode[] = ["write", "review", "create"];
/** The AI panel's modes: the agent's, then Research, which researches a
 *  topic and writes a paper (docs/design/ai-paper.md). Research never
 *  reaches the agent, so it is no skill's mode and no default. */
export type PanelMode = AgentMode | "research";

/** A stored mode, or null for anything that isn't one of today's; the old
 *  Revise mode reads as Write. */
export function storedAgentMode(value: unknown): AgentMode | null {
  if (value === "revise") return "write";
  return AGENT_MODES.includes(value as AgentMode) ? (value as AgentMode) : null;
}

export interface Settings {
  language: Lang;
  /** False until the language welcome screen is confirmed. */
  languageChosen: boolean;
  /// Appearance: follow the OS, or pin light/dark.
  theme: ThemeMode;
  /** Off, Textus AI makes no request to any AI service, whatever the
   *  features below are set to; they keep their values. Rust reads it too. */
  textusAi: boolean;
  /** When a pause from the window bar's AI button ends (ms since the epoch).
   *  Null while it is on, or off until turned back on. */
  textusAiResumeAt: number | null;
  enableCompletion: boolean;
  enableGrammarCheck: boolean;
  /// How aggressive the grammar check is, from confident typos only up to
  /// style and clarity nits.
  grammarStrictness: GrammarStrictness;
  enableAskAi: boolean;
  enableMath: boolean;
  enableMermaid: boolean;
  /** Who draws ```mermaid blocks first; Mermaid draws what Pele can't. */
  diagramEngine: DiagramEngine;
  /** Line numbers beside each code block, whose lines then scroll sideways
   *  instead of wrapping. */
  codeLineNumbers: boolean;
  /** Where a small square of the colour shows before a colour code. */
  colorSwatches: ColorSwatchMode;
  /** Where newly pasted images go. Existing markdown image references are
   *  never migrated when this changes. */
  imageStorageMode: ImageStorageMode;
  /** The folder a saved document's local images go in: "./" for its own
   *  folder, or the name of a subfolder of it. */
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
  /// How a pending rewrite shows, as Word's markup views: "final" (result in
  /// the text, removals in the margin), "original" (struck original, new text
  /// in the margin; "inline" where no room) or "inline". Legacy "new" reads as "final".
  revisionDisplay: RevisionDisplay;
  /// Tone preset for inline completion suggestions.
  completionTone: CompletionTone;
  /// "automatic", or a profile such as "zh-Hans-CN/fiction" the AI and the
  /// checks follow for that language. A project's style profile overrides it.
  writingConventions: string;
  /// The composer's Web search button starts on. The provider's own
  /// search where it has one, else Textus's web_search on `searchService`.
  enableWebSearch: boolean;
  /// The image service ("" for none, the default: a picture costs money), its
  /// model ("" for its default) and, for an OpenAI-compatible endpoint, its address.
  imageModelProvider: string;
  imageModel: string;
  /** At most this many pictures per request. */
  imagesPerRequest: number;
  imageModelEndpoint: string;
  searchService: SearchService;
  /// The SearXNG server `searchService: "searxng"` sends queries to.
  searxngUrl: string;
  /// The proposal card's "Add sources as footnotes": remembered from the last
  /// card, not set in Settings.
  sourcesAsFootnotes: boolean;
  /// Textus AI may keep requirements, preferences, style and facts it learns
  /// in a conversation. Rust reads it from settings.json.
  rememberAutomatically: boolean;
  /// The MCP servers Textus AI may use; Rust reads them from the settings file.
  mcpServers: McpServer[];
  /// Each plugin's settings, by plugin id; a project's `.textus/settings.json`
  /// holds the same, over these.
  plugins: Record<string, Record<string, unknown>>;
  /// After each reply, a likely next message, grey in the empty box for Tab
  /// to take.
  suggestNextMessage: boolean;
  /// Whether an agent edit's in-document preview types itself in or appears
  /// complete at once.
  enableEditAnimation: boolean;
  /// Where Quick Ask's "open full conversation" goes: the docked panel
  /// (default) or the detached window.
  agentExpandToWindow: boolean;
  /// Whether the detached Agent window floats above other windows. Kept
  /// here rather than per-window so the choice survives closing it.
  pinAgentWindow: boolean;
  /// The project folder, or "" for the document's own folder. Its `.textus/`
  /// is read and it bounds the agent's file tools, so setting it lets the
  /// agent reach material that doesn't live next to the draft.
  agentWorkspaceRoot: string;
  /// Proxy all AI provider requests route through ("none" or an empty host
  /// means direct). Handed to Rust as a URL.
  proxyType: ProxyType;
  proxyHost: string;
  proxyPort: string;
  typewriterMode: boolean;
  /** The view every document is in, in every window. */
  viewMode: ViewMode;
  /** Zen mode in every window. */
  zenMode: boolean;
  contentWidth: ContentWidth;
  /** How an image on a line of its own sits. Display only: the file is
   *  not changed. */
  imageAlign: ImageAlign;
  /// Windows and Linux: the menus along the app-drawn window bar instead of
  /// behind ☰. On, the bar has no sidebar button.
  menuBarShown: boolean;
  /// Typing "*", "**", "~~", "==" or "`" puts the closing mark in at once. Off,
  /// a complete "**text**" still turns into bold.
  autoCloseMarks: boolean;
  /// Typing "(", "[", "{", a quote or a full-width bracket ("（", "【",
  /// "「"...) puts its partner in after the caret, as in Typora.
  autoCloseBrackets: boolean;
  /// The right-click menu offers copying and pasting as plain text.
  plainTextMenu: boolean;
  /// The user's own CSS, injected after the theme so it wins ties.
  customCss: string;
  /// Whole-page zoom factor (1 = 100%). Saved so it survives restarts; each
  /// window applies it independently on mount.
  zoom: number;
  /// The size of the app's own UI text (not the document) as a factor on the
  /// type scale, for every window.
  uiTextScale: UiTextScale;
  /** The reader's own document text size and line spacing, over the
   *  theme's; "auto" keeps the theme's. */
  docTextSize: DocTextSize;
  docLineSpacing: DocLineSpacing;
  shortcuts: Shortcuts;
  /** The keys of plugins' commands as the user set them, by command id,
   *  over their manifests' keybindings; "" for none. */
  commandShortcuts: Record<string, string>;
  /// A built-in theme id or a `UserThemeMeta.id`.
  themeId: string;
  userThemes: UserThemeMeta[];
  /// "window" (default): another document opens a new OS window; "tab": a
  /// tab in this one. Rust reads it from the settings file, often before any webview exists.
  newDocumentMode: NewDocumentMode;
  /// Whether startup reopens last session's documents. Rust reads it before
  /// any webview exists; it also lets an update relaunch reopen what was open.
  restoreSessionOnStartup: boolean;
  /** Suggest an H1 or first content line as a draft's Save As filename. */
  autoSuggestFilename: boolean;
  /** Write a document that has a file back to it once typing rests. */
  autosave: boolean;
  /** Export as PDF numbers each page in its bottom margin. */
  pdfPageNumbers: boolean;
  /** macOS: export PDFs on white in the theme's light colours. Other
   *  platforms always do. */
  pdfLightColors: boolean;
  /** Which releases the updater offers: "stable", or "beta" for release
   *  candidates as well. */
  updateChannel: UpdateChannel;
  /// Set once the first-run tutorial has been shown or skipped, in case a
  /// window closes mid-tutorial.
  onboardingShown: boolean;
  /// Privacy toggles: each stops one kind of locally stored history going
  /// forward; turning one off does not clear what's already stored.
  enableChatHistory: boolean;
  enableClipboardHistory: boolean;
  enableDraftRecovery: boolean;
  /** Closing a window with unsaved changes keeps them as drafts for the next
   *  launch instead of asking. Needs enableDraftRecovery. */
  keepUnsavedOnClose: boolean;
  /** Closing the last window leaves the process running with a tray icon.
   *  Desktop only; Rust reads it. */
  runInBackground: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  language: "en",
  languageChosen: false,
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
  revisionDisplay: "final",
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
  plugins: {},
  suggestNextMessage: true,
  enableEditAnimation: true,
  agentExpandToWindow: false,
  pinAgentWindow: false,
  agentWorkspaceRoot: "",
  proxyType: "none",
  proxyHost: "",
  proxyPort: "",
  typewriterMode: false,
  viewMode: "rich",
  zenMode: false,
  contentWidth: "auto",
  imageAlign: "center",
  menuBarShown: false,
  autoCloseMarks: true,
  autoCloseBrackets: true,
  plainTextMenu: false,
  customCss: "",
  zoom: 1,
  uiTextScale: 1,
  docTextSize: "auto",
  docLineSpacing: "auto",
  shortcuts: DEFAULT_SHORTCUTS,
  commandShortcuts: {},
  themeId: "default",
  userThemes: [],
  newDocumentMode: "window",
  restoreSessionOnStartup: true,
  autoSuggestFilename: true,
  autosave: false,
  pdfPageNumbers: false,
  pdfLightColors: false,
  updateChannel: "stable",
  onboardingShown: false,
  enableChatHistory: true,
  enableClipboardHistory: true,
  enableDraftRecovery: true,
  keepUnsavedOnClose: false,
  runInBackground: false,
};
