import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMakeTheme, useStartingTheme } from "./useWorkshopTheme";
import { fill } from "../../i18n/fill";
import type { Strings } from "../../i18n/strings";
import { useSettings } from "../../prefs/SettingsContext";
import { isEffectiveDark } from "../../theme/imported-theme";
import type { ThemeCss } from "../../theme/builtin-base";
import { NO_CHOICES, type TypeChoices } from "../../theme/theme-typography";
import { WorkshopControls } from "./WorkshopControls";
import { useWorkshopPreview } from "./useWorkshopPreview";
import "../SettingsPanel.css";
import "./theme-workshop.css";

/** What goes to the AI: the theme as made, to carry on from. */
function askAiText(t: Strings, name: string, css: ThemeCss): string {
  const files = [css.light, css.dark].filter((f): f is string => !!f);
  return [
    fill(t.workshopAskAiMessage, { name }),
    ...files.map((file) => "```css\n" + file.trim() + "\n```"),
  ].join("\n\n");
}

/**
 * Create › Theme, without the AI: a theme the user has, its document's type
 * and palettes set beside a page that shows them, then saved as a theme of
 * the user's own - over it only when the workshop made it. The window
 * around the document keeps the starting theme's colours.
 */
export function ThemeWorkshop({
  t,
  head,
  start: startFrom,
  onAskAi,
}: {
  t: Strings;
  /** Above it: the switch to describing a theme to the AI. */
  head?: ReactNode;
  /** The theme it opens on; the one in use if none. */
  start?: string;
  onAskAi: (text: string) => void;
}) {
  const { settings } = useSettings();
  const [start, setStart] = useState(startFrom ?? settings.themeId);
  const [choices, setChoices] = useState<TypeChoices>(NO_CHOICES);
  const frame = useRef<HTMLIFrameElement>(null);
  const loaded = useStartingTheme(start, t);
  const making = useMakeTheme(t);
  // A workshop theme opens as it was left; any other with nothing set.
  useEffect(() => {
    if (loaded) setChoices(loaded.choices);
  }, [loaded]);
  const dark = isEffectiveDark(settings.theme);
  const measured = useWorkshopPreview(
    frame,
    settings,
    t.workshopPreviewLabel,
    loaded?.base ?? null,
    dark,
    choices,
  );
  const change = (patch: Partial<TypeChoices>) => {
    setChoices((now) => ({ ...now, ...patch }));
    making.clear();
  };
  // Only a theme made here is saved over; any other stays as it came.
  const ownTheme = settings.userThemes.some(
    (theme) => theme.id === start && theme.workshop,
  );
  const save = async (over: boolean) => {
    if (!loaded) return;
    const made = await making.make(
      { ...loaded, choices },
      measured?.stacks,
      over ? start : null,
    );
    // Carries on from what was made: the next save can go over it.
    if (made) setStart(made);
  };

  return (
    <div className="create-studio theme-workshop-studio">
      {head}
      <div className="theme-workshop">
        <div className="theme-workshop-controls">
          <div className="theme-workshop-rows">
            <WorkshopControls
              t={t}
              settings={settings}
              start={start}
              onStart={(id) => {
                setStart(id);
                making.clear();
              }}
              choices={choices}
              onChoice={change}
              measured={measured?.measures ?? null}
              dark={dark}
            />
          </div>
          {making.error && <p className="settings-error">{making.error}</p>}
          <div className="theme-workshop-actions">
            <button
              type="button"
              className="tx-button"
              disabled={making.busy}
              onClick={() => change(NO_CHOICES)}
            >
              {t.workshopReset}
            </button>
            <button
              type="button"
              className={ownTheme ? "tx-button" : "tx-button primary"}
              disabled={making.busy || !loaded}
              onClick={() => void save(false)}
            >
              {ownTheme ? t.workshopSaveNew : t.workshopGenerate}
            </button>
            {ownTheme && (
              <button
                type="button"
                className="tx-button primary"
                disabled={making.busy || !loaded}
                onClick={() => void save(true)}
              >
                {t.workshopSaveOver}
              </button>
            )}
          </div>
          {making.made && (
            <div className="theme-workshop-made" role="status">
              <span>{fill(t.workshopMade, { name: making.made.name })}</span>
              {settings.textusAi && (
                <button
                  type="button"
                  className="tx-button text-button settings-inline-button"
                  onClick={() =>
                    making.made &&
                    onAskAi(askAiText(t, making.made.name, making.made.css))
                  }
                >
                  {t.workshopAskAi}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="theme-workshop-preview">
          <iframe
            ref={frame}
            title={t.workshopPreviewLabel}
            className="theme-workshop-frame"
            sandbox="allow-same-origin"
          />
        </div>
      </div>
    </div>
  );
}
