import SEARCH_SERVICE_LIST from "./search-services.json";
import type { Backend } from "../platform/bindings/ai";
import type { ImageHost } from "../platform/bindings/files";
import TABLES from "./appearance-tables.json";
import type { AgentMode_Serialize as AgentMode } from "../platform/bindings/ai-skills";
/** Each setting's possible values: the modes, sizes, services and kinds a
 *  setting chooses among, with the lists Settings offers. */

/// Light/dark, orthogonal to `themeId`: every theme defines both forms, so
/// the two axes always compose.
export type ThemeMode = "system" | "light" | "dark";
/// A provider catalog id ("openai", "anthropic", "custom", ...). Not a closed
/// union: the catalog, fetched at runtime, decides which exist.
export type AiProvider = string;
/** How wide the text column runs: "auto" widens with the window, "standard"
 *  keeps the classic fixed measure, "full" uses the whole pane. */
export type ContentWidth = "auto" | "standard" | "full";
export type ImageAlign = "center" | "left";
/** How an ![[embed]] of a note shows: its content, or a card to open it by. */
export type EmbedDisplay = "expand" | "card";
/** How every document shows: the rich editor, its Markdown source, or the
 *  source beside a preview. One for all windows. */
export type ViewMode = "rich" | "source" | "split";
/** Where requests go: the system's proxy, straight out, or a proxy set
 *  here. Before 1.4.5 "none" was the default; it reads as "system". */
export type ProxyType = "system" | "direct" | "http" | "https" | "socks5";
export const PROXY_TYPES: ProxyType[] = [
  "system",
  "direct",
  "http",
  "https",
  "socks5",
];
/** The paper a PDF export prints on. */
export type PdfPaper = "a4" | "letter" | "a5";
export const PDF_PAPERS: PdfPaper[] = ["a4", "letter", "a5"];
/** The band left around a PDF's text. */
export type PdfMargin = "narrow" | "normal" | "wide";
export const PDF_MARGINS: PdfMargin[] = ["narrow", "normal", "wide"];
/** A PDF's text size, as a factor on the document's. */
export type PdfTextScale = 0.85 | 1 | 1.15 | 1.3;
export const PDF_TEXT_SCALES: PdfTextScale[] = [0.85, 1, 1.15, 1.3];
/** Which edge of a document the format bar sits on (not on a phone). */
export type FormatBarSide = "top" | "left" | "right";

export const THEME_MODES: ThemeMode[] = ["system", "light", "dark"];

/// Interface Size, as a factor on the UI's type scale.
export type UiTextScale = 0.85 | 1 | 1.25 | 1.5 | 1.75;
/** One table with the boot script's (appearance-tables.json). Extra Large
 *  and Largest are a touch screen's (iOS and Android), for the system's
 *  larger text; a desktop offers the first three. */
export const UI_TEXT_SCALES = TABLES.uiTextScales as readonly UiTextScale[];
/** Large: the last step a desktop offers, where the bars and the
 *  document's margins stop growing (ui-sizes.css's --margin-scale) and past
 *  which an upright tablet takes the phone's layout. */
export const UI_LARGE: UiTextScale = 1.25;
export const DESKTOP_UI_TEXT_SCALES = UI_TEXT_SCALES.filter(
  (scale) => scale <= UI_LARGE,
);
/** The system's text size each step reaches up to: iOS's body text in pt,
 *  Android's font scale. Past the last bound, the last step. */
export const UI_SYSTEM_SIZES = TABLES.uiSystemSizes as {
  ios: readonly number[];
  android: readonly number[];
};
/** Each step's preset in ui-sizes.css, by place in UI_TEXT_SCALES. */
export const UI_SIZE_NAMES = TABLES.uiSizeNames as readonly string[];
/** A step no longer offered, and the one it now reads as. */
export const UI_TEXT_SCALES_BEFORE = TABLES.uiTextScalesBefore as Record<
  string,
  UiTextScale
>;
/** The document's text size in px, or "auto" for the theme's own. */
export const DOC_TEXT_SIZES = [
  "auto",
  12,
  13,
  14,
  15,
  16,
  17,
  18,
  19,
  20,
  21,
  22,
  23,
  24,
  25,
  26,
  27,
  28,
] as const;
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
> = TABLES.docLineHeights;

/** Character spacing as Word sets it: the theme's, normal, or expanded or
 *  condensed by `docLetterSpacingBy` points. */
export const DOC_LETTER_SPACINGS = [
  "auto",
  "normal",
  "expanded",
  "condensed",
] as const;
export type DocLetterSpacing = (typeof DOC_LETTER_SPACINGS)[number];
/** The points expanded or condensed by: Word's range and step. */
export const LETTER_SPACING_BY = { min: 0.1, max: 10, step: 0.1 } as const;

/// Mermaid is the default and every diagram's fallback; Pele draws the same
/// syntax faster, in its own layout, and only by the user's choice.
export const DIAGRAM_ENGINES = ["mermaid", "pele"] as const;
export type DiagramEngine = (typeof DIAGRAM_ENGINES)[number];

/// Colour swatches: none; in code (inline code and code-block literals);
/// everywhere (that and colour codes in the text).
/** The formats Settings › Advanced takes Pandoc arguments for: Pandoc's
 *  writer names, with "all" for every Pandoc export. */
export const PANDOC_ARGS_FORMATS = [
  "all",
  "docx",
  "latex",
  "epub",
  "odt",
] as const;
export type PandocArgsFormat = (typeof PANDOC_ARGS_FORMATS)[number];

export const COLOR_SWATCH_MODES = ["off", "code", "everywhere"] as const;
/** What one tilde each side, `~text~`, means: GitHub strikes it out,
 *  Pandoc and Typora read `H~2~O` as a subscript; `~~text~~` always
 *  strikes out. */
export const SINGLE_TILDE_MODES = [
  "subscript",
  "strikethrough",
  "text",
] as const;
export type SingleTildeMode = (typeof SINGLE_TILDE_MODES)[number];
/** What one newline inside a paragraph is: CommonMark and Pandoc join the
 *  lines, GitHub's comments and Obsidian break the line. */
export const SINGLE_NEWLINE_MODES = ["join", "break"] as const;
export type SingleNewlineMode = (typeof SINGLE_NEWLINE_MODES)[number];
export type ColorSwatchMode = (typeof COLOR_SWATCH_MODES)[number];

/// In the order the menus list them, the default first.
export const REVISION_DISPLAYS = ["final", "original", "inline"] as const;
/** How Textus AI's changes land: as revisions to review (the open document
 *  and the folder's other files alike), or written straight in. */
export const AI_CHANGE_MODES = ["revision", "direct"] as const;
export type AiChangeMode = (typeof AI_CHANGE_MODES)[number];
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
/// "auto" takes the first saved key of those search-services.json marks.
export type SearchService = "auto" | Backend;

export const SEARCH_SERVICES: SearchService[] = [
  "auto",
  ...SEARCH_SERVICE_LIST.map((service) => service.id as Backend),
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
  /// Made in the theme workshop here: it may be saved over from there.
  workshop?: boolean;
}

/** What Textus AI made and the user installed from a reply's card: a
 *  plugin (its manifest id), a user theme (its `UserThemeMeta.id`) or a
 *  global skill (its name). Each still lives in its own store; this only
 *  remembers which of them came from Create, for its "Made here" list. */
export interface Creation {
  kind: CreationKind;
  id: string;
  name: string;
  /** When it was last installed or updated, in ms. */
  at: number;
}

export type CreationKind = "plugin" | "theme" | "skill";
export const CREATION_KINDS: readonly CreationKind[] = [
  "plugin",
  "theme",
  "skill",
];

interface GalleryOrigin {
  id: string;
  /// The installed copy's `GalleryTheme.updated`.
  updated: string;
  source: string;
}

export type ImageStorageMode = "local" | "image-host";
export type { ImageHost };
export const IMAGE_HOSTS: ImageHost[] = ["picgo", "smms", "imgur", "custom"];
export type ImageNamingMode = "auto" | "original" | "ask";
/** The AI conversation's mode: Write adds and changes text, Review only
 *  reads and comments, Create makes a theme, plugin or skill. In composer order. */
export type { AgentMode };
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
