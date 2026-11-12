import { useEffect } from "react";
import { emitPluginEvent } from "./app-bridge";

/** Which of the window's panels are open, as plugins hear it. A new panel
 *  is a new key; Zen mode closes them all. */
export interface PanelsState {
  sidebar: { open: boolean; tab: string };
  ai: { open: boolean };
}

let current: PanelsState = {
  sidebar: { open: false, tab: "" },
  ai: { open: false },
};

export function panelsState(): PanelsState {
  return current;
}

function reportPanels(next: PanelsState): void {
  if (JSON.stringify(next) === JSON.stringify(current)) return;
  current = next;
  emitPluginEvent("panels", next);
}

/** The window tells plugins of each change to its panels. */
export function usePanelsReport({
  sidebarOpen,
  sidebarTab,
  aiOpen,
  zen,
}: {
  sidebarOpen: boolean;
  sidebarTab: string;
  aiOpen: boolean;
  zen: boolean;
}): void {
  useEffect(
    () =>
      reportPanels({
        sidebar: { open: sidebarOpen && !zen, tab: sidebarTab },
        ai: { open: aiOpen && !zen },
      }),
    [sidebarOpen, sidebarTab, aiOpen, zen],
  );
}
