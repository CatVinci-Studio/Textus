import { useCallback, useEffect, useState } from "react";
import { useLatest } from "../utils/hooks/useLatest";
import { paperWriter, type PaperLatest } from "./paper-writer";
import type { useAgentPanel } from "../ai/chat/panel/agent-panel";
import type { AgentConversation } from "../ai/chat/conversation/conversation-types";
import type { EditorRunner } from "../editor/useEditorRunner";
import type { GeneratedImageData } from "../platform/ipc";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import type { Genre } from "../platform/bindings/ai-paper";
import { clearPaperActions, setPaperActions } from "../ai/paper/paper-store";
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
  storePicture,
  agentPanel,
  settings,
  filePath,
  isActive,
  t,
}: {
  run: EditorRunner;
  conversation: AgentConversation;
  /** Saves a picture beside the document (useEditorProposals). */
  storePicture: (
    image: GeneratedImageData,
    alt: string,
  ) => Promise<string | null>;
  agentPanel: ReturnType<typeof useAgentPanel>;
  settings: Settings;
  filePath: string | null;
  /** This editor's tab is showing: its conversation's cards are on show. */
  isActive: boolean;
  t: Strings;
}) {
  const paperDocument = usePaperDocument(run, storePicture);
  const latest = useLatest<PaperLatest>({
    settings,
    filePath,
    conversation,
    t,
    paperDocument,
  });
  const [writer] = useState(() => paperWriter(latest));

  useEffect(() => {
    if (!isActive) return;
    const { approve, stop, resume, restore } = writer;
    const mine = { approve, stop, resume, restore };
    setPaperActions(mine);
    return () => clearPaperActions(mine);
  }, [isActive, writer]);

  /** Starts a piece (paperWriter's `start`). */
  return useCallback(
    (topic: string, genre: Genre | null, conversation: string) =>
      writer.start(topic, genre, conversation, () => agentPanel.setOpen(true)),
    [agentPanel, writer],
  );
}
