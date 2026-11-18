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
 *  views, providers, links - taken away. */
export function forgetPlugin(id: string): void {
  stopPluginUi(id);
  stopPluginEditor(id);
  stopPluginHistory(id);
  stopPluginAi(id);
  stopPluginExport(id);
  stopPluginDatabaseViews(id);
  stopPluginConventionReaders(id);
  stopPluginProviders(id);
  stopPluginSsh(id);
  forgetListViews(id);
  forgetEmbeds(id);
  forgetWillSave(id);
  forgetWillExport(id);
  unwatchMetadata(id);
  forgetPluginColors(id);
}
