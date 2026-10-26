import { ActionSheet } from "../ui/ActionSheet";
import { Presence, PresenceDiv } from "../ui/usePresence";
import type { useModalDialog } from "../ui/useModalDialog";
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
  t,
}: {
  open: boolean;
  phone: boolean;
  /** useModalDialog's wiring for the desktop dialog. */
  dialogProps: ReturnType<typeof useModalDialog>;
  onSave: () => void;
  onDiscard: () => void;
  onCancel: () => void;
  t: Strings;
}) {
  return (
    <>
      <Presence show={open && phone} exitMs={250}>
        {open && phone && (
          // The sheet runs its onClose before the chosen action; the
          // handlers still hold the pending close they were rendered with.
          <ActionSheet
            title={t.closePromptMessage}
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
      <Presence show={open && !phone} exitMs={120}>
        {open && !phone && (
          <PresenceDiv className="close-prompt-overlay">
            <div
              className="close-prompt"
              {...dialogProps}
              role="dialog"
              aria-modal="true"
              aria-label={t.closePromptMessage}
            >
              <p>{t.closePromptMessage}</p>
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
