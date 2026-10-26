import type { TextKey } from "../i18n/strings";

/// Built-in content themes only override `--editor-*` variables; "default"
/// means none are active.
export type BuiltinContentThemeId =
  "default" | "paper" | "slate" | "forest" | "parchment";

/// `nameKey` gives the picker label in the app language; `name` is the
/// English fallback. Each defines a light and a dark palette, identical when
/// the theme has one design, so switching appearance never half-applies.
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
