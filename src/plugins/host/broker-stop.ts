import { stopPluginAi } from "./broker-ai";
import { stopPluginExport } from "./broker-export";
import { stopPluginDatabaseViews } from "./broker-database-views";
import { stopPluginProviders } from "./broker-providers";
import { stopPluginSsh } from "./broker-ssh";
import { stopPluginEditor } from "./broker-editor";
import { stopPluginHistory } from "./broker-history";
import { stopPluginUi } from "./broker-ui";
import { stopPluginConventionReaders } from "../contributions/convention-readers";
import { forgetListViews } from "../contributions/list-views";
import { forgetEmbeds } from "../contributions/embeds";
import { forgetWillExport } from "../contributions/will-export";
import { forgetWillSave } from "../contributions/will-save";
import { unwatchMetadata } from "../workspace/metadata-cache";
import { forgetPluginColors } from "../../theme/plugin-colors";

/** Everything a stopped plugin left in the window - its UI, editor hooks,
 *  views, providers, links - taken away, in this order. */
export const PLUGIN_STOPS: readonly ((plugin: string) => void)[] = [
  stopPluginUi,
  stopPluginEditor,
  stopPluginHistory,
  stopPluginAi,
  stopPluginExport,
  stopPluginDatabaseViews,
  stopPluginConventionReaders,
  stopPluginProviders,
  stopPluginSsh,
  forgetListViews,
  forgetEmbeds,
  forgetWillSave,
  forgetWillExport,
  unwatchMetadata,
  forgetPluginColors,
];

export function forgetPlugin(id: string): void {
  for (const stop of PLUGIN_STOPS) stop(id);
}
