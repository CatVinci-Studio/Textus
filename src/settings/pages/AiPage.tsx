import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  COMPLETION_TONES,
  type CompletionTone,
  type AgentMode,
  type GrammarStrictness,
  type ProxyType,
  REVISION_DISPLAYS,
  type RevisionDisplay,
} from "../SettingsContext";
import {
  marginViewBlocked,
  revisionDisplayName,
} from "../../ai/revision/revision-display";
import { type TextKey } from "../../i18n/strings";
import { SettingRow, ToggleRow, VERBATIM_INPUT } from "../sections/controls";
import { ProviderListPanel } from "../sections/providers";
import { ImageModelSection } from "../sections/image-model";
import {
  AgentModelSection,
  SearchServiceSection,
  ModelListRow,
  WritingModelSection,
  AgentWorkspaceRootSection,
  AgentWorkspaceSection,
  AgentSystemPromptSection,
} from "../sections/agent";
import {
  AgentSkillsSection,
  BuiltinSkillsSection,
  WritingConventionsRow,
} from "../sections/skills";
import { Select } from "../../ui/Select";
import {
  canDetachChat,
  canPickFolder,
  canRevealInFileManager,
  isIOSApp,
} from "../../platform/capabilities";
import { openExtensionsTab } from "./extensions-tab";

/** Textus AI: its own switch, then the account and each feature beside the
 *  model it drives. With Textus AI off every other row is hidden, so none
 *  may reach a provider. */
export function AiPage({
  t,
  settings,
  setSettings,
  phone,
  marginAvailable,
  noMargin,
  onOpenFile,
  onFilesDeleted,
  onClose,
  openPage,
}: SettingsPageProps) {
  return (
    <>
      <SettingsGroup title={t.menuTextusAi}>
        <ToggleRow
          label={t.textusAiToggleLabel}
          hint={settings.textusAi ? undefined : t.textusAiOffHint}
          checked={settings.textusAi}
          onChange={(v) => setSettings({ textusAi: v })}
        />
      </SettingsGroup>
      {settings.textusAi && (
        <>
          <SettingsGroup title={t.aiAccountLabel}>
            <ProviderListPanel t={t} />
            <SettingRow label={t.proxyLabel}>
              <Select
                className="settings-select"
                aria-label={t.proxyLabel}
                value={settings.proxyType}
                onChange={(e) =>
                  setSettings({ proxyType: e.target.value as ProxyType })
                }
              >
                <option value="none">{t.proxyTypeNone}</option>
                <option value="http">HTTP</option>
                <option value="https">HTTPS</option>
                <option value="socks5">SOCKS5</option>
              </Select>
            </SettingRow>
            {settings.proxyType !== "none" && (
              <div className="settings-proxy-row">
                <input
                  type="text"
                  inputMode="url"
                  {...VERBATIM_INPUT}
                  className="settings-text-input settings-proxy-host"
                  placeholder={t.proxyHostPlaceholder}
                  aria-label={t.proxyHostPlaceholder}
                  value={settings.proxyHost}
                  onChange={(e) => setSettings({ proxyHost: e.target.value })}
                />
                <input
                  type="text"
                  inputMode="numeric"
                  {...VERBATIM_INPUT}
                  className="settings-text-input settings-proxy-port"
                  placeholder={t.proxyPortPlaceholder}
                  aria-label={t.proxyPortPlaceholder}
                  value={settings.proxyPort}
                  onChange={(e) => setSettings({ proxyPort: e.target.value })}
                />
              </div>
            )}
            <ModelListRow t={t} />
          </SettingsGroup>

          <SettingsGroup title={t.writingFeaturesLabel}>
            <WritingModelSection t={t} />
            <ToggleRow
              label={t.aiCompletionLabel}
              checked={settings.enableCompletion}
              onChange={(v) => setSettings({ enableCompletion: v })}
            />
            {settings.enableCompletion && (
              <SettingRow label={t.completionToneLabel}>
                <Select
                  className="settings-select"
                  aria-label={t.completionToneLabel}
                  value={settings.completionTone}
                  onChange={(e) =>
                    setSettings({
                      completionTone: e.target.value as CompletionTone,
                    })
                  }
                >
                  {COMPLETION_TONES.map((tone) => (
                    <option key={tone} value={tone}>
                      {t[`completionTone_${tone}` as TextKey]}
                    </option>
                  ))}
                </Select>
              </SettingRow>
            )}
            <ToggleRow
              label={t.aiGrammarLabel}
              checked={settings.enableGrammarCheck}
              onChange={(v) => setSettings({ enableGrammarCheck: v })}
            />
            {settings.enableGrammarCheck && (
              <SettingRow label={t.grammarStrictnessLabel}>
                <Select
                  className="settings-select"
                  aria-label={t.grammarStrictnessLabel}
                  value={settings.grammarStrictness}
                  onChange={(e) =>
                    setSettings({
                      grammarStrictness: e.target.value as GrammarStrictness,
                    })
                  }
                >
                  <option value="typos">{t.grammarStrictnessTypos}</option>
                  <option value="standard">
                    {t.grammarStrictnessStandard}
                  </option>
                  <option value="strict">{t.grammarStrictnessStrict}</option>
                </Select>
              </SettingRow>
            )}
            <WritingConventionsRow t={t} />
          </SettingsGroup>

          <SettingsGroup title={t.aiAskLabel}>
            <ToggleRow
              label={t.aiAskToggleLabel}
              checked={settings.enableAskAi}
              onChange={(v) => setSettings({ enableAskAi: v })}
            />
            {settings.enableAskAi && (
              <>
                <AgentModelSection t={t} />
                <SettingRow label={t.agentDefaultModeLabel}>
                  <Select
                    className="settings-select"
                    aria-label={t.agentDefaultModeLabel}
                    value={settings.agentDefaultMode}
                    onChange={(e) =>
                      setSettings({
                        agentDefaultMode: e.target.value as AgentMode,
                      })
                    }
                  >
                    <option value="write">{t.agentModeWrite}</option>
                    <option value="review">{t.agentModeReview}</option>
                    <option value="create">{t.agentModeCreate}</option>
                  </Select>
                </SettingRow>
                <SettingRow
                  label={t.revisionDisplayLabel}
                  hint={noMargin ? t.revisionDisplayNoRoom : undefined}
                >
                  <Select
                    className="settings-select"
                    aria-label={t.revisionDisplayLabel}
                    value={settings.revisionDisplay}
                    onChange={(e) =>
                      setSettings({
                        revisionDisplay: e.target.value as RevisionDisplay,
                      })
                    }
                  >
                    {REVISION_DISPLAYS.map((mode) => (
                      <option
                        key={mode}
                        value={mode}
                        disabled={marginViewBlocked(mode, {
                          phone,
                          marginAvailable,
                        })}
                      >
                        {revisionDisplayName(t, mode)}
                      </option>
                    ))}
                  </Select>
                </SettingRow>
                <ToggleRow
                  label={t.webSearchLabel}
                  checked={settings.enableWebSearch}
                  onChange={(v) => setSettings({ enableWebSearch: v })}
                />
                <ImageModelSection t={t} />
                <SearchServiceSection t={t} />
              </>
            )}
          </SettingsGroup>

          {/* Project files, instructions and skills only reach conversations, so
              with chat off there is nothing here to set. */}
          {settings.enableAskAi && (
            <>
              <SettingsGroup title={t.agentPersonalizationGroupLabel}>
                {/* File › Open Folder… sets the same folder, so there is one setting,
                    not a second one in General. */}
                {canPickFolder && <AgentWorkspaceRootSection t={t} />}
                <ToggleRow
                  label={t.rememberAutomaticallyLabel}
                  help={t.rememberAutomaticallyHint}
                  checked={settings.rememberAutomatically}
                  onChange={(v) => setSettings({ rememberAutomatically: v })}
                />
                <ToggleRow
                  label={t.suggestNextMessageLabel}
                  help={t.suggestNextMessageHint}
                  checked={settings.suggestNextMessage}
                  onChange={(v) => setSettings({ suggestNextMessage: v })}
                />
                <AgentSystemPromptSection
                  t={t}
                  onOpenFile={onOpenFile}
                  onClose={onClose}
                />
                {isIOSApp ? (
                  <AgentSkillsSection t={t} />
                ) : (
                  // On the desktop skills are extensions, beside plugins,
                  // themes and MCP servers.
                  <SettingRow
                    label={t.agentSkillsLabel}
                    hint={t.extensionsSkillsMoved}
                  >
                    <button
                      type="button"
                      className="text-button settings-inline-button"
                      onClick={() => {
                        openExtensionsTab("skills");
                        openPage("extensions");
                      }}
                    >
                      {t.extensionsSkillsOpen}
                    </button>
                  </SettingRow>
                )}
                {canRevealInFileManager && <AgentWorkspaceSection t={t} />}
              </SettingsGroup>

              {isIOSApp && (
                <BuiltinSkillsSection
                  t={t}
                  onOpenFile={onOpenFile}
                  onFilesDeleted={onFilesDeleted}
                  onClose={onClose}
                />
              )}

              <details className="settings-advanced">
                <summary>{t.agentAdvancedGroupLabel}</summary>
                <div className="settings-advanced-body">
                  <ToggleRow
                    label={t.editAnimationLabel}
                    checked={settings.enableEditAnimation}
                    onChange={(v) => setSettings({ enableEditAnimation: v })}
                  />
                  {canDetachChat && (
                    <ToggleRow
                      label={t.agentExpandWindowLabel}
                      checked={settings.agentExpandToWindow}
                      onChange={(v) => setSettings({ agentExpandToWindow: v })}
                    />
                  )}
                </div>
              </details>
            </>
          )}
        </>
      )}
    </>
  );
}
