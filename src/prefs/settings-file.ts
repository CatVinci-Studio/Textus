import type { McpServer } from "./mcp";
import { normaliseSettings } from "./settings-normalise";
import type { Settings, UserThemeMeta } from "./settings-types";

/**
 * Settings as a file, to back them up or carry them to another computer;
 * the same payload a settings sync would carry. It holds what is shared
 * between computers and the CSS of imported themes. API keys live in the
 * system keychain, never here; an MCP server's environment and header values
 * (its tokens) are left blank, and an import keeps this computer's own.
 */

const FORMAT = "textus-settings";

/** Never leave this computer: they name its folders and network, or what
 *  it has already been through. */
export const DEVICE_SETTINGS = [
  "agentWorkspaceRoot",
  "onboardingShown",
  "languageChosen",
  "textusAiResumeAt",
  "proxyType",
  "proxyHost",
  "proxyPort",
  "zoom",
  "runInBackground",
  "updateChannel",
] as const satisfies readonly (keyof Settings)[];

/** An imported theme's CSS, by theme id. */
export type ThemeCss = Record<string, { light: string; dark?: string }>;

export interface SettingsFile {
  settings: Settings;
  themes: ThemeCss;
}

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

/** The file's text for `settings`, with the CSS of its imported themes. */
export function settingsFileText(settings: Settings, themes: ThemeCss): string {
  const shared: Partial<Settings> = { ...settings };
  for (const key of DEVICE_SETTINGS) delete shared[key];
  shared.mcpServers = settings.mcpServers.map((server) => ({
    ...server,
    env: blanked(server.env),
    headers: blanked(server.headers),
  }));
  return JSON.stringify(
    { format: FORMAT, version: 1, settings: shared, themes },
    null,
    2,
  );
}

/** Imported themes after an import: the file's that came with their CSS,
 *  and this computer's own beside them. */
function mergedThemes(
  incoming: UserThemeMeta[] | undefined,
  css: ThemeCss,
  mine: UserThemeMeta[],
): UserThemeMeta[] {
  const arriving = (incoming ?? []).filter((theme) => css[theme.id]);
  const ids = new Set(arriving.map((theme) => theme.id));
  return [...mine.filter((theme) => !ids.has(theme.id)), ...arriving];
}

function themeCssOf(value: unknown): ThemeCss {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([, css]) =>
        typeof (css as { light?: unknown })?.light === "string" &&
        ["string", "undefined"].includes(
          typeof (css as { dark?: unknown }).dark,
        ),
    ),
  ) as ThemeCss;
}

/** The settings a file holds, over `current` where it says nothing, and the
 *  theme CSS to save; null for a file that isn't Textus settings. */
export function settingsFromFile(
  text: string,
  current: Settings,
): SettingsFile | null {
  let file: unknown;
  try {
    file = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = file as {
    format?: unknown;
    settings?: unknown;
    themes?: unknown;
  };
  if (
    parsed?.format !== FORMAT ||
    !parsed.settings ||
    typeof parsed.settings !== "object"
  )
    return null;
  const incoming = parsed.settings as Partial<Settings>;
  const themes = themeCssOf(parsed.themes);
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
  const userThemes = mergedThemes(
    incoming.userThemes,
    themes,
    current.userThemes,
  );
  // A theme whose CSS didn't come along can't be shown here.
  const themeId =
    incoming.themeId === undefined ||
    incoming.themeId === "default" ||
    userThemes.some((theme) => theme.id === incoming.themeId)
      ? (incoming.themeId ?? current.themeId)
      : current.themeId;
  const kept = Object.fromEntries(
    DEVICE_SETTINGS.map((key) => [key, current[key]]),
  );
  return {
    settings: normaliseSettings({
      ...current,
      ...incoming,
      mcpServers,
      userThemes,
      themeId,
      ...kept,
    }),
    themes,
  };
}
