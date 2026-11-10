import { useState } from "react";
import { useSettings, type PanelMode } from "../../prefs/SettingsContext";
import type { DocumentSnapshot } from "../doc-markdown";
import { MODES } from "../modes";
import { ChatBody } from "./ChatBody";
import { chatLabels } from "./chat-labels";
import { ModeIcon } from "./mode-icons";
import { useAgentConversation } from "./useAgentConversation";

/** No document in the window: the conversation works on the folder. */
const NO_DOCUMENT: DocumentSnapshot = { markdown: "", blocks: [] };

/**
 * Textus AI with no document open - only Settings, say: a conversation of
 * its own on the open folder, as Create's is. A document opened takes it
 * over (its editor draws the window's conversation).
 */
export function StandaloneChat() {
  const { settings, t } = useSettings();
  const conversation = useAgentConversation(
    null,
    settings.agentWorkspaceRoot || null,
    settings.aiProvider,
    false,
    settings.agentModels[settings.aiProvider] || undefined,
  );
  const [mode, setMode] = useState<PanelMode>(settings.agentDefaultMode);
  const empty = conversation.history.length === 0 && !conversation.busy;
  return (
    <div className="agent-panel-view">
      <div className="agent-panel-body">
        {empty && (
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
          document={NO_DOCUMENT}
          selectedText={null}
          selectionMarkdown={null}
          docPath={null}
          workspaceRoot={settings.agentWorkspaceRoot || null}
          conversation={conversation}
          defaultMode={settings.agentDefaultMode}
          defaultWebSearch={settings.enableWebSearch}
          labels={chatLabels(t, settings.language)}
          proposalStatus={() => "expired"}
          pendingCount={0}
          onModeChange={setMode}
          fillHeight
          pendingBar={false}
          // No document to propose into: its changes go to files, marked
          // as Textus AI's are.
          onProposals={() => {}}
          onAcceptProposal={() => {}}
          onRejectProposal={() => {}}
          onAcceptAll={() => {}}
          onRejectAll={() => {}}
        />
      </div>
    </div>
  );
}
