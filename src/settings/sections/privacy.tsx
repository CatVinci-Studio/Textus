import { SettingsGroup } from "../pages/SettingsGroup";
import { explainError } from "../../utils/error-explain";
import { useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { SettingRow, ToggleRow } from "./controls";
import { showConfirm, showMessage } from "../../engine/controls/app-dialog";
import { CheckIcon } from "../../engine/controls/icons";
import { clearAllConversations } from "../../ai/chat/chat-history";
import { drafts } from "../../platform/ipc";
import { hasTextusAi, isDesktopApp } from "../../platform/capabilities";
import { SettingsFileSection } from "./settings-file";

// Settings > Privacy & Data: the chat history's switch and clear, then the
// data the app keeps: recovery drafts, and the settings file that can carry
// the AI history away. A switch off only stops new writes; a clear can't be
// undone, so it asks first.

function ClearRow({
  label,
  action,
  warning,
  t,
  onClear,
}: {
  label: string;
  /** The button's word, the row's verb: Clear a history, Delete drafts. */
  action: string;
  warning: string;
  t: Strings;
  onClear: () => Promise<unknown> | void;
}) {
  const [cleared, setCleared] = useState(false);

  async function clear() {
    const ok = await showConfirm(warning, {
      title: label,
      okLabel: action,
      cancelLabel: t.cancel,
      danger: true,
    });
    if (!ok) return;
    try {
      await onClear();
      setCleared(true);
    } catch (err) {
      await showMessage(explainError(err, t), { tone: "error" });
    }
  }

  // The button stays enabled: it holds the focus the confirm dialog handed
  // back, and disabling it would drop focus to <body>, where Escape is lost.
  return (
    <SettingRow label={label}>
      <button
        className="tx-button text-button settings-inline-button settings-danger-button"
        aria-label={`${action}: ${label}`}
        onClick={() => void clear()}
      >
        {cleared ? <CheckIcon /> : action}
      </button>
    </SettingRow>
  );
}

export function PrivacySection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();

  return (
    <>
      {hasTextusAi && (
        <SettingsGroup title={t.privacyChatHistoryLabel}>
          <ToggleRow
            label={t.privacyChatHistoryToggle}
            checked={settings.enableChatHistory}
            onChange={(v) => setSettings({ enableChatHistory: v })}
          />
          <ClearRow
            label={t.privacyClearChatHistory}
            action={t.privacyClearButton}
            warning={t.privacyChatHistoryClearHint}
            t={t}
            onClear={clearAllConversations}
          />
        </SettingsGroup>
      )}

      <SettingsGroup title={t.privacyDataLabel}>
        <ClearRow
          label={t.privacyClearDrafts}
          action={t.privacyClearButton}
          warning={t.privacyDraftRecoveryClearHint}
          t={t}
          onClear={() => drafts.clearAllDrafts()}
        />
        {isDesktopApp && <SettingsFileSection t={t} />}
      </SettingsGroup>
    </>
  );
}
