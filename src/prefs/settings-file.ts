import { BUILTIN_CONTENT_THEMES } from "./builtin-themes";
import type { AiRecords } from "../platform/bindings/files";
import type { McpServer } from "./mcp";
import { normaliseSettings } from "./settings-normalise";
import type { Settings } from "./settings-types";
import type { UserThemeMeta } from "./settings-values";

/**
 * Settings as a file, to back them up or carry them to another computer;
 * the same payload a settings sync would carry. It holds what is shared
 * between computers and the CSS of imported themes, and, when asked, the AI
 * records: conversations and memories. API keys live in owner-only files
 * of the app's config, never here; an MCP server's environment and header
 * values (its tokens) are left blank, and an import fills in this
 * computer's own only for the same server as it is set up here.
 */

const FORMAT = "textus-settings";

/** Never leave this computer: they name its folders and network, or what
 *  it has already been through. */
const DEVICE_SETTINGS = [
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
  // Addresses a stored key or the user's pictures and searches go to: a
  // shared file could name any server.
  "imageStorageMode",
  "imageHost",
  "imagePicgoEndpoint",
  "imageUploadEndpoint",
  "imageUploadUrlField",
  "imageModelProvider",
  "imageModelEndpoint",
  "searchService",
  "searxngUrl",
] as const satisfies readonly (keyof Settings)[];

/** An imported theme's CSS, by theme id. */
export type ThemeCss = Record<string, { light: string; dark?: string }>;

interface SettingsFile {
  settings: Settings;
  themes: ThemeCss;
  /** The conversations and memories, when the file has them. */
  ai: AiRecords | null;
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

/** The file's text for `settings`, with the CSS of its imported themes and
 *  any AI records. */
export function settingsFileText(
  settings: Settings,
  themes: ThemeCss,
  ai: AiRecords | null = null,
): string {
  const shared: Partial<Settings> = { ...settings };
  for (const key of DEVICE_SETTINGS) delete shared[key];
  shared.mcpServers = settings.mcpServers.map((server) => ({
    ...server,
    env: blanked(server.env),
    headers: blanked(server.headers),
  }));
  return JSON.stringify(
    { format: FORMAT, version: 1, settings: shared, themes, ...(ai && { ai }) },
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
  // A dark look only where its CSS came along.
  const arriving = (incoming ?? [])
    .filter((theme) => css[theme.id])
    .map((theme) => ({ ...theme, hasDark: css[theme.id].dark !== undefined }));
  const ids = new Set(arriving.map((theme) => theme.id));
  return [...mine.filter((theme) => !ids.has(theme.id)), ...arriving];
}

/** The records' shape only; the backend checks each one as it adds it. */
function aiRecordsOf(value: unknown): AiRecords | null {
  const ai = value as Partial<AiRecords> | null;
  return ai && Array.isArray(ai.conversations) && Array.isArray(ai.memories)
    ? { conversations: ai.conversations, memories: ai.memories }
    : null;
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
    ai?: unknown;
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
        // The user's own server, as they set it up: its secrets filled in.
        // Anything else a file brings starts nothing and gets no secret of
        // theirs until they turn it on themselves - a shared file could
        // name any program or address.
        const same =
          !!mine &&
          mine.command === server.command &&
          mine.url === server.url &&
          JSON.stringify(mine.args) === JSON.stringify(server.args ?? []);
        return same
          ? {
              ...server,
              env: filled(server.env ?? {}, mine.env),
              headers: filled(server.headers ?? {}, mine.headers),
            }
          : {
              ...server,
              enabled: false,
              env: blanked(server.env ?? {}),
              headers: blanked(server.headers ?? {}),
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
    BUILTIN_CONTENT_THEMES.some((theme) => theme.id === incoming.themeId) ||
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
      // Export's extra pandoc options stay this device's: a shared file's
      // could run a filter program on the next export.
      pandocArgs: current.pandocArgs,
      userThemes,
      themeId,
      ...kept,
    }),
    themes,
    ai: aiRecordsOf(parsed.ai),
  };
}
