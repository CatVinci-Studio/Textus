import type { MilkdownPlugin } from "@milkdown/kit/ctx";
import type { Settings } from "../prefs/SettingsContext";

/** What the editor's stages read as they are put together: live refs, and
 *  how a plugin is left out of a read-only preview. */
export interface CoreEnv {
  settings: { readonly current: Settings };
  docPath: { readonly current: string | null };
  editing: (
    plugin: MilkdownPlugin | MilkdownPlugin[],
  ) => MilkdownPlugin | MilkdownPlugin[];
  /** A disk behind the page: undo files, link clicks and hovers. */
  disk: boolean;
  images: MilkdownPlugin;
}
