import { useEffect } from "react";
import { setWindowTitle } from "../platform/this-window";
import { canUseWindows } from "../platform/capabilities";

/** The OS title names the document, for the taskbar, Alt+Tab and window lists. */
export function useWindowTitle(activeTitle: string): void {
  useEffect(() => {
    if (!canUseWindows) return;
    void setWindowTitle(`${activeTitle} - Textus`).catch(() => {});
  }, [activeTitle]);
}
