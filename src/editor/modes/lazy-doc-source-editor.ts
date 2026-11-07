import { lazyComponent } from "../../lazy/lazy-component";
import { lazyModule } from "../../lazy/lazy-module";

/** A document's source (CodeMirror, with picture paste): not in the
 *  window's startup chunk, but fetched once the window is idle, so the first
 *  switch to source mode doesn't show an empty pane. */
export const DocSourceEditor = lazyComponent(
  lazyModule("doc-source-editor", () => import("./DocSourceEditor"), {
    warm: true,
  }),
  (m) => m.DocSourceEditor,
);
