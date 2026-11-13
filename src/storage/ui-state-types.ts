/** The fields of the UI state (ui-state.ts), and what some of them hold. */
export interface UiState {
  /** The onboarding tour's step. */
  tutorialProgress: unknown;
  agentPanelOpen: boolean;
  /** The width a panel keeps (the AI's, Settings', a plugin page's;
   *  an iPad's docked AI), in Medium's pixels. */
  panelPx: number;
  /** The sidebar's width as last dragged, in Medium's pixels. */
  sidebarPx: number;
  /** Both as kept before 1.4.1, in the first design's pixels. */
  panelWidth: number;
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
