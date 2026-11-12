import { onAppearance } from "../tokens/appearance";
import { chromeScale } from "../tokens/chrome-scale";
import { useSyncExternalStore } from "react";

/** `--chrome-scale` now, for sizes set from script; follows Interface Text
 *  Size. */
export function useChromeScale(): number {
  return useSyncExternalStore(onAppearance, () =>
    typeof window === "undefined" ? 1 : chromeScale(),
  );
}
