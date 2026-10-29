import { useEffect, useRef } from "react";
import { registerCommand } from "./commands";
import { showQuickPick } from "../ui/quick-pick";
import { BUILTIN_CONTENT_THEMES } from "../theme/builtin-themes";
import { THEME_MODES, type Settings } from "../prefs/SettingsContext";
import { currentStrings } from "../i18n/current";

/**
 * The settings most often changed, as commands for the command palette:
 * the appearance, the editor theme, and Textus AI on or off.
 */
export function useSettingsCommands(
  settings: Settings,
  setSettings: (patch: Partial<Settings>) => void,
): void {
  const latest = useRef({ settings, setSettings });
  latest.current = { settings, setSettings };

  useEffect(() => {
    const set = (patch: Partial<Settings>) => latest.current.setSettings(patch);
    const pick = async <T>(items: { label: string; value: T }[]) =>
      (await showQuickPick(items, "")) as T | null;
    const offs = [
      registerCommand({
        id: "textus.appearance",
        title: (t) => `${t.appearanceLabel}…`,
        run: () => {
          const t = currentStrings();
          const names = {
            system: t.appearanceSystem,
            light: t.appearanceLight,
            dark: t.appearanceDark,
          };
          void pick(
            THEME_MODES.map((mode) => ({ label: names[mode], value: mode })),
          ).then((theme) => theme && set({ theme }));
        },
      }),
      registerCommand({
        id: "textus.editorTheme",
        title: (t) => `${t.contentThemeLabel}…`,
        run: () => {
          const t = currentStrings();
          void pick([
            ...BUILTIN_CONTENT_THEMES.map((theme) => ({
              label: t[theme.nameKey],
              value: theme.id,
            })),
            ...latest.current.settings.userThemes.map((theme) => ({
              label: theme.name,
              value: theme.id,
            })),
          ]).then((themeId) => themeId && set({ themeId }));
        },
      }),
      registerCommand({
        id: "textus.toggleTextusAi",
        title: (t) => t.shortcutToggleTextusAi,
        run: () => set({ textusAi: !latest.current.settings.textusAi }),
      }),
    ];
    return () => offs.forEach((off) => off());
  }, []);
}
