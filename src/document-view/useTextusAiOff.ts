import { useEffect } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import type { EditorRunner } from "../editor/useEditorRunner";
import { dismissGhostText } from "../ai/writing/ghost-text-plugin";
import { clearGrammarIssues } from "../ai/writing/grammar-check-plugin";

/** Textus AI turned off: completion, grammar underlines and Quick Ask go
 *  with it. Revisions already proposed stay, to decide as before. */
export function useTextusAiOff(
  run: EditorRunner,
  aiOn: boolean,
  hide: { quickAsk: () => void; grammarCard: () => void },
): void {
  const { quickAsk, grammarCard } = hide;
  useEffect(() => {
    if (aiOn) return;
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      dismissGhostText(view);
      clearGrammarIssues(view);
    });
    quickAsk();
    grammarCard();
  }, [aiOn, run, quickAsk, grammarCard]);
}
