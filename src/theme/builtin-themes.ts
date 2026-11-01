import type { TextKey } from "../i18n/strings";

/// The one built-in content theme: Textus's own look. Other looks are themes
/// from the gallery or imported CSS; a setting naming a withdrawn built-in
/// (Paper, Slate, Forest, Parchment) falls back to this one.
export type BuiltinContentThemeId = "default";

/// `nameKey` gives the picker label in the app language; `name` is the
/// English fallback.
export const BUILTIN_CONTENT_THEMES: {
  id: BuiltinContentThemeId;
  name: string;
  nameKey: TextKey;
}[] = [{ id: "default", name: "Default", nameKey: "themeNameDefault" }];
