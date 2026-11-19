import {
  externalAgent,
  useExternalAgents,
} from "../../plugins/contributions/agents";
import { namePageTabs } from "../../document/doc-tabs";
import { openConversationTab } from "../chat/conversation-tabs";
import { conversationFor } from "../chat/conversation/conversation-registry";
import {
  storeAgent,
  storedAgent,
} from "../chat/conversation/conversation-agent";
import { DRAFT } from "../chat/conversation-scope";
import { loadSettings } from "../../prefs/settings-store";
import { pluginRecord } from "../../plugins/store/plugin-records";
import { PluginTabIcon } from "../../plugins/views/plugin-views";
import { useSettings } from "../../prefs/SettingsContext";
import { Tooltip } from "../../engine/controls/Tooltip";

// An AI tab is named for who answers in it: Claude Code, Codex, or (none
// chosen) Textus AI.
namePageTabs("ai", (state) => {
  const id = (state as { conversation?: string } | null)?.conversation;
  const agent = (id && storedAgent(id)) ?? loadSettings().chatAgent;
  return externalAgent(agent)?.name ?? null;
});

/** A new conversation with `agent` answering, in a tab of its own; where
 *  there are no AI tabs, the conversation not yet begun takes it. */
function openWithAgent(agent: string, aiOpen: boolean, showAi: () => void) {
  const id = crypto.randomUUID();
  storeAgent(id, agent);
  if (openConversationTab(id)) return;
  const draft = conversationFor(DRAFT, null);
  if (draft.snapshot().history.length === 0) draft.setAgent(agent);
  if (!aiOpen) showAi();
}

/**
 * The outside agents plugins bring (Claude Code, Codex…), one button each
 * beside Textus AI's at the window bar's end: a press starts a new
 * conversation with that agent, beside the others; the conversation in
 * use keeps its own (its composer switches who answers in it).
 */
export function AgentButtons({
  aiOpen,
  onToggleAi,
}: {
  aiOpen: boolean;
  onToggleAi: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const agents = useExternalAgents();
  if (!agents.length || !settings.textusAi) return null;
  return agents.map((agent) => {
    const record = pluginRecord(agent.plugin);
    return (
      <Tooltip key={agent.key} text={agent.name}>
        <button
          type="button"
          className="window-bar-agent"
          aria-label={agent.name}
          onClick={() => {
            // Where the next conversation starts too.
            setSettings({ chatAgent: agent.key });
            openWithAgent(agent.key, aiOpen, onToggleAi);
          }}
        >
          {record?.manifest?.icon ? (
            <PluginTabIcon
              plugin={agent.plugin}
              origin={record.origin}
              icon={record.manifest.icon}
            />
          ) : (
            <span className="window-bar-agent-letter" aria-hidden="true">
              {agent.name.charAt(0)}
            </span>
          )}
        </button>
      </Tooltip>
    );
  });
}
