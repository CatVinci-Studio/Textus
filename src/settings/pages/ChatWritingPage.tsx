import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  COMPLETION_TONES,
  REVISION_DISPLAYS,
  type CompletionTone,
  type GrammarStrictness,
  type ProxyType,
  type RevisionDisplay,
} from "../../prefs/SettingsContext";
import {
  marginViewBlocked,
  revisionDisplayName,
} from "../../ai/revision/revision-display";
import { useProviderCatalog } from "../../ai/provider-catalog";
import type { Strings, TextKey } from "../../i18n/strings";
import {
  AdvancedFold,
  SettingRow,
  ToggleRow,
  VERBATIM_INPUT,
} from "../sections/controls";
import { localizedLabel } from "../sections/provider-connection";
import { ImageModelSection } from "../sections/image-model";
import { AgentModelSection, WritingModelSection } from "../sections/agent";
import { SearchServiceSection } from "../sections/search-service";
import { WritingConventionsRow } from "../sections/skills";
import { Select } from "../../engine/controls/Select";
import { useSettings } from "../../prefs/SettingsContext";

/**
 * Settings › Textus AI › Chat & Writing: which provider and model each use
 * takes - the chat, writing assistance, images - then how the chat, the
 * writing aids and research work.
 */
export function ChatWritingPage({
  t,
  settings,
  setSettings,
  phone,
  marginAvailable,
  noMargin,
}: SettingsPageProps) {
  if (!settings.textusAi)
    return <p className="tx-list-note">{t.textusAiOffHint}</p>;
  return (
    <>
      <SettingsGroup title={t.aiUsesGroup}>
        <ProviderChoice t={t} use="chat" />
        <AgentModelSection t={t} />
        <ProviderChoice t={t} use="writing" />
        <WritingModelSection t={t} />
        <ImageModelSection t={t} />
      </SettingsGroup>

      <SettingsGroup title={t.aiAskLabel}>
        <ToggleRow
          label={t.aiAskToggleLabel}
          checked={settings.enableAskAi}
          onChange={(v) => setSettings({ enableAskAi: v })}
        />
        {settings.enableAskAi && (
          <>
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
              label={t.askBeforeFileChangesLabel}
              help={t.askBeforeFileChangesHint}
              checked={settings.agentAskBeforeFileChanges}
              onChange={(v) => setSettings({ agentAskBeforeFileChanges: v })}
            />
            <SearchServiceSection t={t} />
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t.writingFeaturesLabel}>
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
              <option value="standard">{t.grammarStrictnessStandard}</option>
              <option value="strict">{t.grammarStrictnessStrict}</option>
            </Select>
          </SettingRow>
        )}
      </SettingsGroup>

      {settings.enableAskAi && (
        <SettingsGroup title={t.researchGroup}>
          <ToggleRow
            label={t.researchSubHelpersLabel}
            help={t.researchSubHelpersHint}
            checked={settings.researchSubHelpers}
            onChange={(v) => setSettings({ researchSubHelpers: v })}
          />
          <ToggleRow
            label={t.researchCheckClaimsLabel}
            help={t.researchCheckClaimsHint}
            checked={settings.researchCheckClaims}
            onChange={(v) => setSettings({ researchCheckClaims: v })}
          />
        </SettingsGroup>
      )}

      {/* Rarely changed: the writing conventions, the network, and how the
          conversation behaves. */}
      <AdvancedFold t={t}>
        <WritingConventionsRow t={t} />
        {settings.enableAskAi && (
          <>
            <ToggleRow
              label={t.suggestNextMessageLabel}
              help={t.suggestNextMessageHint}
              checked={settings.suggestNextMessage}
              onChange={(v) => setSettings({ suggestNextMessage: v })}
            />
            <ToggleRow
              label={t.editAnimationLabel}
              checked={settings.enableEditAnimation}
              onChange={(v) => setSettings({ enableEditAnimation: v })}
            />
          </>
        )}
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
      </AdvancedFold>
    </>
  );
}

/** Which provider a use takes: the chat's own, or writing's - which may
 *  follow the chat's. */
function ProviderChoice({ t, use }: { t: Strings; use: "chat" | "writing" }) {
  const { settings, setSettings } = useSettings();
  const catalog = useProviderCatalog();
  const label = use === "chat" ? t.chatProviderLabel : t.writingProviderLabel;
  const value = use === "chat" ? settings.aiProvider : settings.writingProvider;
  return (
    <SettingRow label={label}>
      <Select
        className="settings-select"
        aria-label={label}
        value={value}
        onChange={(e) =>
          setSettings(
            use === "chat"
              ? { aiProvider: e.target.value }
              : { writingProvider: e.target.value },
          )
        }
      >
        {use === "writing" && <option value="">{t.followChatProvider}</option>}
        {catalog.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {localizedLabel(entry, t)}
          </option>
        ))}
      </Select>
    </SettingRow>
  );
}
