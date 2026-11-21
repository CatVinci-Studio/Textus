import { useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "../../engine/controls/useModalDialog";
import { Presence, usePresenceProps } from "../../engine/motion/usePresence";
import { DialogActions } from "../../engine/controls/DialogActions";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { RowHelp } from "./controls";
import "./custom-css-dialog.css";

const PLACEHOLDER = `#write > p {
  text-indent: 2em;
  line-height: 2;
}`;

/** The user's own CSS over the theme, written as it applies. */
function CustomCssBox({ t, onClose }: { t: Strings; onClose: () => void }) {
  const { settings, setSettings } = useSettings();
  const modal = useModalDialog(onClose, true, "textarea");
  const presence = usePresenceProps<HTMLDivElement>();
  const titleId = useId();
  return (
    <div
      {...presence}
      className="tx-backdrop custom-css-overlay"
      onClick={onClose}
    >
      <div
        {...modal}
        className="close-prompt custom-css-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="custom-css-title">
          <span id={titleId}>{t.customCssLabel}</span>
          <RowHelp label={t.customCssLabel}>{t.customCssHint}</RowHelp>
        </div>
        <textarea
          className="tx-input settings-code-input custom-css-input"
          aria-labelledby={titleId}
          spellCheck={false}
          rows={12}
          placeholder={PLACEHOLDER}
          value={settings.customCss}
          onChange={(e) => setSettings({ customCss: e.target.value })}
        />
        <DialogActions className="custom-css-buttons">
          <button className="tx-button primary" onClick={onClose}>
            {t.customCssDone}
          </button>
        </DialogActions>
      </div>
    </div>
  );
}

/** Installed themes › ⋯ › Custom CSS…: kept for those who write their
 *  own, out of the Appearance page. The dialog, and what opens it. */
export function useCustomCssDialog(t: Strings): {
  open: () => void;
  dialog: ReactNode;
} {
  const [shown, setShown] = useState(false);
  return {
    open: () => setShown(true),
    dialog: createPortal(
      <Presence show={shown}>
        {shown && <CustomCssBox t={t} onClose={() => setShown(false)} />}
      </Presence>,
      document.body,
    ),
  };
}
