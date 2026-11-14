import {
  setEditorExtensions,
  setPluginCompletionSources,
} from "../../editor/extension-points";
import { editorInputPlugin } from "./editor-input";
import { hasHoverProviders, provideHover } from "./hover-providers";
import { pluginCompletionSources } from "./completion-sources";
import { openLinkInPlugin } from "./link-handlers";
import { pasteMatches, providePaste } from "./paste-handlers";
// The / commands register their source as they load.
import "./slash-commands";

// What plugins add to the editor, registered as the plugin system loads -
// before any editor is made.
setEditorExtensions({
  keyInput: [editorInputPlugin],
  hasHoverProviders,
  provideHover,
  openLink: openLinkInPlugin,
  pasteMatches,
  providePaste,
});
setPluginCompletionSources(pluginCompletionSources);
