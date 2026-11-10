import type { SettingsPageProps } from "./types";
import { SettingsGroup } from "./SettingsGroup";
import { SettingRow } from "../sections/controls";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { localizedLabel } from "../sections/provider-connection";
import { ImageModelSection } from "../sections/image-model";
import { AgentModelSection, WritingModelSection } from "../sections/agent";
import { Select } from "../../engine/controls/Select";

/** Settings › Textus AI › Models: which provider and model each use takes -
 *  the chat, writing assistance (which may follow the chat's), images. */
export function ModelsPage({ t, settings }: SettingsPageProps) {
  if (!settings.textusAi)
    return <p className="tx-list-note">{t.textusAiOffHint}</p>;
  return (
    <>
      <SettingsGroup title={t.aiAskLabel}>
        <ProviderChoice t={t} use="chat" />
        <AgentModelSection t={t} />
      </SettingsGroup>
      <SettingsGroup title={t.writingFeaturesLabel}>
        <ProviderChoice t={t} use="writing" />
        <WritingModelSection t={t} />
      </SettingsGroup>
      <SettingsGroup title={t.imageGenerationGroupLabel}>
        <ImageModelSection t={t} />
      </SettingsGroup>
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
