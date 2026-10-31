import { useCallback, useEffect, useRef } from "react";
import { ai } from "../platform/ipc";
import { errorText } from "../utils/error-text";
import { imageModelOf } from "../ai/image-models";
import { proposalsFromTurns } from "../ai/chat/ChatBody";
import type { useEditorProposals } from "./useEditorProposals";
import type { useAgentPanel } from "../ai/chat/panel/agent-panel";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { Outline } from "../platform/bindings/ai-paper";
import {
  applyPaperEvent,
  paperCardTurns,
  paperLanguage,
  paperProposalTurns,
  paperRun,
  setPaperActions,
  updatePaperRun,
} from "../ai/paper/paper-store";

/**
 * "Write a paper": researches and outlines a paper on a topic, waits on its
 * card for the user to approve the outline, then drafts it and proposes it
 * whole at the end of the document (docs/design/ai-paper.md). Its progress
 * lives in the paper store; the conversation keeps its card and its
 * proposal.
 */
export function usePaperWriter({
  proposals,
  agentPanel,
  settings,
  filePath,
  t,
}: {
  proposals: ReturnType<typeof useEditorProposals>;
  agentPanel: ReturnType<typeof useAgentPanel>;
  settings: Settings;
  filePath: string | null;
  t: Strings;
}) {
  const { conversation, requestTargetRef, showProposals } = proposals;
  // Read when a step starts, so a run picks up the settings of its moment.
  const latest = useRef({ settings, filePath, conversation, t });
  latest.current = { settings, filePath, conversation, t };
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
              if (event.type !== "ready") return;
              const turns = paperProposalTurns(
                key,
                event.markdown,
                latest.current.t.paperProposed,
              );
              latest.current.conversation.append(turns);
              // An append has no selection to stand by.
              requestTargetRef.current = null;
              showProposals(proposalsFromTurns(turns));
              updatePaperRun(key, () => ({ proposed: true }));
            },
          );
        })
        .then(() => {
          requests.current.delete(key);
          updatePaperRun(key, () => ({ approving: false }));
        })
        .catch((err) => fail(key, err));
    },
    // `common` and `fail` read refs only.
    [requestTargetRef, showProposals],
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
