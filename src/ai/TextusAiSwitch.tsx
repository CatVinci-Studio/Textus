import { useSettings } from "../settings/SettingsContext";
import { announce } from "../ui/announce";
import { SwitchIcon } from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";
import "./textus-ai-switch.css";

/** Textus AI's master switch (Settings.textusAi) and the ways to flip it.
 *  `toggle` says the new state aloud: it is for the menu and the shortcut,
 *  where nothing on screen under the focus changes. */
export function useTextusAi() {
  const { t, settings, setSettings } = useSettings();
  const on = settings.textusAi;
  const set = (next: boolean) => setSettings({ textusAi: next });
  return {
    on,
    set,
    toggle: () => {
      set(!on);
      announce(on ? t.announceTextusAiOff : t.announceTextusAiOn);
    },
  };
}

/**
 * The switch at the right end of the window bar and in the detached AI
 * window's header (#196): lit while Textus AI is on, dim while it is off,
 * and one click turns it the other way. Beside it, the robot still opens
 * the AI panel - one button, one job each.
 */
export function TextusAiSwitch({ className }: { className: string }) {
  const { t } = useSettings();
  const { on, set } = useTextusAi();
  return (
    <Tooltip text={on ? t.textusAiOnTooltip : t.textusAiOffTooltip}>
      <button
        type="button"
        className={`${className} textus-ai-switch${on ? " textus-ai-switch-on" : ""}`}
        aria-pressed={on}
        aria-label={t.textusAiToggleLabel}
        onClick={() => set(!on)}
      >
        <SwitchIcon />
      </button>
    </Tooltip>
  );
}

/** What an AI surface shows in its place while Textus AI is off: that it
 *  is off, and the way to turn it back on. */
export function TextusAiOffNote({ className }: { className?: string }) {
  const { t } = useSettings();
  const { set } = useTextusAi();
  return (
    <div className={className ? `textus-ai-off ${className}` : "textus-ai-off"}>
      <p>{t.textusAiOff}</p>
      <button type="button" className="text-button" onClick={() => set(true)}>
        {t.textusAiTurnOn}
      </button>
    </div>
  );
}
