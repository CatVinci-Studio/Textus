import type { TextKey } from "../i18n/strings";

/// Built-in content themes only override `--doc-*` variables; "default"
/// means none are active. A setting naming a withdrawn one (Parchment)
/// falls back to the default.
export type BuiltinContentThemeId = "default" | "paper" | "slate" | "forest";

/// `nameKey` gives the picker label in the app language; `name` is the
/// English fallback. Each defines a light and a dark palette, so switching
/// appearance never half-applies.
export const BUILTIN_CONTENT_THEMES: {
  id: BuiltinContentThemeId;
  name: string;
  nameKey: TextKey;
}[] = [
  { id: "default", name: "Default", nameKey: "themeNameDefault" },
  { id: "paper", name: "Paper", nameKey: "themeNamePaper" },
  { id: "slate", name: "Slate", nameKey: "themeNameSlate" },
  { id: "forest", name: "Forest", nameKey: "themeNameForest" },
];
