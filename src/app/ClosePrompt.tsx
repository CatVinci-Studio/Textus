import { fill } from "../i18n/fill";
import { Presence, PresenceDiv } from "../engine/motion/usePresence";
import type { useModalDialog } from "../engine/controls/useModalDialog";
import type { Strings } from "../i18n/strings";
import { DialogActions } from "../engine/controls/DialogActions";

/** The save/discard/cancel prompt: the desktop's dialog, a phone's too. */
export function ClosePrompt({
  open,
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
  /** useModalDialog's wiring for the dialog. */
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
      <Presence show={open}>
        {open && (
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
