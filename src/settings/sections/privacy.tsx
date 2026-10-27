import { useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { SettingRow, ToggleRow } from "./controls";
import { showConfirm } from "../../ui/app-dialog";
import { CheckIcon } from "../../ui/icons";
import { clearAllConversations } from "../../ai/chat/chat-history";
import { clearClipboardHistory } from "../../clipboard/history";
import { drafts } from "../../platform/ipc";

// Settings > Privacy: a switch per kind of local history, plus a clear. A
// switch off only stops new writes; a clear can't be undone, so it asks first.

function ClearRow({
  label,
  warning,
  t,
  onClear,
}: {
  label: string;
  warning: string;
  t: Strings;
  onClear: () => void;
}) {
  const [cleared, setCleared] = useState(false);

  async function clear() {
    const ok = await showConfirm(warning, {
      title: label,
      okLabel: t.privacyClearButton,
      cancelLabel: t.cancel,
      danger: true,
    });
    if (!ok) return;
    onClear();
    setCleared(true);
  }

  // The button stays enabled: it holds the focus the confirm dialog handed
  // back, and disabling it would drop focus to <body>, where Escape is lost.
  return (
    <SettingRow label={label}>
      <button
        className="text-button settings-inline-button settings-danger-button"
        aria-label={`${t.privacyClearButton}: ${label}`}
        onClick={() => void clear()}
      >
        {cleared ? <CheckIcon /> : t.privacyClearButton}
      </button>
    </SettingRow>
  );
}

export function PrivacySection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();

  return (
    <>
      <section className="settings-group">
        <h2 className="settings-group-title">{t.privacyChatHistoryLabel}</h2>
        <div className="settings-group-body">
          <ToggleRow
            label={t.privacyChatHistoryToggle}
            checked={settings.enableChatHistory}
            onChange={(v) => setSettings({ enableChatHistory: v })}
          />
          <ClearRow
            label={t.privacyClearChatHistory}
            warning={t.privacyChatHistoryClearHint}
            t={t}
            onClear={clearAllConversations}
          />
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-title">
          {t.privacyClipboardHistoryLabel}
        </h2>
        <div className="settings-group-body">
          <ToggleRow
            label={t.privacyClipboardHistoryToggle}
            checked={settings.enableClipboardHistory}
            onChange={(v) => setSettings({ enableClipboardHistory: v })}
          />
          <ClearRow
            label={t.privacyClearClipboard}
            warning={t.privacyClipboardHistoryClearHint}
            t={t}
            onClear={clearClipboardHistory}
          />
        </div>
      </section>

      <section className="settings-group">
        <h2 className="settings-group-title">{t.privacyDraftRecoveryLabel}</h2>
        <div className="settings-group-body">
          <ToggleRow
            label={t.privacyDraftRecoveryToggle}
            checked={settings.enableDraftRecovery}
            onChange={(v) => setSettings({ enableDraftRecovery: v })}
          />
          {/* Kept as drafts: only while drafts are kept at all. */}
          {settings.enableDraftRecovery && (
            <ToggleRow
              label={t.privacyKeepUnsavedToggle}
              help={t.privacyKeepUnsavedHelp}
              checked={settings.keepUnsavedOnClose}
              onChange={(v) => setSettings({ keepUnsavedOnClose: v })}
            />
          )}
          <ClearRow
            label={t.privacyClearDrafts}
            warning={t.privacyDraftRecoveryClearHint}
            t={t}
            onClear={() => void drafts.clearAllDrafts()}
          />
        </div>
      </section>
    </>
  );
}
