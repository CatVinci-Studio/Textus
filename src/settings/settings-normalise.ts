import { normaliseMcpServers } from "./mcp";
import { hasTextusAi } from "../platform/capabilities";
import { detectLang, isLang, localeOf, type Lang } from "../i18n/strings";
import {
  UPDATE_CHANNELS,
  type UpdateChannel,
} from "../platform/update-channel";
import type { Raw } from "./settings-sync";
import { storedImageFolder } from "./image-folder";
import { storedShortcuts } from "./shortcut-defaults";
import {
  COLOR_SWATCH_MODES,
  type ColorSwatchMode,
  DEFAULT_SETTINGS,
  DIAGRAM_ENGINES,
  type DiagramEngine,
  IMAGE_HOSTS,
  type ImageHost,
  REVISION_DISPLAYS,
  type RevisionDisplay,
  type Settings,
  THEME_MODES,
  type ThemeMode,
  UI_TEXT_SCALES,
  type UiTextScale,
  storedAgentMode,
} from "./settings-types";

/**
 * Saved settings read back whole: a field missing, ill-typed or holding a
 * value this version doesn't know takes its default, and fields this
 * version doesn't know are kept as they are (SettingsContext.tsx). Pure
 * functions.
 */

/** A stored provider-to-model map: its string entries, nothing else. */
function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** The `lang` attribute for the UI language, which the CSS `:lang()` font
 *  stacks key off (Chinese needs its region to pick Simplified or
 *  Traditional glyphs). Kept in step with the boot script
 *  (src-tauri/src/boot.js). */
export function htmlLang(language: Lang): string {
  return localeOf(language);
}

/** A new installation starts in the OS's language, when the app has it. */
export function guessLanguage(): Lang {
  return detectLang(typeof navigator === "undefined" ? "" : navigator.language);
}

/**
 * Stored settings -> a complete, valid `Settings`: defaults for what's
 * missing or unusable. Nothing stored at all (null, or an empty object) is
 * a brand-new installation, which also starts in the OS's language.
 */
export function normaliseSettings(parsed: Raw | null): Settings {
  const settings = readSettings(parsed);
  return hasTextusAi ? settings : { ...settings, textusAi: false };
}

function readSettings(parsed: Raw | null): Settings {
  if (!parsed || Object.keys(parsed).length === 0)
    return { ...DEFAULT_SETTINGS, language: guessLanguage() };
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      onboardingShown:
        typeof parsed.onboardingShown === "boolean"
          ? parsed.onboardingShown
          : DEFAULT_SETTINGS.onboardingShown,
      languageChosen:
        typeof parsed.languageChosen === "boolean"
          ? parsed.languageChosen
          : DEFAULT_SETTINGS.languageChosen,
      aiProvider:
        typeof parsed.aiProvider === "string" && parsed.aiProvider
          ? parsed.aiProvider
          : DEFAULT_SETTINGS.aiProvider,
      agentModels: stringMap(parsed.agentModels),
      writingModels: stringMap(parsed.writingModels),
      agentDefaultMode:
        storedAgentMode(parsed.agentDefaultMode) ??
        DEFAULT_SETTINGS.agentDefaultMode,
      revisionDisplay:
        parsed.revisionDisplay === "new"
          ? "final"
          : REVISION_DISPLAYS.includes(
                parsed.revisionDisplay as RevisionDisplay,
              )
            ? (parsed.revisionDisplay as RevisionDisplay)
            : DEFAULT_SETTINGS.revisionDisplay,
      shortcuts: storedShortcuts(parsed.shortcuts),
      mcpServers: normaliseMcpServers(parsed.mcpServers),
      diagramEngine: DIAGRAM_ENGINES.includes(
        parsed.diagramEngine as DiagramEngine,
      )
        ? (parsed.diagramEngine as DiagramEngine)
        : DEFAULT_SETTINGS.diagramEngine,
      colorSwatches: COLOR_SWATCH_MODES.includes(
        parsed.colorSwatches as ColorSwatchMode,
      )
        ? (parsed.colorSwatches as ColorSwatchMode)
        : DEFAULT_SETTINGS.colorSwatches,
      uiTextScale: UI_TEXT_SCALES.includes(parsed.uiTextScale as UiTextScale)
        ? (parsed.uiTextScale as UiTextScale)
        : DEFAULT_SETTINGS.uiTextScale,
      // An unknown language (a newer build's, a hand edit) is English, not
      // a string table that isn't there.
      language: isLang(parsed.language) ? parsed.language : "en",
      theme: THEME_MODES.includes(parsed.theme as ThemeMode)
        ? (parsed.theme as ThemeMode)
        : DEFAULT_SETTINGS.theme,
      updateChannel: UPDATE_CHANNELS.includes(
        parsed.updateChannel as UpdateChannel,
      )
        ? (parsed.updateChannel as UpdateChannel)
        : DEFAULT_SETTINGS.updateChannel,
      imageFolder: storedImageFolder(parsed.imageFolder),
      imageHost: IMAGE_HOSTS.includes(parsed.imageHost as ImageHost)
        ? (parsed.imageHost as ImageHost)
        : DEFAULT_SETTINGS.imageHost,
      // Any profile string is kept - a newer build's may not be in this
      // build's list - but it has to be one.
      textusAiResumeAt:
        typeof parsed.textusAiResumeAt === "number"
          ? parsed.textusAiResumeAt
          : null,
      writingConventions:
        typeof parsed.writingConventions === "string" &&
        parsed.writingConventions
          ? parsed.writingConventions
          : DEFAULT_SETTINGS.writingConventions,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
