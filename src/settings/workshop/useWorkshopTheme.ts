import { useEffect, useState } from "react";
import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";
import { currentStrings } from "../../i18n/current";
import { useSettings, type Settings } from "../../prefs/SettingsContext";
import { BUILTIN_CONTENT_THEMES } from "../../prefs/builtin-themes";
import { showPrompt } from "../../engine/controls/app-dialog";
import type { ThemeCss } from "../../theme/builtin-base";
import { typeFonts, type FontStacks } from "../../theme/theme-typography";
import { themeFontFaces } from "../../theme/supplied-font";
import {
  installWorkshopTheme,
  startingTheme,
} from "../../theme/workshop-install";
import type { WorkshopTheme } from "../../theme/workshop-theme";
import { useLatest } from "../../utils/hooks/useLatest";
import { explainError } from "../../utils/error-explain";
import { chromePins } from "./preview-frame";

/** A theme's name as the pickers show it. */
function themeName(t: Strings, settings: Settings, id: string): string {
  const builtin = BUILTIN_CONTENT_THEMES.find((theme) => theme.id === id);
  if (builtin) return t[builtin.nameKey] as string;
  return settings.userThemes.find((theme) => theme.id === id)?.name ?? id;
}

/** The starting theme, loaded again when another is picked: a workshop
 *  theme with its choices as left. */
export function useStartingTheme(id: string, t: Strings): WorkshopTheme | null {
  const { settings } = useSettings();
  const [theme, setTheme] = useState<WorkshopTheme | null>(null);
  const latest = useLatest(settings);
  useEffect(() => {
    let live = true;
    const now = latest.current;
    void startingTheme(id, now.userThemes, themeName(t, now, id))
      .catch(() => null)
      .then((loaded) => live && setTheme(loaded));
    return () => {
      live = false;
    };
  }, [id, t, latest]);
  return theme;
}

/** Saves the workshop's theme: as a new one, named here, or over the
 *  workshop theme it started from. Puts it in use. */
export function useMakeTheme(t: Strings) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{
    id: string;
    name: string;
    css: ThemeCss;
  } | null>(null);
  const make = async (
    theme: WorkshopTheme,
    stacks: FontStacks | undefined,
    over: string | null,
  ): Promise<string | null> => {
    const name = over
      ? theme.name
      : (
          await showPrompt(
            t.workshopNameAsk,
            fill(t.workshopNameDefault, { theme: theme.name }),
            { okLabel: t.workshopGenerate, cancelLabel: t.cancel },
          )
        )?.trim();
    if (!name) return null;
    setBusy(true);
    setError(null);
    try {
      const pins = theme.choices.palette ? chromePins(theme.base) : undefined;
      const faces = await themeFontFaces(typeFonts(theme.choices));
      const done = await installWorkshopTheme(
        { ...theme, name },
        stacks,
        pins,
        latest.current.userThemes,
        over ?? undefined,
        faces,
      );
      setSettings(done.settings);
      setMade({ id: done.settings.themeId, name, css: done.css });
      return done.settings.themeId;
    } catch (err) {
      setError(explainError(err, currentStrings()));
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, made, clear: () => setMade(null), make };
}
