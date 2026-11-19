import { fill } from "../i18n/fill";
import { ActionSheet } from "../engine/controls/ActionSheet";
import { Presence, PresenceDiv } from "../engine/motion/usePresence";
import type { useModalDialog } from "../engine/controls/useModalDialog";
import type { Strings } from "../i18n/strings";
import { DialogActions } from "../engine/controls/DialogActions";

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
    ? fill(t.closePromptNamed, { name })
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
          <PresenceDiv className="tx-backdrop">
            <div
              className="close-prompt"
              {...dialogProps}
              role="dialog"
              aria-modal="true"
              aria-label={message}
            >
              <p>{message}</p>
              <DialogActions
                start={
                  <button
                    className="tx-button close-prompt-discard"
                    onClick={onDiscard}
                  >
                    {t.closePromptDiscard}
                  </button>
                }
              >
                <button className="tx-button" onClick={onCancel}>
                  {t.cancel}
                </button>
                <button
                  className="tx-button primary close-prompt-primary"
                  autoFocus
                  onClick={onSave}
                >
                  {t.closePromptSave}
                </button>
              </DialogActions>
            </div>
          </PresenceDiv>
        )}
      </Presence>
    </>
  );
}
