import { useExternalAgents } from "../../plugins/contributions/agents";
import { pluginRecord } from "../../plugins/store/plugin-records";
import { PluginTabIcon } from "../../plugins/views/plugin-views";
import { useSettings } from "../../prefs/SettingsContext";
import { Tooltip } from "../../engine/controls/Tooltip";

/**
 * The outside agents plugins bring (Claude Code, Codex…), one button each
 * beside Textus AI's at the window bar's end: a press opens the AI with
 * that agent; pressed again while it is the one in use, it acts as the AI
 * button does.
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
    const inUse = settings.chatAgent === agent.key;
    return (
      <Tooltip key={agent.key} text={agent.name}>
        <button
          type="button"
          className={`window-bar-agent${aiOpen && inUse ? " window-bar-toggle-on" : ""}`}
          aria-label={agent.name}
          aria-pressed={aiOpen && inUse}
          onClick={() => {
            if (!inUse) setSettings({ chatAgent: agent.key });
            if (!aiOpen || inUse) onToggleAi();
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
