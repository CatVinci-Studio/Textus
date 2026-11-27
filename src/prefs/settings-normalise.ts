import { storedLook } from "./classic-look";
import { normaliseMcpServers } from "./mcp";
import { hasTextusAi, isMobileApp } from "../platform/capabilities";
import { detectLang, isLang, type Lang } from "../i18n/strings";
import {
  UPDATE_CHANNELS,
  type UpdateChannel,
} from "../platform/update-channel";
import { isRecord, type Raw } from "./settings-sync";
import { storedImageFolder } from "./image-folder";
import { storedShortcuts } from "./shortcut-defaults";
import { DEFAULT_SETTINGS, type Settings } from "./settings-types";
import {
  PDF_MARGINS,
  PDF_PAPERS,
  PDF_TEXT_SCALES,
  type PdfMargin,
  type PdfPaper,
  type PdfTextScale,
  COLOR_SWATCH_MODES,
  type ColorSwatchMode,
  SINGLE_TILDE_MODES,
  type SingleTildeMode,
  SINGLE_NEWLINE_MODES,
  type SingleNewlineMode,
  DIAGRAM_ENGINES,
  type DiagramEngine,
  IMAGE_HOSTS,
  type ImageHost,
  REVISION_DISPLAYS,
  AI_CHANGE_MODES,
  type AiChangeMode,
  type RevisionDisplay,
  type Creation,
  CREATION_KINDS,
  type CreationKind,
  THEME_MODES,
  PROXY_TYPES,
  type ProxyType,
  type ThemeMode,
  UI_TEXT_SCALES,
  UI_TEXT_SCALES_BEFORE,
  UI_LARGE,
  type UiTextScale,
  DOC_TEXT_SIZES,
  type DocTextSize,
  DOC_LINE_SPACINGS,
  type DocLineSpacing,
  DOC_LETTER_SPACINGS,
  type DocLetterSpacing,
  LETTER_SPACING_BY,
  PANDOC_ARGS_FORMATS,
} from "./settings-values";

/** Saved settings read back whole: a missing, ill-typed or unknown value
 *  takes its default, and fields this version doesn't know are kept. */

/** A stored provider-to-model map: its string entries, nothing else. */
/** Points within Word's range, at its 0.1 pt step. */
export function letterSpacingBy(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.docLetterSpacingBy;
  const clamped = Math.min(
    LETTER_SPACING_BY.max,
    Math.max(LETTER_SPACING_BY.min, n),
  );
  return Math.round(clamped * 10) / 10;
}

function stringMap(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** Stored Pandoc arguments: lists of strings, for the formats known. */
function pandocArgs(value: unknown): Settings["pandocArgs"] {
  if (!isRecord(value)) return {};
  return Object.fromEntries(
    PANDOC_ARGS_FORMATS.flatMap((format) => {
      const args = value[format];
      return Array.isArray(args)
        ? [[format, args.filter((a): a is string => typeof a === "string")]]
        : [];
    }),
  );
}

/** The stored list of what Create made: well-formed entries only. */
export function storedCreations(value: unknown): Creation[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (c): c is Creation =>
      isRecord(c) &&
      CREATION_KINDS.includes(c.kind as CreationKind) &&
      typeof c.id === "string" &&
      c.id !== "" &&
      typeof c.name === "string" &&
      typeof c.at === "number",
  );
}

/** A new installation starts in the OS's language, when the app has it. */
export function guessLanguage(): Lang {
  return detectLang(typeof navigator === "undefined" ? "" : navigator.language);
}

/** Stored settings -> a complete, valid `Settings`. Nothing stored at all is
 *  a new installation, which starts in the OS's language. */
export function normaliseSettings(parsed: Raw | null): Settings {
  const settings = withDefaultShapes(readSettings(parsed));
  return hasTextusAi ? settings : { ...settings, textusAi: false };
}

/** The settings whose choices come in more than one kind (a size in px, or
 *  "auto"): any kind of their list is theirs, not only their default's. */
const MIXED_CHOICES: Record<string, readonly unknown[]> = {
  docTextSize: DOC_TEXT_SIZES,
};

/** Each setting of another kind than its default (a number where a list
 *  goes, text where a switch goes) back to the default: a hand-edited or
 *  older file can't break what reads it. */
function withDefaultShapes(settings: Settings): Settings {
  const shape = (value: unknown) =>
    value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const out: Record<string, unknown> = { ...settings };
  for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
    const kinds = (MIXED_CHOICES[key] ?? [fallback]).map(shape);
    if (
      fallback !== null &&
      fallback !== undefined &&
      !kinds.includes(shape(out[key]))
    )
      out[key] = fallback;
  }
  return out as unknown as Settings;
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
      chatAgent: typeof parsed.chatAgent === "string" ? parsed.chatAgent : "",
      agentOptions: isRecord(parsed.agentOptions)
        ? Object.fromEntries(
            Object.entries(parsed.agentOptions).map(([agent, chosen]) => [
              agent,
              stringMap(chosen),
            ]),
          )
        : {},
      writingProvider:
        typeof parsed.writingProvider === "string"
          ? parsed.writingProvider
          : "",
      writingModels: stringMap(parsed.writingModels),
      revisionDisplay:
        parsed.revisionDisplay === "new"
          ? "final"
          : REVISION_DISPLAYS.includes(
                parsed.revisionDisplay as RevisionDisplay,
              )
            ? (parsed.revisionDisplay as RevisionDisplay)
            : DEFAULT_SETTINGS.revisionDisplay,
      aiChangeMode: AI_CHANGE_MODES.includes(
        parsed.aiChangeMode as AiChangeMode,
      )
        ? (parsed.aiChangeMode as AiChangeMode)
        : DEFAULT_SETTINGS.aiChangeMode,
      shortcuts: storedShortcuts(parsed.shortcuts),
      commandShortcuts: stringMap(parsed.commandShortcuts),
      mcpServers: normaliseMcpServers(parsed.mcpServers),
      providerAddresses: addressesOf(parsed.providerAddresses),
      pandocArgs: pandocArgs(parsed.pandocArgs),
      creations: storedCreations(parsed.creations),
      plugins: isRecord(parsed.plugins)
        ? (Object.fromEntries(
            Object.entries(parsed.plugins).filter(([, v]) => isRecord(v)),
          ) as Settings["plugins"])
        : {},
      pdfPaper: PDF_PAPERS.includes(parsed.pdfPaper as PdfPaper)
        ? (parsed.pdfPaper as PdfPaper)
        : DEFAULT_SETTINGS.pdfPaper,
      pdfMargin: PDF_MARGINS.includes(parsed.pdfMargin as PdfMargin)
        ? (parsed.pdfMargin as PdfMargin)
        : DEFAULT_SETTINGS.pdfMargin,
      pdfTextScale: PDF_TEXT_SCALES.includes(
        parsed.pdfTextScale as PdfTextScale,
      )
        ? (parsed.pdfTextScale as PdfTextScale)
        : DEFAULT_SETTINGS.pdfTextScale,
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
      singleTilde: SINGLE_TILDE_MODES.includes(
        parsed.singleTilde as SingleTildeMode,
      )
        ? (parsed.singleTilde as SingleTildeMode)
        : DEFAULT_SETTINGS.singleTilde,
      singleNewline: SINGLE_NEWLINE_MODES.includes(
        parsed.singleNewline as SingleNewlineMode,
      )
        ? (parsed.singleNewline as SingleNewlineMode)
        : DEFAULT_SETTINGS.singleNewline,
      uiTextScale: uiTextScaleOf(parsed.uiTextScale),
      // A size picked before there was a system's to follow stays picked.
      uiSizeFollowsSystem:
        typeof parsed.uiSizeFollowsSystem === "boolean"
          ? parsed.uiSizeFollowsSystem
          : parsed.uiTextScale === undefined || parsed.uiTextScale === 1,
      docTextSize: DOC_TEXT_SIZES.includes(parsed.docTextSize as DocTextSize)
        ? (parsed.docTextSize as DocTextSize)
        : DEFAULT_SETTINGS.docTextSize,
      docLineSpacing: DOC_LINE_SPACINGS.includes(
        parsed.docLineSpacing as DocLineSpacing,
      )
        ? (parsed.docLineSpacing as DocLineSpacing)
        : DEFAULT_SETTINGS.docLineSpacing,
      docFont:
        typeof parsed.docFont === "string"
          ? parsed.docFont.trim()
          : DEFAULT_SETTINGS.docFont,
      docLetterSpacing: DOC_LETTER_SPACINGS.includes(
        parsed.docLetterSpacing as DocLetterSpacing,
      )
        ? (parsed.docLetterSpacing as DocLetterSpacing)
        : DEFAULT_SETTINGS.docLetterSpacing,
      docLetterSpacingBy: letterSpacingBy(parsed.docLetterSpacingBy),
      // An unknown language (a newer build's, a hand edit) is English, not
      // a string table that isn't there.
      language: isLang(parsed.language) ? parsed.language : "en",
      proxyType: PROXY_TYPES.includes(parsed.proxyType as ProxyType)
        ? (parsed.proxyType as ProxyType)
        : DEFAULT_SETTINGS.proxyType,
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
      lookBeforeClassic: storedLook(parsed.lookBeforeClassic),
      // Asked unless the user said not to: only a stored false stops it.
      confirmTreeCopy: parsed.confirmTreeCopy !== false,
      confirmTreeTrash: parsed.confirmTreeTrash !== false,
      fileIconTheme:
        typeof parsed.fileIconTheme === "string"
          ? parsed.fileIconTheme
          : DEFAULT_SETTINGS.fileIconTheme,
      // Saved before the frame had a setting: on where the classic look is,
      // which now includes it, so its switch still shows on.
      plainFrame:
        typeof parsed.plainFrame === "boolean"
          ? parsed.plainFrame
          : parsed.layout === "classic" &&
            parsed.activityRail === false &&
            parsed.titleRowShown === true,
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

/** A step this device offers: a touch screen's two past Large read as
 *  Large on a desktop (a settings file brought from an iPad). */
function uiTextScaleOf(raw: unknown): UiTextScale {
  const scale = UI_TEXT_SCALES.includes(raw as UiTextScale)
    ? (raw as UiTextScale)
    : (UI_TEXT_SCALES_BEFORE[String(raw)] ?? DEFAULT_SETTINGS.uiTextScale);
  return isMobileApp || scale <= UI_LARGE ? scale : UI_LARGE;
}

/** The addresses kept: a web address for each provider. */
function addressesOf(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === "string" && /^https?:\/\//.test(entry[1].trim()),
    ),
  );
}
