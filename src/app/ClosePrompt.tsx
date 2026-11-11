import { ActionSheet } from "../engine/controls/ActionSheet";
import { Presence, PresenceDiv } from "../engine/motion/usePresence";
import type { useModalDialog } from "../engine/controls/useModalDialog";
import type { Strings } from "../i18n/strings";

/** The save/discard/cancel prompt: a dialog on the desktop, an action sheet
 *  on a phone. */
export function ClosePrompt({
  open,
  phone,
  dialogProps,
  onSave,
  onDiscard,
  onCancel,
  name,
  t,
}: {
  open: boolean;
  /** The document closing, named in the question; none for a window. */
  name?: string | null;
  phone: boolean;
  /** useModalDialog's wiring for the desktop dialog. */
  dialogProps: ReturnType<typeof useModalDialog>;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  t: Strings;
}) {
  const message = name
    ? t.closePromptNamed.replace("{name}", name)
    : t.closePromptMessage;
  return (
    <>
      <Presence show={open && phone}>
        {open && phone && (
          // The sheet runs its onClose before the chosen action; the
          // handlers still hold the pending close they were rendered with.
          <ActionSheet
            title={message}
            items={[
              {
                label: t.closePromptSave,
                onSelect: onSave,
              },
              {
                label: t.closePromptDiscard,
                danger: true,
                onSelect: onDiscard,
              },
            ]}
            onClose={onCancel}
          />
        )}
      </Presence>
      <Presence show={open && !phone}>
        {open && !phone && (
          <PresenceDiv className="close-prompt-overlay">
            <div
              className="close-prompt"
              {...dialogProps}
              role="dialog"
              aria-modal="true"
              aria-label={message}
            >
              <p>{message}</p>
              <div className="close-prompt-buttons">
                <button className="close-prompt-discard" onClick={onDiscard}>
                  {t.closePromptDiscard}
                </button>
                <div className="close-prompt-spacer" />
                <button onClick={onCancel}>{t.closePromptCancel}</button>
                <button
                  className="close-prompt-primary"
                  autoFocus
                  onClick={onSave}
                >
                  {t.closePromptSave}
                </button>
              </div>
            </div>
          </PresenceDiv>
        )}
      </Presence>
    </>
  );
}
