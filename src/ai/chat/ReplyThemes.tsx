import { useMemo, useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { themesInReply, type ReplyTheme } from "./reply-theme";
import { saveUserTheme, withUserTheme } from "../../theme/theme-import";
import { ReplyFilesPreview } from "./ReplyFilesPreview";
import { useCreationAction } from "./useCreationAction";

export interface ReplyThemeLabels {
  useTheme: string;
  themeInUse: string;
  /** The name a theme gets when its CSS doesn't give one. */
  themeFallbackName: string;
  /** Unfolds the CSS Use would apply. */
  showCode: string;
}

/**
 * "Use this theme" under a reply that wrote one: saves the ```css block as a
 * user theme and switches to it. Once installed, it switches back to that copy.
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
  const [installedId, setInstalledId] = useState<string | null>(null);
  const { busy, run } = useCreationAction();
  const name = theme.name ?? labels.themeFallbackName;
  const installed = installedId
    ? settings.userThemes.some((th) => th.id === installedId)
    : false;
  const inUse = installed && settings.themeId === installedId;

  function use() {
    if (installed && installedId) return setSettings({ themeId: installedId });
    void run(async () => {
      const meta = await saveUserTheme(theme.css, { name });
      setInstalledId(meta.id);
      return {
        made: { kind: "theme", id: meta.id, name },
        settings: (now) => ({
          userThemes: withUserTheme(now.userThemes, meta),
          themeId: meta.id,
        }),
      };
    });
  }

  return (
    <div className="agent-theme-chip">
      <span className="agent-theme-chip-name">{name}</span>
      <button type="button" disabled={busy || inUse} onClick={use}>
        {inUse ? labels.themeInUse : labels.useTheme}
      </button>
      <ReplyFilesPreview
        label={labels.showCode}
        files={[{ path: null, text: theme.css }]}
      />
    </div>
  );
}
