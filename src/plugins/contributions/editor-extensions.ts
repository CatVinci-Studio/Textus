import { setEditorExtensions } from "../../editor/extension-points";
import { editorInputPlugin } from "./editor-input";
import { hasHoverProviders, provideHover } from "./hover-providers";
import { hasCompletionSources, provideCompletions } from "./completion-sources";
import { openLinkInPlugin } from "./link-handlers";

// What plugins add to the editor, registered as the plugin system loads -
// before any editor is made.
setEditorExtensions({
  keyInput: [editorInputPlugin],
  hasHoverProviders,
  provideHover,
  hasCompletionSources,
  provideCompletions,
  openLink: openLinkInPlugin,
});
