import type { TextKey } from "../i18n/strings";

/// Built-in content themes override `--doc-*` variables (the frame themes
/// also paint the frame: theme/frame-themes.css); "default"
/// means none are active. A setting naming a withdrawn one (Parchment)
/// falls back to the default.
type BuiltinContentThemeId =
  "default" | "paper" | "slate" | "forest" | "aurora";

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
  // A gradient across the frame (theme/frame-themes.css).
  { id: "aurora", name: "Aurora", nameKey: "themeNameAurora" },
];
