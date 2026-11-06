import { useCallback } from "react";
import { showNotice } from "../ui/notices";

/** What the editor says about an AI trigger that can't go ahead: a note at
 *  the bottom that goes by itself (the one NoticeHost), never alert(). */
export function useAiNotice() {
  const showAiNotice = useCallback((message: string | null) => {
    if (message) showNotice(message);
  }, []);
  return { showAiNotice };
}
