import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import {
  COMPLETION_TONES,
  REVISION_DISPLAYS,
  type CompletionTone,
  type GrammarStrictness,
  type RevisionDisplay,
  type AiChangeMode,
} from "../../prefs/SettingsContext";
import {
  marginViewBlocked,
  revisionDisplayName,
} from "../../ai/revision/revision-display";
import type { TextKey } from "../../i18n/strings";
import { SettingRow, ToggleRow } from "../sections/controls";
import {
  SearchServiceSection,
  useSearchServiceStatus,
} from "../sections/search-service";
import { WritingConventionsRow } from "../sections/skills";
import { Select } from "../../engine/controls/Select";
import {
  TEXTUS_SOURCE,
  useInlineSources,
} from "../../ai/writing/inline-sources";

/**
 * Settings › Textus AI › Chat & writing, from what is used most to what is
 * set once: the chat, writing assistance, research writing, then the web
 * search service.
 */
export function ChatWritingPage({
  t,
  settings,
  setSettings,
  phone,
  marginAvailable,
}: SettingsPageProps) {
  const sources = useInlineSources();
  const searchStatus = useSearchServiceStatus();
  return (
    <>
      <SettingsGroup title={t.aiAskLabel}>
        <ToggleRow
          label={t.aiAskToggleLabel}
          checked={settings.enableAskAi}
          onChange={(v) => setSettings({ enableAskAi: v })}
        />
        {settings.enableAskAi && (
          <>
            <SettingRow label={t.aiChangeModeLabel} help={t.aiChangeModeHint}>
              <Select
                className="settings-select"
                aria-label={t.aiChangeModeLabel}
                value={settings.aiChangeMode}
                onChange={(e) =>
                  setSettings({
                    aiChangeMode: e.target.value as AiChangeMode,
                  })
                }
              >
                <option value="revision">{t.aiChangeModeRevision}</option>
                <option value="direct">{t.aiChangeModeDirect}</option>
              </Select>
            </SettingRow>
            <SettingRow label={t.revisionDisplayLabel}>
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
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title={t.writingFeaturesLabel}>
        <ToggleRow
          label={t.aiCompletionLabel}
          checked={settings.enableCompletion}
          onChange={(v) => setSettings({ enableCompletion: v })}
        />
        {settings.enableCompletion &&
          (sources.length > 0 ||
            settings.completionSource !== TEXTUS_SOURCE) && (
            <SettingRow label={t.completionSourceLabel}>
              <Select
                className="settings-select"
                aria-label={t.completionSourceLabel}
                value={settings.completionSource}
                onChange={(e) =>
                  setSettings({ completionSource: e.target.value })
                }
              >
                <option value={TEXTUS_SOURCE}>Textus AI</option>
                {sources.map((source) => (
                  <option key={source.key} value={source.key}>
                    {source.label}
                  </option>
                ))}
                {/* A plugin's source that is off now: kept, and nothing
                    offered, until another is picked. */}
                {settings.completionSource !== TEXTUS_SOURCE &&
                  !sources.some((s) => s.key === settings.completionSource) && (
                    <option value={settings.completionSource} disabled>
                      {settings.completionSource.split("#")[0]}
                    </option>
                  )}
              </Select>
            </SettingRow>
          )}
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
        <WritingConventionsRow t={t} />
      </SettingsGroup>

      {settings.enableAskAi && searchStatus && (
        <SettingsGroup title={t.netGroup}>
          <SearchServiceSection t={t} status={searchStatus} />
        </SettingsGroup>
      )}
    </>
  );
}
