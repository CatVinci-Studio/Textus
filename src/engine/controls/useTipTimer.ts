import { useEffect, useRef } from "react";

/** The timer a tip opens or closes after (Tooltip, InfoTip), cleared when
 *  the tip goes away so it never fires on an unmounted one. */
export function useTipTimer() {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return timer;
}
