import { useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useSettings } from "../settings/SettingsContext";
import { announce } from "../ui/announce";
import { AssistantIcon } from "../ui/icons";
import { Tooltip } from "../ui/Tooltip";
import { Presence } from "../ui/usePresence";
import { ContextMenu } from "../editor/ContextMenu";
import "./textus-ai-switch.css";

/** How long "Pause for an hour" keeps Textus AI off. */
export const TEXTUS_AI_PAUSE_MS = 60 * 60 * 1000;

/** Textus AI's master switch (Settings.textusAi) and the ways to flip it.
 *  Turning it on or off clears a pause; `pause` turns it off until
 *  Settings.textusAiResumeAt, when useTextusAiResume turns it back on.
 *  `toggle` says the new state aloud: it is for the menu and the
 *  shortcut, where nothing on screen under the focus changes. */
export function useTextusAi() {
  const { t, settings, setSettings } = useSettings();
  const on = settings.textusAi;
  const set = (next: boolean) =>
    setSettings({ textusAi: next, textusAiResumeAt: null });
  return {
    on,
    resumeAt: on ? null : settings.textusAiResumeAt,
    set,
    pause: () => {
      setSettings({
        textusAi: false,
        textusAiResumeAt: Date.now() + TEXTUS_AI_PAUSE_MS,
      });
      announce(t.announceTextusAiOff);
    },
    toggle: () => {
      set(!on);
      announce(on ? t.announceTextusAiOff : t.announceTextusAiOn);
    },
  };
}

/** Ends a pause when its time comes - also one that ran out while Textus
 *  was closed, at launch. Mounted once, in the main window. */
export function useTextusAiResume() {
  const { settings, setSettings } = useSettings();
  const { textusAi, textusAiResumeAt } = settings;
  useEffect(() => {
    if (textusAi || textusAiResumeAt === null) return;
    const resume = () =>
      setSettings({ textusAi: true, textusAiResumeAt: null });
    const wait = textusAiResumeAt - Date.now();
    if (wait <= 0) {
      resume();
      return;
    }
    // A timer longer than 2^31 ms fires at once; a pause is an hour.
    const timer = window.setTimeout(resume, Math.min(wait, 2 ** 31 - 1));
    return () => window.clearTimeout(timer);
  }, [textusAi, textusAiResumeAt, setSettings]);
}

/**
 * Textus AI's one button in the window bar (#196): a speech bubble that
 * opens the AI panel, struck through while Textus AI is off. Right-click
 * pauses it for an hour or turns it off; while it is off, a click offers
 * to turn it back on. Settings › Textus AI, View › Textus AI and the
 * shortcut flip the same switch.
 */
export function TextusAiButton({
  className,
  panelOpen,
  showPanel,
  shortcut,
  onTogglePanel,
}: {
  className: string;
  panelOpen: boolean;
  /** The AI panel can be opened: chat is on, or the tour needs it. */
  showPanel: boolean;
  /** The AI panel's shortcut, as shown in the tooltip. */
  shortcut: string;
  onTogglePanel: () => void;
}) {
  const { t } = useSettings();
  const ai = useTextusAi();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  // On with chat turned off there is nothing to open, and the switch is
  // in Settings, as before.
  if (ai.on && !showPanel) return null;

  const openMenu = (e: MouseEvent<HTMLButtonElement>, atPointer: boolean) => {
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    setMenu(
      atPointer
        ? { x: e.clientX, y: e.clientY }
        : { x: box.left, y: box.bottom + 2 },
    );
  };
  const until = ai.resumeAt
    ? new Date(ai.resumeAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const tip = ai.on
    ? `${t.agentPanelTitle} (${shortcut}) · ${t.textusAiMenuHint}`
    : until
      ? t.textusAiPausedTooltip.replace("{time}", until)
      : t.textusAiOffTooltip;
  const items = ai.on
    ? [
        { label: t.textusAiPause, onSelect: ai.pause },
        { label: t.textusAiTurnOff, onSelect: () => ai.toggle() },
      ]
    : [{ label: t.textusAiTurnOn, onSelect: () => ai.toggle() }];

  return (
    <>
      <Tooltip text={tip}>
        <button
          type="button"
          className={`${className}${ai.on && panelOpen ? " window-bar-toggle-on" : ""}${ai.on ? "" : " textus-ai-button-off"}`}
          aria-pressed={ai.on ? panelOpen : undefined}
          aria-label={ai.on ? t.agentPanelTitle : t.textusAiOff}
          aria-haspopup="menu"
          onClick={(e) => (ai.on ? onTogglePanel() : openMenu(e, false))}
          onContextMenu={(e) => openMenu(e, e.button === 2)}
        >
          <AssistantIcon off={!ai.on} />
        </button>
      </Tooltip>
      {/* On <body>: the bar's status group takes no pointer events. */}
      {createPortal(
        <Presence show={menu !== null} exitMs={120}>
          {menu && (
            <ContextMenu
              x={menu.x}
              y={menu.y}
              title={t.agentPanelTitle}
              items={items}
              onClose={() => setMenu(null)}
            />
          )}
        </Presence>,
        document.body,
      )}
    </>
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
