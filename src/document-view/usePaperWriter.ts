import { useCallback, useEffect, useRef } from "react";
import { ai } from "../platform/ipc";
import { errorText } from "../utils/error-text";
import { imageModelOf } from "../ai/image-models";
import type { useAgentPanel } from "../ai/chat/panel/agent-panel";
import type { AgentConversation } from "../ai/chat/useAgentConversation";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { Outline } from "../platform/bindings/ai-paper";
import {
  applyPaperEvent,
  paperCardTurns,
  paperLanguage,
  paperRun,
  paperWrittenTurns,
  setPaperActions,
  updatePaperRun,
} from "../ai/paper/paper-store";
import { withoutPictures } from "../ai/paper/paper-document";
import { usePaperDocument } from "./usePaperDocument";

/**
 * Research mode's paper: researches and outlines a paper on a topic, waits
 * on its card for the user to approve the outline, then writes it straight
 * into the document as it is drafted, with nothing to accept
 * (docs/design/ai-paper.md). Its progress lives in the paper store; the
 * conversation keeps its card.
 */
export function usePaperWriter({
  run,
  conversation,
  agentPanel,
  settings,
  filePath,
  t,
}: {
  run: EditorRunner;
  conversation: AgentConversation;
  agentPanel: ReturnType<typeof useAgentPanel>;
  settings: Settings;
  filePath: string | null;
  t: Strings;
}) {
  const paperDocument = usePaperDocument(run);
  // Read when a step starts, so a run picks up the settings of its moment.
  const latest = useRef({ settings, filePath, conversation, t, paperDocument });
  latest.current = { settings, filePath, conversation, t, paperDocument };
  // Each card's request in flight, to stop it.
  const requests = useRef(new Map<string, string>());

  /** What every paper command is sent with. */
  const common = () => {
    const { settings: s, filePath: docPath } = latest.current;
    return {
      provider: s.aiProvider,
      model: s.agentModels[s.aiProvider] || null,
      docPath,
      workspaceRoot: s.agentWorkspaceRoot || null,
      imageModel: imageModelOf(s),
    };
  };

  const fail = (key: string, err: unknown) => {
    requests.current.delete(key);
    // What was written stays, as text of the user's own.
    latest.current.paperDocument.settle(key);
    updatePaperRun(key, () => ({
      error: errorText(err),
      approving: false,
    }));
  };

  const approve = useCallback(
    (key: string, outline: Outline) => {
      const run = paperRun(key);
      if (!run?.paperId || run.approving) return;
      const id = run.paperId;
      const base = common();
      updatePaperRun(key, () => ({ approving: true, error: null }));
      const requestId = crypto.randomUUID();
      requests.current.set(key, requestId);
      void ai
        .paperSaveOutline(base.docPath, base.workspaceRoot, id, outline)
        .then((saved) => {
          updatePaperRun(key, () => ({ outline: saved }));
          latest.current.paperDocument.begin(key);
          return ai.paperDraft(
            {
              provider: base.provider,
              model: base.model,
              docPath: base.docPath,
              workspaceRoot: base.workspaceRoot,
              requestId,
              id,
              imageModel: base.imageModel,
            },
            (event) => {
              applyPaperEvent(key, event);
              if (event.type === "sectionText")
                latest.current.paperDocument.update(key);
              if (event.type !== "ready") return;
              latest.current.paperDocument.settle(
                key,
                withoutPictures(event.markdown),
              );
              latest.current.conversation.append(
                paperWrittenTurns(latest.current.t.paperWritten),
              );
              updatePaperRun(key, () => ({ written: true }));
            },
          );
        })
        .then(() => {
          requests.current.delete(key);
          // A run stopped while drafting ends without a paper: keep what
          // was written of it.
          latest.current.paperDocument.settle(key);
          updatePaperRun(key, () => ({ approving: false }));
        })
        .catch((err) => fail(key, err));
    },
    // `common` and `fail` read refs only.
    [],
  );

  const stop = useCallback((key: string) => {
    const requestId = requests.current.get(key);
    if (requestId) void ai.cancelAgentMessage(requestId);
  }, []);

  useEffect(() => {
    setPaperActions({ approve, stop });
    return () => setPaperActions(null);
  }, [approve, stop]);

  /** Starts a paper on `topic` of about `targetChars` characters. */
  return useCallback(
    (topic: string, targetChars: number) => {
      const { settings: s, t: strings } = latest.current;
      const key = crypto.randomUUID();
      const language = paperLanguage(topic, s.language);
      updatePaperRun(key, () => ({
        topic,
        unit: /^(zh|ja|ko)/.test(language)
          ? strings.paperUnitCharacters
          : strings.paperUnitWords,
      }));
      agentPanel.setOpen(true);
      latest.current.conversation.append(
        paperCardTurns(key, topic, strings.paperAsk.replace("{topic}", topic)),
      );
      const requestId = crypto.randomUUID();
      requests.current.set(key, requestId);
      void ai
        .paperRun(
          {
            ...common(),
            searchService: s.searchService,
            searxngUrl: s.searxngUrl || null,
            requestId,
            topic,
            language,
            targetChars,
          },
          (event) => applyPaperEvent(key, event),
        )
        .then((paper) => {
          requests.current.delete(key);
          updatePaperRun(key, () => ({ paperId: paper.id }));
        })
        .catch((err) => fail(key, err));
    },
    // `common` and `fail` read refs only.
    [agentPanel],
  );
}
