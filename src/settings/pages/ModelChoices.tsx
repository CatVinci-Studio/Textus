import { SettingsGroup } from "./SettingsGroup";
import { SettingRow } from "../sections/controls";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings } from "../../i18n/strings";
import { localizedLabel } from "../../ai/provider-connection";
import { ImageModelSection } from "../sections/image-model";
import { AgentModelSection, WritingModelSection } from "../sections/agent";
import { Select } from "../../engine/controls/Select";

/** The model each use takes - the chat, writing assistance (whose provider
 *  may follow the chat's), images: one group over the providers. */
export function ModelChoices({ t }: { t: Strings }) {
  return (
    <SettingsGroup title={t.modelChoiceGroup}>
      <ProviderChoice t={t} use="chat" />
      <AgentModelSection t={t} />
      <ProviderChoice t={t} use="writing" />
      <WritingModelSection t={t} />
      <ImageModelSection t={t} />
    </SettingsGroup>
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
