import { useCallback, useEffect, useRef, useState } from "react";

/** Self-dismissing notice for on-demand AI triggers. Not alert(): that
 *  blocks the whole webview over often benign messages. */
export function useAiNotice() {
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const noticeTimer = useRef<number | undefined>(undefined);
  // When it goes, so a pointer resting on it can hold it.
  const noticeDeadline = useRef(0);
  const showAiNotice = useCallback((message: string | null) => {
    setAiNotice(message);
    window.clearTimeout(noticeTimer.current);
    if (!message) return;
    noticeDeadline.current = Date.now() + 4000;
    noticeTimer.current = window.setTimeout(() => setAiNotice(null), 4000);
  }, []);
  useEffect(() => () => window.clearTimeout(noticeTimer.current), []);
  const holdAiNotice = () => window.clearTimeout(noticeTimer.current);
  const releaseAiNotice = () => {
    const left = Math.max(1500, noticeDeadline.current - Date.now());
    noticeDeadline.current = Date.now() + left;
    noticeTimer.current = window.setTimeout(() => setAiNotice(null), left);
  };
  return { aiNotice, showAiNotice, holdAiNotice, releaseAiNotice };
}
