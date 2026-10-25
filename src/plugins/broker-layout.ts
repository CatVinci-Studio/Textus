import { closeSplit, splitEditor, splitLayout } from "../app/split-layout";

/**
 * A plugin's calls about the window's layout: two documents side by side
 * or one over the other (app/split-layout.ts). The panes are the app's;
 * when they split is the plugin's. They need no permission - they show the
 * user's own tabs, nothing more.
 */
export function layoutHandlers() {
  return {
    "window.splitEditor": ({ direction }: { direction?: string }) => {
      if (
        direction !== undefined &&
        direction !== "row" &&
        direction !== "column"
      )
        throw new Error("direction is row or column.");
      splitEditor(direction ?? "row");
    },
    "window.closeSplit": () => closeSplit(),
    "window.layout": () => {
      const layout = splitLayout();
      return layout?.panes[1]
        ? { split: layout.direction, ratio: layout.ratio }
        : { split: null };
    },
  };
}
