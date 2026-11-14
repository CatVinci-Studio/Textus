import { useSyncExternalStore } from "react";
import { isPhoneLayout, onPhoneLayout } from "../../platform/phone-layout";

/** Whether surfaces take the phone's form (platform/phone-layout.ts). */
export function usePhoneLayout(): boolean {
  return useSyncExternalStore(onPhoneLayout, isPhoneLayout, () => false);
}
