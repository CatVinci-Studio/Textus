import { useSyncExternalStore } from "react";
import { isPhoneLayout, onPhoneLayout } from "../../platform/phone-layout";

/** Whether surfaces take the phone's form (platform/phone-layout.ts). */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(onPhoneLayout, isPhoneLayout, () => false);
}

/** Where a phone's title row ends, the status bar above it included; 0
 *  where the window has none of its own. */
export function phoneTitleRowBottom(): number {
  if (document.documentElement.dataset.windowChrome !== "mobile") return 0;
  return (
    document.querySelector(".window-bar")?.getBoundingClientRect().bottom ?? 0
  );
}
