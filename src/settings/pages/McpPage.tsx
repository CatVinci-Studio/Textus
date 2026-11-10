import type { SettingsPageProps } from "./types";
import { McpSection } from "../sections/mcp";

/** Settings › Textus AI › MCP: the servers that give the AI more tools. */
export function McpPage({ t, settings }: SettingsPageProps) {
  if (!settings.textusAi)
    return <p className="tx-list-note">{t.textusAiOffHint}</p>;
  return <McpSection t={t} />;
}
