import { useEffect, useRef, useState } from "react";
import type { DocumentSnapshot } from "../../../editor/markdown/doc-markdown";
import { MODES } from "../../modes";
import { ChatBody } from "../ChatBody";
import type { ChatComposerHandle } from "../ChatComposer";
import { takeComposerAsks } from "../composer-asks";
import { AgentPanelView } from "./AgentPanelView";
import { ChatHistoryMenu } from "../ChatHistoryMenu";
import { reopenConversation } from "../reopen-conversation";
import { CloseConfirmBar } from "../CloseConfirm";
import { ProjectBar } from "./ProjectBar";
import { useAgentPanel } from "./agent-panel";
import { chatLabels } from "../chat-labels";
import type { ConversationModel } from "../conversation/conversation-model";
import type {
  AttachedDocument,
  DocumentPanel,
} from "../conversation/document-port";
import { useConversation } from "../conversation/useConversation";
import { canDetachChat } from "../../../platform/capabilities";
import {
  PAPER_GENRES,
  genreLabel,
  type PaperGenreChoice,
} from "../../paper/paper-genres";
import { ModeIcon } from "../mode-icons";
import { useSettings, type PanelMode } from "../../../prefs/SettingsContext";
import { START_MODE, initialMode } from "../last-mode";
import { useAiSignedIn } from "../chat-models";
import { openSettingsPage } from "../../../settings/settings-nav";

/** The panel always asks for the document as it is now; this stands until
 *  it answers, and where there is none. */
const NO_DOCUMENT: DocumentSnapshot = { markdown: "", blocks: [] };

/** No document to propose into: the AI's changes go to files, marked as
 *  Textus AI's are. */
const NO_DOCUMENT_CHAT: DocumentPanel["chat"] = {
  selectedText: null,
  proposalStatus: () => "expired",
  pendingCount: 0,
  onProposals: () => {},
  onAcceptProposal: () => {},
  onRejectProposal: () => {},
  onAcceptAll: () => {},
  onRejectAll: () => {},
};

/**
 * One of the window's conversations as the AI's panel draws it: the chat
 * on `model`, working on the document in front or, with none open, on the
 * folder.
 */
export function ConversationPanel({
  model,
  document,
  newSlot,
}: {
  model: ConversationModel;
  document: AttachedDocument | null;
  /** Filled with this panel's New conversation, for its island's menu. */
  newSlot?: { current: (() => void) | null };
}) {
  const { settings, t } = useSettings();
  const agentPanel = useAgentPanel();
  const conversation = useConversation(model);
  const signedIn = useAiSignedIn();
  // The composer's mode: the empty state says what the AI will do in it.
  const [mode, setMode] = useState<PanelMode>(() => initialMode());
  // Research mode's kind of piece, "auto" for the model's choice; the
  // message sent is its topic.
  const [paperGenre, setPaperGenre] = useState<PaperGenreChoice>("auto");
  // What is asked into the AI from elsewhere lands in this composer.
  const composer = useRef<ChatComposerHandle>(null);
  useEffect(
    () =>
      takeComposerAsks(
        (text) => composer.current?.restore(text),
        () => composer.current?.shown() ?? false,
      ),
    [],
  );
  const port = document?.port ?? null;
  // A reply still arriving is about the document it was asked of: brought
  // in front meanwhile, another takes none of its proposals.
  const asked = !conversation.busy || model.about === port;
  const doc = asked ? document?.panel : undefined;
  const chat = doc?.chat ?? NO_DOCUMENT_CHAT;
  const docPath = port?.docPath ?? null;
  const labels = chatLabels(t, settings.language);
  // The document's own, which waits on its undecided edits.
  const startNew = doc?.onNewConversation ?? (() => conversation.reset());
  if (newSlot) newSlot.current = startNew;
  return (
    <AgentPanelView
      labels={{
        title: t.agentPanelTitle,
        newConversation: t.chatNewConversation,
        popOut: t.agentPanelPopOut,
        project: t.agentTabProject,
      }}
      onNewConversation={startNew}
      onPopOut={canDetachChat ? doc?.onPopOut : undefined}
      history={
        <ChatHistoryMenu
          buttonClassName="inline-chat-header-button"
          onReopen={(entry) => void reopenConversation(entry, t)}
        />
      }
      tab={agentPanel.tab}
      onTabChange={agentPanel.setTab}
      memory={() => (
        <ProjectBar
          docPath={docPath}
          documentText={doc?.documentText() ?? ""}
        />
      )}
    >
      {signedIn === false && conversation.history.length === 0 ? (
        // Nothing to send to yet: where to sign in, not a box that answers
        // nothing.
        <div className="agent-panel-empty agent-panel-sign-in">
          <p className="agent-panel-empty-text">{t.chatSignInHint}</p>
          <button
            type="button"
            className="tx-button"
            onClick={() => openSettingsPage("providers")}
          >
            {t.chatSignIn}
          </button>
        </div>
      ) : (
        <>
          {conversation.history.length === 0 && !conversation.busy && (
            <div className="agent-panel-empty">
              <span className="agent-panel-empty-mark" aria-hidden="true">
                <ModeIcon key={mode} mode={mode} />
              </span>
              <p className="agent-panel-empty-text" key={mode}>
                {t[MODES[mode].empty]}
              </p>
            </div>
          )}
          <ChatBody
            composerRef={composer}
            {...chat}
            document={NO_DOCUMENT}
            selectionMarkdown={null}
            docPath={docPath}
            workspaceRoot={settings.agentWorkspaceRoot || null}
            conversation={conversation}
            defaultMode={START_MODE}
            labels={labels}
            fillHeight
            pendingBar={false}
            onModeChange={setMode}
            // The files attached are already in the conversation's scratch
            // folder, which the paper copies.
            onResearch={
              doc &&
              ((topic) =>
                doc.writePaper(
                  topic,
                  paperGenre === "auto" ? null : paperGenre,
                  conversation.conversationId,
                ))
            }
            // `/` picks the kind of piece in Research; skills elsewhere.
            kinds={
              mode !== "research"
                ? []
                : (["auto", ...PAPER_GENRES] as const).map((genre) => ({
                    key: genre,
                    label:
                      genre === "auto"
                        ? t.paperGenreAuto
                        : genreLabel(t, genre),
                    pick: () => setPaperGenre(genre),
                  }))
            }
            kind={
              mode !== "research" || paperGenre === "auto"
                ? null
                : {
                    label: genreLabel(t, paperGenre),
                    clearLabel: t.paperGenreAuto,
                    clear: () => setPaperGenre("auto"),
                  }
            }
            footer={
              doc?.guard && (
                <CloseConfirmBar
                  labels={labels}
                  pendingCount={chat.pendingCount}
                  onAcceptAll={chat.onAcceptAll}
                  onRejectAll={chat.onRejectAll}
                  onClose={doc.proceed}
                  onCancel={doc.cancelGuard}
                />
              )
            }
          />
        </>
      )}
    </AgentPanelView>
  );
}
