import type { Strings } from "../../i18n/strings";
import { useExternalAgents } from "../../plugins/contributions/agents";
import { pluginRecord } from "../../plugins/store/plugin-records";
import { PluginTabIcon } from "../../plugins/views/plugin-tab-icon";
import { emitToThisWindow } from "../../platform/menu-events";
import { SHOW_SIDEBAR_TAB_EVENT } from "../../utils/events";
import { SettingsGroup } from "../pages/SettingsGroup";
import { SettingRow } from "./controls";

const showPlugins = () =>
  window.dispatchEvent(
    new CustomEvent(SHOW_SIDEBAR_TAB_EVENT, { detail: "plugins" }),
  );

/**
 * Settings › Textus AI › External tools: the ACP agents plugins bring
 * (Claude Code, Codex…), each opening its plugin's page; installed and
 * removed in the plugins panel.
 */
export function AcpAgentsSection({ t }: { t: Strings }) {
  const agents = useExternalAgents();
  return (
    <SettingsGroup
      title={t.acpAgentsGroup}
      actions={
        <button
          type="button"
          className="text-button settings-inline-button"
          onClick={showPlugins}
        >
          {t.acpAgentsGet}
        </button>
      }
    >
      {agents.length === 0 ? (
        <p className="plugin-empty">{t.acpAgentsNone}</p>
      ) : (
        agents.map((agent) => {
          const record = pluginRecord(agent.plugin);
          const icon = record?.manifest?.icon;
          return (
            <SettingRow
              key={agent.key}
              label={
                <span className="settings-agent-name">
                  {icon && (
                    <PluginTabIcon
                      plugin={agent.plugin}
                      origin={record.origin}
                      icon={icon}
                    />
                  )}
                  {agent.name}
                </span>
              }
            >
              <button
                type="button"
                className="text-button settings-inline-button"
                onClick={() =>
                  emitToThisWindow(
                    "menu-plugin-command",
                    `plugin-settings:${agent.plugin}`,
                  )
                }
              >
                {t.acpAgentManage}
              </button>
            </SettingRow>
          );
        })
      )}
    </SettingsGroup>
  );
}
