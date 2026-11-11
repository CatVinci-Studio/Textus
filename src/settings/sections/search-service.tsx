import { useEffect, useState } from "react";
import { explainError } from "../../utils/error-explain";
import {
  SEARCH_SERVICES,
  useSettings,
  type SearchService,
} from "../../prefs/SettingsContext";
import { type Strings, type TextKey } from "../../i18n/strings";
import {
  notifyWebSearchSetup,
  useWebSearchStatus,
} from "../../ai/provider-catalog";
import { auth } from "../../platform/ipc";
import { Select } from "../../engine/controls/Select";
import { SecretInput, SettingRow, VERBATIM_INPUT } from "./controls";

/** Settings › Textus AI › Web search: the service Textus searches with when
 *  the model has none of its own, and its key. */

/** Where each search service's key is kept: the AI provider's own key for
 *  the three that share it. Keep in step with the backend's `key_id`. */
const SEARCH_KEY_IDS: Partial<Record<SearchService, string>> = {
  deepseek: "deepseek",
  zhipu: "zhipu",
  kimi: "moonshot",
  bocha: "search-bocha",
  tavily: "search-tavily",
  brave: "search-brave",
  exa: "search-exa",
};

/** A search service's name as the UI shows it - brand names, but for the
 *  ones with a name of their own in Chinese, and Automatic. */
const SEARCH_SERVICE_NAMES: Record<
  string,
  { brand: string } | { key: TextKey }
> = {
  auto: { key: "searchServiceAuto" },
  zhipu: { key: "searchServiceZhipu" },
  bocha: { key: "searchServiceBocha" },
  deepseek: { brand: "DeepSeek" },
  kimi: { brand: "Kimi" },
  tavily: { brand: "Tavily" },
  brave: { brand: "Brave Search" },
  exa: { brand: "Exa" },
  searxng: { brand: "SearXNG" },
};

function searchServiceName(t: Strings, id: string): string {
  const name = SEARCH_SERVICE_NAMES[id];
  if (!name) return id;
  return "key" in name ? t[name.key] : name.brand;
}

/** Settings › Textus AI › Search service: what web_search uses when the chat
 *  model can't search itself. Shown only when that matters, or when a service
 *  was chosen before. */
export function SearchServiceSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const status = useWebSearchStatus();
  const chosen = settings.searchService;
  if (!status || (status.native && chosen === "auto")) return null;
  const hint = status.native
    ? t.searchServiceNativeHint
    : status.service
      ? t.searchServiceSendsTo.replace(
          "{name}",
          searchServiceName(t, status.service),
        )
      : t.searchServiceNone;
  const keyId = SEARCH_KEY_IDS[chosen];
  return (
    <>
      <SettingRow label={t.searchServiceLabel} hint={hint}>
        <Select
          className="settings-select"
          aria-label={t.searchServiceLabel}
          value={chosen}
          onChange={(e) =>
            setSettings({ searchService: e.target.value as SearchService })
          }
        >
          {SEARCH_SERVICES.map((id) => (
            <option key={id} value={id}>
              {searchServiceName(t, id)}
            </option>
          ))}
        </Select>
      </SettingRow>
      {keyId && (
        <SearchKeyRow
          key={keyId}
          t={t}
          keyId={keyId}
          name={searchServiceName(t, chosen)}
        />
      )}
      {chosen === "searxng" && (
        <SettingRow label={t.searxngUrlLabel}>
          <input
            type="url"
            {...VERBATIM_INPUT}
            className="settings-text-input"
            aria-label={t.searxngUrlLabel}
            placeholder="https://searx.example.org"
            value={settings.searxngUrl}
            onChange={(e) => setSettings({ searxngUrl: e.target.value })}
          />
        </SettingRow>
      )}
    </>
  );
}

/** A search service's key, saved with the AI providers' keys, never in
 *  Settings. */
function SearchKeyRow({
  t,
  keyId,
  name,
}: {
  t: Strings;
  keyId: string;
  name: string;
}) {
  const [saved, setSaved] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const label = t.apiKeyLabelTemplate.replace("{name}", name);
  useEffect(() => {
    let live = true;
    auth
      .providerApiKeyStatus(keyId)
      .then((ok) => {
        if (live) setSaved(ok);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [keyId]);
  async function save() {
    if (!input.trim()) return;
    try {
      await auth.setProviderApiKey(keyId, input.trim());
      setError(null);
      setInput("");
      setSaved(true);
      notifyWebSearchSetup();
    } catch (err) {
      setError(explainError(err, t));
    }
  }
  async function clear() {
    try {
      await auth.clearProviderApiKey(keyId);
      setError(null);
      setSaved(false);
      notifyWebSearchSetup();
    } catch (err) {
      setError(explainError(err, t));
    }
  }
  return (
    <SettingRow label={label} error={error}>
      <SecretInput
        t={t}
        label={label}
        saved={saved}
        value={input}
        onChange={setInput}
        onSave={save}
        onClear={clear}
      />
    </SettingRow>
  );
}
