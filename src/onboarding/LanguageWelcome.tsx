import { useModalDialog } from "../ui/useModalDialog";
import { Select } from "../ui/Select";
import { usePresenceProps } from "../ui/usePresence";
import appIcon from "../../src-tauri/icons/128x128@2x.png";
import { LANGS, LANG_NAMES, resolveStrings, type Lang } from "../i18n/strings";
import "./LanguageWelcome.css";

export function LanguageWelcome({
  language,
  onLanguage,
  onContinue,
}: {
  language: Lang;
  onLanguage: (language: Lang) => void;
  onContinue: () => void;
}) {
  // In the language being picked, so the choice reads back at once.
  const t = resolveStrings(language);
  const modal = useModalDialog(() => {}, true, ".language-welcome-continue");
  // Continue fades it out over the tutorial arriving.
  const presence = usePresenceProps<HTMLDivElement>();
  return (
    <div {...presence} className="language-welcome-backdrop">
      <div
        {...modal}
        className="language-welcome"
        role="dialog"
        aria-modal="true"
        aria-labelledby="language-welcome-title"
      >
        <img className="language-welcome-mark" src={appIcon} alt="" />
        <div className="language-welcome-eyebrow">{t.tutorialWelcomeTitle}</div>
        <h1 id="language-welcome-title">{t.languageWelcomeTitle}</h1>
        <p>{t.languageWelcomeBody}</p>
        {/* A dropdown, not a row of buttons: ten languages don't fit a
            phone's width side by side. Each is named in itself. */}
        <Select
          className="settings-select language-welcome-select"
          aria-label={t.languageLabel}
          value={language}
          onChange={(e) => onLanguage(e.target.value as Lang)}
        >
          {LANGS.map((lang) => (
            <option key={lang} value={lang}>
              {LANG_NAMES[lang]}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className="language-welcome-continue"
          onClick={onContinue}
        >
          {t.tutorialNext}
          <span aria-hidden>→</span>
        </button>
      </div>
    </div>
  );
}
