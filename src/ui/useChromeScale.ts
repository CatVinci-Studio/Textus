import { chromeScaleAt } from "../engine/tokens/chrome-scale";
import { useSyncExternalStore } from "react";

/** `--chrome-scale` now, for sizes set from script; follows the window's
 *  width and Interface Text Size. */
export function useChromeScale(): number {
  return useSyncExternalStore(subscribe, () =>
    typeof window === "undefined" ? 1 : chromeScaleAt(window.innerWidth),
  );
}

function subscribe(changed: () => void): () => void {
  const watch = new MutationObserver(changed);
  watch.observe(document.documentElement, { attributeFilter: ["style"] });
  window.addEventListener("resize", changed);
  return () => {
    watch.disconnect();
    window.removeEventListener("resize", changed);
  };
}
