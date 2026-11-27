import { useEffect, useState } from "react";
import { androidBridge } from "../platform/android-bridge";
import { isIOSApp } from "../platform/capabilities";
import {
  UI_SYSTEM_SIZES,
  UI_TEXT_SCALES,
  type UiTextScale,
} from "../prefs/settings-values";

/** The step a system text size reaches: the first whose bound it is within,
 *  past the last bound the last step. The boot script reads the same
 *  table (src-tauri/src/boot.js). */
export function stepFor(size: number, bounds: readonly number[]): UiTextScale {
  const at = bounds.findIndex((bound) => size <= bound);
  return UI_TEXT_SCALES[at < 0 ? bounds.length : at];
}

/** iOS's body text now (Settings › Display & Brightness › Text Size), as
 *  WebKit resolves the system's body style: 17 by default. */
function iosBodySize(): number {
  const probe = document.createElement("span");
  probe.style.font = "-apple-system-body";
  document.documentElement.append(probe);
  const size = Number.parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return size;
}

/** The Interface Size the system's text size picks, or null where there is
 *  none to follow (a desktop). */
export function systemUiScale(): UiTextScale | null {
  const android = androidBridge();
  if (android) return stepFor(android.fontScale(), UI_SYSTEM_SIZES.android);
  if (!isIOSApp) return null;
  const size = iosBodySize();
  return size > 0 ? stepFor(size, UI_SYSTEM_SIZES.ios) : null;
}

/** systemUiScale(), read again whenever the system's may have changed: on
 *  coming back to Textus (the size is changed in the system's Settings),
 *  and when Android says so. */
export function useSystemUiScale(): UiTextScale | null {
  const [scale, setScale] = useState(systemUiScale);
  const follows = scale !== null;
  useEffect(() => {
    if (!follows) return;
    const read = () => {
      if (document.visibilityState === "visible") setScale(systemUiScale());
    };
    document.addEventListener("visibilitychange", read);
    window.addEventListener("textus-font-scale", read);
    return () => {
      document.removeEventListener("visibilitychange", read);
      window.removeEventListener("textus-font-scale", read);
    };
  }, [follows]);
  return scale;
}
