import { useSettings } from "../../settings/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { CloseIcon } from "../../ui/icons";
import { isMagicDiary } from "./diary-mode";

/** The way out of the diary that anyone can find: five taps on About's
 *  version open it, but closing it the same way only works for someone who
 *  remembers how they got in. It does what those taps do - the setting goes
 *  off, the plugin stands down any reply it is writing (its update sees
 *  `enabled()` turn false), and the user's own theme is back. Styled in
 *  theme/magic-diary-page.css. */
export function DiaryLeaveButton({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  if (!isMagicDiary(settings)) return null;
  return (
    <div className="magic-diary-leave-anchor">
      <button
        type="button"
        className="icon-button magic-diary-leave"
        title={t.diaryLeave}
        aria-label={t.diaryLeave}
        onClick={() => setSettings({ enableDiary: false })}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
