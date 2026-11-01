import type { McpServer } from "./mcp";
import { normaliseSettings } from "./settings-normalise";
import type { Settings } from "./settings-types";

/**
 * Settings as a file, to back them up or carry them to another computer.
 * API keys live in the system keychain, never here; an MCP server's
 * environment and header values (its tokens) are left blank, and an import
 * keeps this computer's own for a server it already has.
 */

const FORMAT = "textus-settings";

/** Kept as this computer has them: they name its folders, or what it has
 *  already been through. */
const THIS_COMPUTER = [
  "agentWorkspaceRoot",
  "onboardingShown",
  "languageChosen",
] as const satisfies readonly (keyof Settings)[];

function blanked(values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(values).map((key) => [key, ""]));
}

/** A blank value filled from `mine`, where it has one for the same key. */
function filled(
  values: Record<string, string>,
  mine: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value || mine?.[key] || "",
    ]),
  );
}

/** The file's text for `settings`. */
export function settingsFileText(settings: Settings): string {
  const mcpServers = settings.mcpServers.map((server) => ({
    ...server,
    env: blanked(server.env),
    headers: blanked(server.headers),
  }));
  return JSON.stringify(
    { format: FORMAT, version: 1, settings: { ...settings, mcpServers } },
    null,
    2,
  );
}

/** The settings a file holds, over `current` where it says nothing; null
 *  for a file that isn't Textus settings. */
export function settingsFromFile(
  text: string,
  current: Settings,
): Settings | null {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = file as { format?: unknown; settings?: unknown };
  if (
    parsed?.format !== FORMAT ||
    !parsed.settings ||
    typeof parsed.settings !== "object"
  )
    return null;
  const incoming = parsed.settings as Partial<Settings>;
  const mcpServers = Array.isArray(incoming.mcpServers)
    ? incoming.mcpServers.map((server: McpServer) => {
        const mine = current.mcpServers.find((m) => m.id === server.id);
        return {
          ...server,
          env: filled(server.env ?? {}, mine?.env),
          headers: filled(server.headers ?? {}, mine?.headers),
        };
      })
    : current.mcpServers;
  const kept = Object.fromEntries(
    THIS_COMPUTER.map((key) => [key, current[key]]),
  );
  return normaliseSettings({ ...current, ...incoming, mcpServers, ...kept });
}
