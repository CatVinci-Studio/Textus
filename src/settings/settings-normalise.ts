import { normaliseMcpServers } from "./mcp";
import { detectLang, isLang, localeOf, type Lang } from "../i18n/strings";
import {
  UPDATE_CHANNELS,
  type UpdateChannel,
} from "../platform/update-channel";
import type { Raw } from "./settings-sync";
import { migrateImageFolder } from "./image-folder";
import { migrateShortcuts } from "./shortcut-defaults";
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
  migrateAgentMode,
} from "./settings-types";

/**
 * Saved settings read back whole: unknown or old values replaced by the
 * defaults, renamed providers and models carried over
 * (SettingsContext.tsx). Pure functions.
 */

/// Maps a pre-catalog-expansion provider id to its new catalog id - "codex"
/// and "apikey" both become "openai" (now one entry with two auth methods).
export const LEGACY_PROVIDER_IDS: Record<string, string> = {
  codex: "openai",
  claude: "anthropic",
  apikey: "openai",
};

/// Old settings blobs kept one model field per provider id
/// (`${provider}AgentModel`); folds those into the new `agentModels` map,
/// translating ids through `LEGACY_PROVIDER_IDS`.
export function migrateAgentModels(
  parsed: Record<string, unknown>,
): Record<string, string> {
  const models: Record<string, string> = {
    ...(parsed.agentModels as Record<string, string> | undefined),
  };
  for (const legacyId of ["codex", "claude", "apikey"]) {
    const value = parsed[`${legacyId}AgentModel`];
    if (typeof value === "string" && value)
      models[LEGACY_PROVIDER_IDS[legacyId]] = value;
  }
  return models;
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
 * missing, and the migrations of older shapes. Nothing stored at all (null,
 * or an empty object) is a brand-new installation; a stored object that is
 * merely missing a field is an existing one from before that field.
 */
export function normaliseSettings(parsed: Raw | null): Settings {
  if (!parsed || Object.keys(parsed).length === 0)
    return { ...DEFAULT_SETTINGS, language: guessLanguage() };
  try {
    const shortcutsRevision =
      typeof parsed.shortcutsRevision === "number"
        ? parsed.shortcutsRevision
        : 0;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Existing installations created before the newcomer guide had no
      // field at all and must not suddenly receive first-run onboarding
      // after an update. A genuinely new install starts from DEFAULT_SETTINGS
      // (false); once shown, the explicit true value persists normally.
      onboardingShown:
        typeof parsed.onboardingShown === "boolean"
          ? parsed.onboardingShown
          : true,
      languageChosen:
        typeof parsed.languageChosen === "boolean"
          ? parsed.languageChosen
          : true,
      aiProvider:
        LEGACY_PROVIDER_IDS[parsed.aiProvider as string] ??
        (parsed.aiProvider as string | undefined) ??
        DEFAULT_SETTINGS.aiProvider,
      agentModels: migrateAgentModels(parsed),
      writingModels: {
        ...(parsed.writingModels as Record<string, string> | undefined),
      },
      agentDefaultMode:
        migrateAgentMode(parsed.agentDefaultMode) ??
        DEFAULT_SETTINGS.agentDefaultMode,
      revisionDisplay: REVISION_DISPLAYS.includes(
        parsed.revisionDisplay as RevisionDisplay,
      )
        ? (parsed.revisionDisplay as RevisionDisplay)
        : DEFAULT_SETTINGS.revisionDisplay,
      shortcuts: migrateShortcuts(parsed.shortcuts, shortcutsRevision),
      mcpServers: normaliseMcpServers(parsed.mcpServers),
      shortcutsRevision,
      diagramEngine: DIAGRAM_ENGINES.includes(
        parsed.diagramEngine as DiagramEngine,
      )
        ? (parsed.diagramEngine as DiagramEngine)
        : DEFAULT_SETTINGS.diagramEngine,
      // 1.2.0's betas had an on/off switch, which drew swatches in inline
      // code only.
      colorSwatches: COLOR_SWATCH_MODES.includes(
        parsed.colorSwatches as ColorSwatchMode,
      )
        ? (parsed.colorSwatches as ColorSwatchMode)
        : parsed.inlineColorSwatches === true
          ? "code"
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
      imageFolder: migrateImageFolder(parsed.imageFolder),
      // Before the presets, the one image host was the user's endpoint: an
      // installation that set one up keeps it.
      imageHost: IMAGE_HOSTS.includes(parsed.imageHost as ImageHost)
        ? (parsed.imageHost as ImageHost)
        : typeof parsed.imageUploadEndpoint === "string" &&
            parsed.imageUploadEndpoint.trim()
          ? "custom"
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
