import type { VerbatimRules } from "../../editor/markdown/verbatim-rules";
import type { Permission, PluginPlatform } from "./manifest";

// What a plugin's manifest holds once read (manifest.ts reads and checks
// it): its contributions and the manifest itself.

interface CommandContribution {
  command: string;
  title: string;
  /** Runs one of Textus's commands with these arguments, at once and with
   *  no code of the plugin's: what a / item or a key must do before the
   *  next key comes. */
  runs?: { command: string; args: unknown[] };
}

interface KeybindingContribution {
  command: string;
  /** As Settings writes combos: "mod+shift+k". */
  key: string;
}

/** Where a command is listed: the editor's context menu, a file's or tab's
 *  (given its path), a view's title buttons, a floating view's right-click
 *  menu, the Plugins menu, or the tray menu (with no window open, which it
 *  opens first). */
export type MenuId =
  | "editor/context"
  | "editor/slash"
  | "file/context"
  | "tab/context"
  | "view/title"
  | "floating/context"
  | "app/plugins"
  | "app/tray";

/** A Textus setting a plugin needs on to do all it does. */
export type RequiredSetting = "runInBackground";
export const REQUIRED_SETTINGS: readonly RequiredSetting[] = [
  "runInBackground",
];

export interface Requirement {
  setting: RequiredSetting;
  /** Why, in the plugin's words: "%needsBackground%". */
  reason?: string;
}

export interface MenuContribution {
  command: string;
  /** "editorHasSelection", "fileExtension == .pdf". */
  when?: string;
  /** For "view/title": an icon (one of the app's, or an SVG of the
   *  plugin's) in place of the title. */
  icon?: string;
}

/** A view is drawn by Textus from the plugin's items, or is a page of the
 *  plugin's own. */
export type ViewType = "list" | "webview";

interface SidebarTabContribution {
  id: string;
  title: string;
  type: ViewType;
  /** An SVG in the plugin's folder, drawn in the current text colour. */
  icon?: string;
}

/** A view the plugin opens in a tab of its own. */
interface ViewContribution {
  id: string;
  title: string;
  type: ViewType;
}

/** Code blocks of a language the plugin draws in the document: ```tasks. */
interface CodeBlockContribution {
  language: string;
  /** What the block is called where Textus names it ("Task query"). */
  title?: string;
  /** "none": the block sits on the page without the box drawn round a
   *  figure - for one that reads as part of the document, such as a table. */
  frame?: "none";
  /** "interface": drawn at the interface's text size, not the document's
   *  and its zoom - an overview (a table, a board) that shows more as the
   *  column widens rather than growing with the text. */
  size?: "interface";
}

/** A file type the plugin opens in a tab. */
interface CustomEditorContribution {
  viewType: string;
  displayName: string;
  /** Glob-like file name patterns: "*.pdf", "*.kanban.md". */
  filenamePatterns: string[];
  /** Front matter keys that make a Markdown document the plugin's: a .md
   *  whose front matter has one ("kanban-plugin: board") opens in it. */
  frontMatter: string[];
  /** "default" opens matching files in it; "option" only offers it in
   *  the file's Open With. */
  priority: "default" | "option";
}

/** Files opened as documents in the editor (from 1.4.3): Quarto's .qmd,
 *  R Markdown's .Rmd. `keep`: what of their syntax stays as written. */
/** Markdown the `/` menu puts in at the caret. */
export interface SnippetContribution {
  label: string;
  /** `$0` marks where the caret lands. */
  body: string;
  keywords?: string;
}

/** Steps for after it is installed, on its page in Settings. */
export interface WalkthroughContribution {
  title: string;
  steps: { title: string; description: string; command?: string }[];
}

export interface DocumentTypeContribution {
  extensions: string[];
  keep: VerbatimRules | null;
}

/** A folder with this extension opened as one document: the first of
 *  `documents` found in it (`.textbundle` and its `text.md`). */
export interface FolderDocumentContribution {
  extension: string;
  documents: string[];
}

/** A code language coloured from a grammar file of the plugin's
 *  (editor/code/code-grammar.ts), named in a fence by its id or an alias. */
export interface CodeLanguageContribution {
  id: string;
  aliases: string[];
  /** The grammar's JSON file, inside the plugin. */
  path: string;
}

/** A set of icons for the files and folders listed, by name and extension,
 *  picked in Settings › Appearance. `path` is its JSON in the plugin. */
export interface FileIconThemeContribution {
  id: string;
  label: string;
  path: string;
}

export type SettingType =
  "boolean" | "string" | "number" | "enum" | "color" | "list" | "button";

export interface SettingContribution {
  key: string;
  type: SettingType;
  /** None for a "button"; a "#rrggbb" for a "color", strings for a "list". */
  default?: boolean | string | number | string[];
  title: string;
  description?: string;
  /** A heading the setting goes under; the ones after it share it until
   *  another is named. */
  group?: string;
  /** Shown only while another setting is so: "legend", "!legend",
   *  "style == dark", "style != dark". */
  when?: string;
  /** For "enum": the values, and what each is called. */
  options?: { value: string; label: string }[];
  /** For "string": several lines, in a box under its title. */
  multiline?: boolean;
  /** For "number": the least and most it takes. */
  min?: number;
  max?: number;
  /** For "button": the command it runs. */
  command?: string;
}

/** A tool the plugin gives Textus AI: what the model is told and its
 *  arguments as a JSON schema. */
interface AiToolContribution {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Where a plugin suggests completions as you type: in a formula, the text or
 *  both, once the words before the caret match `pattern` (anchored there). */
export interface CompletionContribution {
  id: string;
  where: "math" | "text" | "any";
  /** Anchored at the caret; its last capture group is the query. */
  pattern: string;
  /** The panel group's heading ("%notes%"); the plugin's name without it. */
  title?: string;
}

/** A status in the window bar shown from the manifest, before the plugin's
 *  code starts; its code's ui.statusItem with the same id takes it over. */
interface StatusItemContribution {
  id: string;
  text: string;
  tooltip?: string;
  /** One of its contributes.commands, run (starting the plugin) on click. */
  command?: string;
}

/** Links a plugin opens on Ctrl/Cmd+click instead of the browser: a URL
 *  matching `pattern` runs its `command` with the URL. */
interface LinkContribution {
  pattern: string;
  command: string;
}

/** Where a floating view may be: on the desktop, over every window, in
 *  Textus's window, or either, as the user picks. */
export type FloatingPlace = "desktop" | "window" | "either";

/** A small page of the plugin's that floats - a desk pet, a timer, a
 *  teleprompter - shown only when the user turns it on, moved where they
 *  like. `width` and `height` are its size in points. */
export interface FloatingViewContribution {
  id: string;
  title: string;
  width: number;
  height: number;
  place: FloatingPlace;
}

/** What a document can hold that a plugin works with, so Textus suggests it
 *  for a document that does: [[wikilinks]]. */
export type SuggestKind = "wikilinks";

/** What `![[...]]` embeds point at. */
export type EmbedKind = "note" | "heading" | "block";

/** `![[...]]` embeds whose content the plugin gives as Markdown; Textus
 *  draws it, read-only. Needs files.read. */
interface EmbedContribution {
  id: string;
  targets: EmbedKind[];
}

/** The hover cards a plugin gives. */
export type HoverContribution = "document" | "link" | "citation";

/** An AI agent on the user's computer that Textus AI's panel can talk to
 *  (Agent Client Protocol over stdio): Claude Code, Codex… Needs `agents`.
 *  `{pluginDir}` in `args` and `env` is the plugin's own folder. */
interface AgentContribution {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** How to install it and sign in, shown when it can't start. */
  setup?: string;
  /** The provider whose models it runs ("anthropic", "openai"), told to
   *  plugins as the AI at work. */
  provider?: string;
  /** Its mode that asks before each change, where its names don't say. */
  askMode?: string;
  /** The sign-in method Textus may run for it when it asks for one; ""
   *  for none (its setup says how). Unset: one it runs itself. */
  signIn?: string;
}

export interface Contributes {
  commands: CommandContribution[];
  keybindings: KeybindingContribution[];
  menus: Partial<Record<MenuId, MenuContribution[]>>;
  sidebarTabs: SidebarTabContribution[];
  views: ViewContribution[];
  customEditors: CustomEditorContribution[];
  documentTypes: DocumentTypeContribution[];
  folderDocuments: FolderDocumentContribution[];
  fileIconThemes: FileIconThemeContribution[];
  settings: SettingContribution[];
  /** A page of its own in Settings, a webview. */
  settingsPage: { title: string } | null;
  aiTools: AiToolContribution[];
  completions: CompletionContribution[];
  embeds: EmbedContribution[];
  hovers: HoverContribution[];
  links: LinkContribution[];
  statusItems: StatusItemContribution[];
  codeBlocks: CodeBlockContribution[];
  codeLanguages: CodeLanguageContribution[];
  floatingViews: FloatingViewContribution[];
  agents: AgentContribution[];
  /** Suggested, once, for a document with these. */
  suggestFor: SuggestKind[];
  /** The `/` menu lists Textus's own blocks while this plugin is on. */
  blockMenu: boolean;
  snippets: SnippetContribution[];
  walkthroughs: WalkthroughContribution[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  publisher: string;
  /** Who made it, as a name to show ("CatVinci Studio"); the publisher
   *  id where there is none. */
  author?: string;
  description: string;
  icon?: string;
  license?: string;
  repository?: string;
  /** The Textus versions it works with: "^1.2.0", ">=1.2.0". */
  engine: string;
  /** Where it runs. Unset, everywhere, unless it works in the background
   *  (background code, or requiring runInBackground): the desktop's only. */
  platforms: readonly PluginPlatform[];
  /** Its code, run in the plugin host; none for a plugin that only
   *  declares (a command running another, an agent). */
  main?: string[];
  /** Code its scheduled jobs run, apart from `main` and without the editor
   *  or UI; it runs only with the background permission granted. */
  background?: string;
  activationEvents: string[];
  permissions: Permission[];
  requires: Requirement[];
  contributes: Contributes;
  /** `%key%` strings, by language. */
  l10n: Record<string, Record<string, string>>;
}
