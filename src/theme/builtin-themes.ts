import type { TextKey } from "../i18n/strings";

/// Built-in content themes only override `--editor-*` CSS variables (see
/// content-themes.css) - "default" means none of them are active, so the
/// base variables from ui/base.css apply as-is.
export type BuiltinContentThemeId =
  "default" | "paper" | "slate" | "forest" | "parchment";

/// `nameKey` points at an i18n string so the picker label follows the app
/// language (see settings/sections/theme.tsx); `name` stays as a stable
/// English fallback. User-imported themes keep their filename, untranslated.
///
/// Every one of these defines a light AND a dark palette in
/// content-themes.css; `ThemeMode` chooses between them. A theme with only
/// one design still defines both, with identical values, so that switching
/// appearance leaves it alone instead of half-applying.
export const BUILTIN_CONTENT_THEMES: {
  id: BuiltinContentThemeId;
  name: string;
  nameKey: TextKey;
}[] = [
  { id: "default", name: "Default", nameKey: "themeNameDefault" },
  { id: "paper", name: "Paper", nameKey: "themeNamePaper" },
  { id: "slate", name: "Slate", nameKey: "themeNameSlate" },
  { id: "forest", name: "Forest", nameKey: "themeNameForest" },
  { id: "parchment", name: "Parchment", nameKey: "themeNameParchment" },
];
