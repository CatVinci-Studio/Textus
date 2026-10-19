import { useMemo, useRef, useState } from "react";
import { useSettings } from "../../settings/SettingsContext";
import { themesInReply, type ReplyTheme } from "../../theme/chat-theme";
import { saveUserTheme, withUserTheme } from "../../theme/theme-import";
import { showMessage } from "../../ui/app-dialog";
import { useLatest } from "../../utils/hooks/useLatest";
import { errorText } from "../../utils/error-text";

export interface ReplyThemeLabels {
  useTheme: string;
  themeInUse: string;
  /** The name a theme gets when its CSS doesn't give one. */
  themeFallbackName: string;
}

/**
 * "Use this theme" under a reply that wrote one (the `theme` skill): saves
 * the ```css block as a user theme and switches to it, as Import CSS…
 * does with a file. Once installed, the button switches back to that copy
 * rather than saving another.
 */
export function ReplyThemes({
  text,
  labels,
}: {
  text: string;
  labels: ReplyThemeLabels;
}) {
  const themes = useMemo(() => themesInReply(text), [text]);
  if (themes.length === 0) return null;
  return (
    <>
      {themes.map((theme, i) => (
        <ReplyThemeChip key={i} theme={theme} labels={labels} />
      ))}
    </>
  );
}

function ReplyThemeChip({
  theme,
  labels,
}: {
  theme: ReplyTheme;
  labels: ReplyThemeLabels;
}) {
  const { settings, setSettings } = useSettings();
  const latest = useLatest(settings);
  const [installedId, setInstalledId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const name = theme.name ?? labels.themeFallbackName;
  const installed = installedId
    ? settings.userThemes.some((th) => th.id === installedId)
    : false;
  const inUse = installed && settings.themeId === installedId;

  async function use() {
    if (working.current) return;
    if (installed && installedId) {
      setSettings({ themeId: installedId });
      return;
    }
    working.current = true;
    setBusy(true);
    try {
      const meta = await saveUserTheme(theme.css, { name });
      setInstalledId(meta.id);
      setSettings({
        userThemes: withUserTheme(latest.current.userThemes, meta),
        themeId: meta.id,
      });
    } catch (err) {
      await showMessage(errorText(err), { tone: "error" });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="agent-theme-chip">
      <span className="agent-theme-chip-name">{name}</span>
      <button type="button" disabled={busy || inUse} onClick={() => void use()}>
        {inUse ? labels.themeInUse : labels.useTheme}
      </button>
    </div>
  );
}
