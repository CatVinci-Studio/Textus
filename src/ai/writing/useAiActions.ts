import { useCallback } from "react";
import { editorViewCtx } from "@milkdown/kit/core";
import { triggerGhostTextNow } from "./ghost-text-plugin";
import { triggerGrammarCheckNow } from "./grammar-check-plugin";
import { buildCompletionStyle } from "./completion-style";
import type { EditorRunner } from "../../editor/useEditorRunner";
import type { Settings } from "../../settings/SettingsContext";
import type { Strings, TextKey } from "../../i18n/strings";
import {
  AiNoticeError,
  errorText,
  type AiNoticeCode,
} from "../../utils/error-text";

const NOTICE_TEXT: Record<AiNoticeCode, TextKey> = {
  "completion-needs-caret": "noticeCompletionNeedsCaret",
  "completion-needs-paragraph-end": "noticeCompletionNeedsParagraphEnd",
  "completion-empty": "noticeCompletionEmpty",
  "grammar-needs-paragraph": "noticeGrammarNeedsParagraph",
  "grammar-empty-paragraph": "noticeGrammarEmpty",
  "grammar-paragraph-changed": "noticeGrammarChanged",
  "grammar-no-issues": "noticeGrammarNoIssues",
};

export interface AiActions {
  triggerCompletion: () => void;
  triggerGrammarCheck: () => void;
}

/** AI actions run from the menu or a shortcut. `getSettings` is a getter so
 *  they always use the current provider; failures go to `onNotice`, never a
 *  dialog, since these fire mid-typing. */
export function useAiActions(
  run: EditorRunner,
  getSettings: () => Settings,
  getT: () => Strings,
  onNotice: (message: string | null) => void,
  getDocPath: () => string | null = () => null,
): AiActions {
  // A manual trigger can take a few seconds: say it's working, then clear
  // that or replace it with what happened.
  const report = useCallback(
    (work: Promise<void>, working: string) => {
      onNotice(working);
      work.then(
        () => onNotice(null),
        (err) => {
          const t = getT();
          onNotice(
            err instanceof AiNoticeError
              ? (t[NOTICE_TEXT[err.code]] as string)
              : errorText(err),
          );
        },
      );
    },
    [getT, onNotice],
  );

  const triggerCompletion = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { aiProvider, completionTone, writingModels, language } =
        getSettings();
      const style = buildCompletionStyle(completionTone);
      report(
        triggerGhostTextNow(
          view,
          aiProvider,
          style,
          writingModels[aiProvider] || null,
          {
            docPath: getDocPath(),
            workspaceRoot: getSettings().agentWorkspaceRoot || null,
          },
          language,
        ),
        getT().aiWorkingCompletion,
      );
    });
  }, [run, getSettings, getT, report, getDocPath]);

  const triggerGrammarCheck = useCallback(() => {
    run((ctx) => {
      const view = ctx.get(editorViewCtx);
      const { aiProvider, grammarStrictness, writingModels } = getSettings();
      report(
        triggerGrammarCheckNow(
          view,
          aiProvider,
          grammarStrictness,
          writingModels[aiProvider] || null,
          {
            docPath: getDocPath(),
            workspaceRoot: getSettings().agentWorkspaceRoot || null,
          },
          getSettings().language,
        ),
        getT().aiWorkingGrammar,
      );
    });
  }, [run, getSettings, getT, report, getDocPath]);

  return { triggerCompletion, triggerGrammarCheck };
}
