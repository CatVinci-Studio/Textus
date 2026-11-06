import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";

/** A document's source (CodeMirror, with picture paste), loaded with the
 *  first source-mode tab rather than in the window's startup chunk. */
export const DocSourceEditor = lazyComponent(
  lazyModule("doc-source-editor", () => import("./DocSourceEditor")),
  (m) => m.DocSourceEditor,
);
