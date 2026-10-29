import type { Strings } from "../../i18n/strings";
import type { FixedShortcutGroup } from "../../app/fixed-shortcuts";
import type { Settings, useSettings } from "../../prefs/SettingsContext";

/** A page's own page within its category (General › About Textus; on the
 *  phone, Editor & Appearance › More themes). */
/** What Help opens as a document (or, the welcome, as the tour). */
export type HelpGuide = "welcome" | "markdown" | "agent";

export type Subpage = "about" | "guides" | "themes";

/** A plugin's command, for Settings › Shortcuts: its own key, if any. */
export interface ShortcutCommand {
  id: string;
  title: string;
  shortcut?: string;
}

export interface SettingsPageProps {
  t: Strings;
  settings: Settings;
  setSettings: ReturnType<typeof useSettings>["setSettings"];
  /** The iPhone's layout. */
  phone: boolean;
  /** "125 %" in French, "125%" in English. */
  percent: Intl.NumberFormat;
  /** Whether the window has room for the AI's margin. */
  marginAvailable: boolean;
  /** The desktop without that room: the margin's rows say so. */
  noMargin: boolean;
  setSubpage: (subpage: Subpage) => void;
  /** Goes to another page of Settings (Textus AI's Skills row to
   *  Extensions). */
  openPage: (id: string) => void;
  /** Opens a guide as a document, closing Settings first. */
  openHelp: (doc: HelpGuide) => void;
  /** Opens a document in the editor. */
  onOpenFile: (path: string) => void;
  /** Closes Settings (a page whose action opens something behind it). */
  onClose: () => void;
  /** Files a settings action deleted, for the editor to close their tabs. */
  onFilesDeleted?: (paths: string[]) => void;
  /** The shortcuts that can't be changed. */
  fixedShortcuts: FixedShortcutGroup[];
  /** The commands plugins add, whose keys can be set. */
  pluginCommands: ShortcutCommand[];
  /** Rendered for the settings search to read, not to be shown: a page
   *  with tabs leaves them out, as the search reads each on its own. */
  indexing?: boolean;
}
