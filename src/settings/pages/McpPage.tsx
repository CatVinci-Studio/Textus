import type { SettingsPageProps } from "./types";
import { McpSection } from "../sections/mcp";
import { AcpAgentsSection } from "../sections/acp-agents";

/** Settings › Textus AI › External tools: the MCP servers that give the AI
 *  more tools, and the ACP agents plugins bring. */
export function McpPage({ t }: SettingsPageProps) {
  return <McpSection t={t} after={<AcpAgentsSection t={t} />} />;
}
