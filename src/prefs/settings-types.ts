import BACKEND_DEFAULTS from "./backend-defaults.json";
import type { Lang } from "../i18n/strings";
import type { McpServer } from "./mcp";
import type { UpdateChannel } from "../platform/update-channel";
import { DEFAULT_IMAGE_SUBFOLDER } from "./image-folder";
import { DEFAULT_SHORTCUTS, type Shortcuts } from "./shortcut-defaults";
import {
  type ThemeMode,
  type AiProvider,
  type ContentWidth,
  type ImageAlign,
  type EmbedDisplay,
  type ViewMode,
  type ProxyType,
  type UiTextScale,
  type DocTextSize,
  type DocLineSpacing,
  type DocLetterSpacing,
  type DiagramEngine,
  type PandocArgsFormat,
  type ColorSwatchMode,
  type RevisionDisplay,
  type AiChangeMode,
  type CompletionTone,
  type SearchService,
  type GrammarStrictness,
  type UserThemeMeta,
  type Creation,
  type ImageStorageMode,
  type ImageHost,
  type ImageNamingMode,
} from "./settings-values";

/** Every setting's type and choices, and the defaults a new install starts from. */

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
  /** The provider completion and grammar checking use; "" follows the
   *  chat's (aiProvider), so changing the chat's leaves them be. */
  writingProvider: string;
  /// Shared model for inline completion and grammar checking, per provider.
  /// Missing/"" keeps the provider's low-cost writing default.
  writingModels: Record<string, string>;
  /// Agent chat model per provider id; missing/"" uses the provider's
  /// default. Keyed by catalog id, so adding a provider needs no Settings
  /// shape change.
  agentModels: Record<string, string>;
  /** The external agent ("<plugin>/<agent id>", a plugin's
   *  `contributes.agents`) Textus AI's chat talks to instead of a model;
   *  "" for none. */
  chatAgent: string;
  /// How a pending rewrite shows, as Word's markup views: "final" (result in
  /// the text, removals in the margin), "original" (struck original, new text
  /// in the margin; "inline" where no room) or "inline". Legacy "new" reads as "final".
  revisionDisplay: RevisionDisplay;
  /// Tone preset for inline completion suggestions.
  completionTone: CompletionTone;
  /// "automatic", or a profile such as "zh-Hans-CN/fiction" the AI and the
  /// checks follow for that language. A project's style profile overrides it.
  writingConventions: string;
  /// Textus AI's changes as revisions to review (the default) or written
  /// straight in - the open document and the folder's other files alike.
  /// Other agents (Claude Code, Codex) go their own way.
  aiChangeMode: AiChangeMode;
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
  /// In Research, a question's researcher may hand parts of it to helpers of
  /// its own: more thorough, slower and dearer. Off unless chosen.
  researchSubHelpers: boolean;
  /** Research checks every cited sentence against its sources' notes before
   *  the review's revision. Off: one more model call a section. */
  researchCheckClaims: boolean;
  /// The MCP servers Textus AI may use; Rust reads them from the settings file.
  mcpServers: McpServer[];
  /// Each plugin's settings, by plugin id; a project's `.textus/settings.json`
  /// holds the same, over these.
  plugins: Record<string, Record<string, unknown>>;
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
  /** The formatting row under the title bar. */
  formatBar: boolean;
  /** formatBar has been turned on once for a profile from before it was
   *  on by default (settings-normalise.ts). */
  formatBarOnce: boolean;
  /** Every document zoomed together, not each tab its own (documents
   *  only: Settings, plugin pages and the AI aren't zoomed). */
  zoomTogether: boolean;
  /** The view every document is in, in every window. */
  viewMode: ViewMode;
  /** Zen mode in every window. */
  zenMode: boolean;
  contentWidth: ContentWidth;
  /** Each body paragraph's first line set in by two characters. */
  firstLineIndent: boolean;
  /** A gray "type / to insert" on the empty line the caret is on. */
  emptyLineHint: boolean;
  /** How an image on a line of its own sits. Display only: the file is
   *  not changed. */
  imageAlign: ImageAlign;
  /// Windows and Linux: the menus along the app-drawn window bar instead of
  /// behind ☰. On, the bar has no sidebar button.
  menuBarShown: boolean;
  /// The column of icons at the window's left edge (Files, Outline, plugins'
  /// pages). Off, the sidebar shows its tabs along its own top again.
  activityRail: boolean;
  /// Floating islands (the page and panels as rounded sheets on the frame)
  /// or classic (flush, square, hairlines).
  layout: "islands" | "classic";
  /// Sidebar tabs the user took off the rail, by id.
  activityRailHidden: string[];
  /// Plugins' sidebar tabs the user pinned among Textus's own at the rail's
  /// top, by id, in order.
  activityRailPinned: string[];
  /// The rail's icons in the order they were dragged to, by id; kept with
  /// the pinned ones, so every window has both.
  activityRailOrder: string[];
  /// ![[note]] embeds drawn in full, or folded to a card each until opened.
  embedDisplay: EmbedDisplay;
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
  /** A font family for the document's text, over the theme's; "" keeps the
   *  theme's. */
  docFont: string;
  docLetterSpacing: DocLetterSpacing;
  /** Points, for expanded and condensed. */
  docLetterSpacingBy: number;
  shortcuts: Shortcuts;
  /** The keys of plugins' commands as the user set them, by command id,
   *  over their manifests' keybindings; "" for none. */
  commandShortcuts: Record<string, string>;
  /// A built-in theme id or a `UserThemeMeta.id`.
  themeId: string;
  userThemes: UserThemeMeta[];
  /** What Create made, newest first (see `Creation`). */
  creations: Creation[];
  /// Whether startup reopens last session's documents. Rust reads it before
  /// any webview exists; it also lets an update relaunch reopen what was open.
  restoreSessionOnStartup: boolean;
  /** A window nothing opens in at launch shows the start page instead of a
   *  blank document (with restoreSessionOnStartup off). */
  startPageOnLaunch: boolean;
  /** Closing the last document shows the start page instead of closing
   *  the window. */
  closeLastToStartPage: boolean;
  /** Suggest an H1 or first content line as a draft's Save As filename. */
  autoSuggestFilename: boolean;
  /** Write a document that has a file back to it once typing rests. */
  autosave: boolean;
  /** Export as PDF numbers each page in its bottom margin. */
  pdfPageNumbers: boolean;
  /** macOS: export PDFs on white in the theme's light colours. Other
   *  platforms always do. */
  pdfLightColors: boolean;
  /** A Word file whose styles, fonts and margins a Word export takes
   *  (Pandoc's reference document); "" for Pandoc's own. */
  docxReferenceDoc: string;
  /** Pandoc exports open with a table of contents. */
  exportToc: boolean;
  /** Pandoc exports number their headings as Heading Numbers does. */
  exportNumberHeadings: boolean;
  /** A .bib file Pandoc's citeproc reads `[@key]` from; "" for none. */
  exportBibliography: string;
  /** The citation style (.csl) for it; "" for Pandoc's (Chicago). */
  exportCsl: string;
  /** The user's own Pandoc arguments by format ("all" for every one), as
   *  argv lists; never run through a shell. */
  pandocArgs: Partial<Record<PandocArgsFormat, string[]>>;
  /** Which releases the updater offers: "stable", or "beta" for release
   *  candidates as well. */
  updateChannel: UpdateChannel;
  /// Set once the first-run tutorial has been shown or skipped, in case a
  /// window closes mid-tutorial.
  onboardingShown: boolean;
  /// Privacy toggles: each stops one kind of locally stored history going
  /// forward; turning one off does not clear what's already stored.
  enableChatHistory: boolean;
  enableDraftRecovery: boolean;
  /** Closing a window with unsaved changes keeps them as drafts for the next
   *  launch instead of asking. Needs enableDraftRecovery. */
  keepUnsavedOnClose: boolean;
  /** Closing the last window leaves the process running with a tray icon.
   *  Desktop only; Rust reads it. */
  runInBackground: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  // The defaults Rust reads too.
  ...(BACKEND_DEFAULTS as Pick<Settings, keyof typeof BACKEND_DEFAULTS>),
  language: "en",
  languageChosen: false,
  theme: "system",
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
  writingProvider: "",
  writingModels: {},
  agentModels: {},
  chatAgent: "",
  revisionDisplay: "final",
  completionTone: "default",
  writingConventions: "automatic",
  aiChangeMode: "revision",
  imageModelProvider: "chat",
  imageModel: "",
  imagesPerRequest: 2,
  imageModelEndpoint: "",
  searchService: "auto",
  searxngUrl: "",
  sourcesAsFootnotes: false,
  researchSubHelpers: false,
  researchCheckClaims: false,
  mcpServers: [],
  plugins: {},
  pinAgentWindow: false,
  agentWorkspaceRoot: "",
  proxyType: "none",
  proxyHost: "",
  proxyPort: "",
  typewriterMode: false,
  formatBar: true,
  formatBarOnce: true,
  zoomTogether: false,
  viewMode: "rich",
  zenMode: false,
  contentWidth: "auto",
  firstLineIndent: false,
  emptyLineHint: false,
  imageAlign: "center",
  menuBarShown: false,
  activityRail: true,
  layout: "islands",
  activityRailHidden: [],
  activityRailPinned: [],
  activityRailOrder: [],
  embedDisplay: "expand",
  autoCloseMarks: true,
  autoCloseBrackets: true,
  plainTextMenu: false,
  customCss: "",
  zoom: 1,
  uiTextScale: 1,
  docTextSize: "auto",
  docLineSpacing: "auto",
  docFont: "",
  docLetterSpacing: "auto",
  docLetterSpacingBy: 1,
  shortcuts: DEFAULT_SHORTCUTS,
  commandShortcuts: {},
  themeId: "default",
  userThemes: [],
  creations: [],
  startPageOnLaunch: false,
  closeLastToStartPage: false,
  autoSuggestFilename: true,
  autosave: false,
  pdfPageNumbers: false,
  pdfLightColors: false,
  docxReferenceDoc: "",
  exportToc: false,
  exportNumberHeadings: false,
  exportBibliography: "",
  exportCsl: "",
  pandocArgs: {},
  updateChannel: "stable",
  onboardingShown: false,
  enableChatHistory: true,
  enableDraftRecovery: true,
  keepUnsavedOnClose: false,
};

/** The provider writing assistance uses: its own, else the chat's. */
export function writingProviderOf(
  settings: Pick<Settings, "writingProvider" | "aiProvider">,
): string {
  return settings.writingProvider || settings.aiProvider;
}
