import { errorText } from "../../utils/error-text";
import {
  formatContext,
  modelInfo,
  orderForPicker,
  readFetchedModels,
  writeFetchedModels,
} from "../../ai/model-info";
import { useCallback, useEffect, useState } from "react";
import {
  SEARCH_SERVICES,
  useSettings,
  type SearchService,
} from "../../prefs/SettingsContext";
import { localeOf, type Strings, type TextKey } from "../../i18n/strings";
import { SIGN_IN_MODELS, type SignInModels } from "../agent-models";
import {
  notifyWebSearchSetup,
  useActiveProvider,
  useWebSearchStatus,
} from "../../ai/provider-catalog";
import { ai, auth } from "../../platform/ipc";
import { Select } from "../../ui/Select";
import { SecretInput, SettingRow, VERBATIM_INPUT } from "./controls";

// The AI category's model pickers, and rows for the project folder, global
// writing instructions, skills and config folder. Those are files, so these
// rows open them rather than embedding editors.

/** Fired after a model list is fetched, so both pickers (writing and
 *  chat) pick up the new list from the cache at once. */
const MODELS_FETCHED_EVENT = "textus-models-fetched";

/** The provider's sign-in models while that sign-in is the active login: its
 *  token can't list models and only accepts its own presets. Null otherwise. */
function useSignInModels(provider: string): SignInModels | null {
  const models = SIGN_IN_MODELS[provider] ?? null;
  const [active, setActive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (!models) {
      setActive(false);
      return;
    }
    auth
      .oauthStatus(provider)
      .then((s) => {
        if (!cancelled) setActive(s.configured);
      })
      .catch(() => {
        if (!cancelled) setActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider, models]);
  return active && models ? models : null;
}

/** The last list fetched for `provider`, remembered across restarts and
 *  refreshed whenever ModelListRow fetches a new one. */
function useFetchedModels(provider: string) {
  const [cached, setCached] = useState(() => readFetchedModels(provider));
  useEffect(() => {
    const reload = () => setCached(readFetchedModels(provider));
    reload();
    window.addEventListener(MODELS_FETCHED_EVENT, reload);
    return () => window.removeEventListener(MODELS_FETCHED_EVENT, reload);
  }, [provider]);
  return { models: cached?.models ?? [], at: cached?.at ?? null };
}

/// Model picker for writing (completion and grammar) or the chat. Seeded
/// from the catalog's `knownModels` so it is never empty; sign-in presets
/// replace those where that login is active. Custom endpoints fall back to
/// their configured model.
function ProviderModelRow({
  t,
  kind,
}: {
  t: Strings;
  kind: "writing" | "agent";
}) {
  const { settings, setSettings } = useSettings();
  const provider = settings.aiProvider;
  const signIn = useSignInModels(provider);
  const { models: fetched } = useFetchedModels(provider);

  const modelMap =
    kind === "agent" ? settings.agentModels : settings.writingModels;
  const current = modelMap[provider] ?? "";
  const setCurrent = useCallback(
    (value: string) => {
      if (kind === "agent") {
        setSettings({
          agentModels: { ...settings.agentModels, [provider]: value },
        });
      } else {
        setSettings({
          writingModels: { ...settings.writingModels, [provider]: value },
        });
      }
    },
    [kind, provider, setSettings, settings.agentModels, settings.writingModels],
  );
  const entry = useActiveProvider();

  // The OAuth backend only accepts its preset family, so a saved API model id
  // becomes that mode's default rather than a blank select.
  useEffect(() => {
    if (!signIn || !current) return;
    const presets = kind === "agent" ? signIn.agent : signIn.writing;
    if (!presets.some((option) => option.value === current)) {
      setCurrent("");
    }
  }, [signIn, current, kind, setCurrent]);

  const knownAndFetched = [
    ...(entry?.knownModels ?? []),
    ...orderForPicker(
      provider,
      fetched.filter((m) => !entry?.knownModels.includes(m)),
    ),
  ];
  // The saved choice isn't in a list fetched from the provider: most likely
  // retired. Still selectable (it may just be unlisted), but flagged.
  const currentMissing =
    !!current && fetched.length > 0 && !fetched.includes(current);
  // Decided before the saved name joins the options, or the text field turns
  // into a one-option select at the first keystroke.
  const hasList = knownAndFetched.length > 0;
  if (current && !knownAndFetched.includes(current)) {
    knownAndFetched.push(current);
  }
  // "gpt-6-luna · vision · tools · 400K", "(deprecated)": what a model can do,
  // from the bundled models.dev snapshot.
  const describe = (id: string) => {
    const info = modelInfo(provider, id);
    if (!info) return id;
    const tags = [
      info.vision ? t.modelTagVision : null,
      info.tools ? t.modelTagTools : null,
      info.context ? formatContext(info.context) : null,
    ].filter(Boolean);
    const label = tags.length ? `${id} · ${tags.join(" · ")}` : id;
    return info.status === "deprecated"
      ? `${label} (${t.modelTagDeprecated})`
      : label;
  };
  const defaultModel =
    kind === "agent" ? entry?.agentDefaultModel : entry?.defaultModel;
  const presetOptions: { value: string; label: string }[] = signIn
    ? (kind === "agent" ? signIn.agent : signIn.writing).map((option) => ({
        value: option.value,
        label:
          option.value ||
          `${kind === "agent" ? signIn.agentDefault : signIn.writingDefault} (${t.modelDefault})`,
      }))
    : [
        ...(defaultModel
          ? [
              {
                value: "",
                label: `${defaultModel} (${t.modelDefault})`,
              },
            ]
          : []),
        ...knownAndFetched
          .filter((m) => m !== defaultModel)
          .map((m) => ({ value: m, label: describe(m) })),
      ];
  const label = kind === "agent" ? t.agentModelLabel : t.writingModelLabel;

  return (
    <SettingRow
      label={label}
      error={currentMissing ? t.modelMissingHint : null}
    >
      {signIn || defaultModel || hasList ? (
        <Select
          className="settings-select settings-model-select"
          aria-label={label}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        >
          {presetOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      ) : (
        <input
          type="text"
          {...VERBATIM_INPUT}
          className="settings-text-input"
          aria-label={label}
          placeholder={t.customModelPlaceholder}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      )}
    </SettingRow>
  );
}

export function WritingModelSection({ t }: { t: Strings }) {
  return <ProviderModelRow t={t} kind="writing" />;
}

export function AgentModelSection({ t }: { t: Strings }) {
  return <ProviderModelRow t={t} kind="agent" />;
}

/// One fetch for both pickers: the provider's live model list, on top of the
/// catalog's. Absent where listing can't work.
export function ModelListRow({ t }: { t: Strings }) {
  const { settings } = useSettings();
  const provider = settings.aiProvider;
  const signIn = useSignInModels(provider);
  const entry = useActiveProvider();
  const { at } = useFetchedModels(provider);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A failed fetch belongs to the provider it was tried against.
  useEffect(() => setError(null), [provider]);

  const canFetch =
    provider !== "custom" && !signIn && (entry?.modelsListable ?? true);
  if (!canFetch) return null;

  async function fetchModels() {
    setLoading(true);
    setError(null);
    try {
      const list = await ai.fetchAgentModels(provider);
      writeFetchedModels(provider, list);
      window.dispatchEvent(new Event(MODELS_FETCHED_EVENT));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingRow
      label={t.modelListLabel}
      hint={
        at
          ? t.modelFetchedAt.replace(
              "{date}",
              new Date(at).toLocaleDateString(localeOf(settings.language)),
            )
          : undefined
      }
      error={error}
    >
      <button
        className="text-button settings-inline-button"
        onClick={fetchModels}
        disabled={loading}
      >
        {t.customFetchModels}
      </button>
    </SettingRow>
  );
}

/// The global config folder (agent.md and skills/, for every document),
/// opened in the file manager and created on first use.
export function AgentWorkspaceSection({ t }: { t: Strings }) {
  const [error, setError] = useState<string | null>(null);

  async function openFolder() {
    try {
      // The starter agent.md, in the UI language, if there is none yet.
      await ai.openGlobalAgentDir(t.agentInstructionsTemplate);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <SettingRow label={t.agentWorkspaceLabel} error={error}>
      <button
        className="text-button settings-inline-button"
        onClick={openFolder}
      >
        {t.agentWorkspaceOpenButton}
      </button>
    </SettingRow>
  );
}

/// Which folder is the project folder (the workspace root). The default, the
/// document's folder, fails once sources live elsewhere: the agent's file
/// tools are sandboxed to it.
export function AgentWorkspaceRootSection({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const [error, setError] = useState<string | null>(null);
  const root = settings.agentWorkspaceRoot;

  async function pickRoot() {
    setError(null);
    try {
      const picked = await ai.pickWorkspaceRoot();
      if (picked) setSettings({ agentWorkspaceRoot: picked });
    } catch (err) {
      setError(errorText(err));
    }
  }

  // Which folder is in use is a value, so it shows under the label.
  return (
    <SettingRow
      label={t.agentWorkspaceRootLabel}
      hint={root || t.agentWorkspaceRootDefault}
      error={error}
    >
      <div className="settings-inline-buttons">
        {root && (
          <button
            className="text-button settings-inline-button"
            onClick={() => setSettings({ agentWorkspaceRoot: "" })}
          >
            {t.projectUseDocFolder}
          </button>
        )}
        <button
          className="text-button settings-inline-button"
          onClick={pickRoot}
        >
          {t.agentWorkspaceRootPick}
        </button>
      </div>
    </SettingRow>
  );
}

/// The global writing instructions (agent.md), sent with every conversation.
/// Opened as a document rather than edited here; a project's own is layered
/// after it.
export function AgentSystemPromptSection({
  t,
  onOpenFile,
  onClose,
}: {
  t: Strings;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);

  async function editAgentMd() {
    try {
      // The starter agent.md, in the UI language, if there is none yet.
      const path = await ai.ensureGlobalAgentMd(t.agentInstructionsTemplate);
      onClose(); // the editor is behind the settings panel
      onOpenFile(path);
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <SettingRow label={t.agentSystemPromptLabel} error={error}>
      <button
        className="text-button settings-inline-button"
        onClick={editAgentMd}
      >
        {t.agentSystemPromptEdit}
      </button>
    </SettingRow>
  );
}

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
    await auth.setProviderApiKey(keyId, input.trim());
    setInput("");
    setSaved(true);
    notifyWebSearchSetup();
  }
  async function clear() {
    await auth.clearProviderApiKey(keyId);
    setSaved(false);
    notifyWebSearchSetup();
  }
  return (
    <SettingRow label={label}>
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
