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

/**
 * On-demand AI triggers (menu items / keyboard shortcuts), as opposed to
 * the passive typing-driven runs the ghost-text and grammar plugins do on
 * their own. `getSettings` is a getter, not a value, so the actions built
 * once here always use the provider currently selected in settings.
 * Failures (including benign ones like "no issues found") go to `onNotice`
 * as a plain message - never a blocking dialog, these fire mid-typing.
 */
export function useAiActions(
  run: EditorRunner,
  getSettings: () => Settings,
  getT: () => Strings,
  onNotice: (message: string | null) => void,
  getDocPath: () => string | null = () => null,
): AiActions {
  // A manual trigger can take a few seconds: say it's working, then either
  // clear that (the result is in the document) or replace it with what
  // happened, in the user's language.
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
