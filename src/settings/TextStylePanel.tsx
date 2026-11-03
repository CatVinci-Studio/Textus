import { resolveStrings } from "../i18n/strings";
import { useSettings } from "../prefs/SettingsContext";
import { CloseIcon } from "../ui/icons";
import { usePresenceProps } from "../ui/usePresence";
import { useCloseOnOutsideClick } from "../utils/hooks/useCloseOnOutsideClick";
import { TextFontRows } from "./sections/text-font";
import "./TextStylePanel.css";

/** View › Text Style…: the document's size, spacing and font beside the
 *  document, without dimming it, so each change shows as it is made. The
 *  rows are Settings › Editor & Appearance's own. */
export function TextStylePanel({
  onClose,
  onMore,
}: {
  onClose: () => void;
  /** Opens Settings at those rows, for the rest of the page. */
  onMore: () => void;
}) {
  const { settings, setSettings } = useSettings();
  const t = resolveStrings(settings.language);
  // The font list is portalled; a click in it still counts as inside.
  const ref = useCloseOnOutsideClick<HTMLDivElement>(onClose, true);
  const presence = usePresenceProps(ref);
  return (
    <div
      {...presence}
      className="text-style-panel floating-surface"
      role="dialog"
      aria-label={t.textStyleTitle}
    >
      <div className="text-style-header">
        <h2 className="text-style-title">{t.textStyleTitle}</h2>
        <button
          type="button"
          className="tx-icon-button"
          aria-label={t.windowClose}
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>
      <TextFontRows t={t} settings={settings} setSettings={setSettings} />
      <button
        type="button"
        className="text-button text-style-more"
        onClick={onMore}
      >
        {t.textStyleMore}
      </button>
    </div>
  );
}
