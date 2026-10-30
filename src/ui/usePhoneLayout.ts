import { useSyncExternalStore } from "react";
import { isIOSApp } from "../platform/capabilities";

/** The width at which the iPhone layout takes over: the sidebar becomes a
 *  drawer and Textus AI a bottom sheet. */
export const PHONE_QUERY = "(max-width: 760px)";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia?.(PHONE_QUERY);
  mq?.addEventListener("change", onChange);
  return () => mq?.removeEventListener("change", onChange);
}

/** Whether surfaces take their phone form now, outside React. */
export function isPhoneLayout(): boolean {
  return isIOSApp && (window.matchMedia?.(PHONE_QUERY).matches ?? false);
}

/** Whether surfaces should take their phone form. iOS at phone width only:
 *  an iPad keeps the desktop's popovers, and a narrow desktop window is still
 *  a desktop. */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(subscribe, isPhoneLayout, () => false);
}
