import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";

/** CodeMirror and the Markdown parser arrive with the first source-mode tab,
 *  not in the window's startup chunk. */
export const SourceEditor = lazyComponent(
  lazyModule("source-editor", () => import("./SourceEditor")),
  (m) => m.SourceEditor,
);
