import type { Strings } from "../../i18n/strings";
import type { FixedShortcutGroup } from "../../app/fixed-shortcuts";
import type { MenuChecks } from "../../app/menu/app-menu-model";
import type { Settings, useSettings } from "../SettingsContext";

/** A page's own page within its category (General › About Textus; on the
 *  phone, Editor & Appearance › More themes). */
export type Subpage = "about" | "themes";

/**
 * What every Settings page is given (settings-pages.tsx): the settings and
 * their setter, the interface's strings, where the panel is shown, and the
 * panel's own ways out - a subpage, a guide, a file. A page takes the ones
 * it needs.
 */
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
  /** The iPhone's layout (ui/usePhoneLayout.ts). */
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
  openHelp: (doc: "markdown" | "agent") => void;
  /** Opens a document in the editor (the agent.md "edit" button). */
  onOpenFile: (path: string) => void;
  /** Closes Settings (a page whose action opens something behind it). */
  onClose: () => void;
  /** Files a settings action deleted, for the editor to close their tabs. */
  onFilesDeleted?: (paths: string[]) => void;
  /** Which of the window's view modes are on, for Editor › View. */
  viewChecks: Pick<MenuChecks, "sourceMode" | "zen">;
  /** The shortcuts that can't be changed (app/fixed-shortcuts.ts). */
  fixedShortcuts: FixedShortcutGroup[];
  /** The commands plugins add (app/commands.ts), whose keys can be set. */
  pluginCommands: ShortcutCommand[];
  /** Rendered for the settings search to read, not to be shown: a page
   *  with tabs leaves them out, as the search reads each on its own. */
  indexing?: boolean;
}
