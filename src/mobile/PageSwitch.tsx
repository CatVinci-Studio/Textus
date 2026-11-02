import { useSettings } from "../prefs/SettingsContext";
import "./PageSwitch.css";

/**
 * The phone's two pages, the document and Textus AI, as a capsule in the
 * title row. The pill slides between halves of equal width, so nothing is
 * measured.
 */
export function PageSwitch({
  ai,
  onChange,
}: {
  /** Textus AI's page is showing. */
  ai: boolean;
  onChange: (ai: boolean) => void;
}) {
  const { t } = useSettings();
  const page = (on: boolean, label: string) => (
    <button
      type="button"
      aria-pressed={ai === on}
      onClick={() => {
        if (ai !== on) onChange(on);
      }}
    >
      {label}
    </button>
  );
  return (
    <div
      className="page-switch"
      role="group"
      aria-label={t.phonePages}
      data-ai={ai || undefined}
    >
      <span className="page-switch-thumb" />
      {page(false, t.phonePageWrite)}
      {page(true, t.phonePageAi)}
    </div>
  );
}
