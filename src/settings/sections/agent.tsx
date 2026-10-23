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
} from "../SettingsContext";
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

// The AI category's model pickers, and the rows for the concepts in
// docs/design/ai-concepts.md: the project folder, the global writing instructions
// (agent.md), skills and the global config folder. Those are files, not
// settings - these rows open folders and files rather than embedding
// editors; Help > AI Features Guide explains them.

/** Fired after a model list is fetched, so both pickers (writing and
 *  chat) pick up the new list from the cache at once. */
const MODELS_FETCHED_EVENT = "textus-models-fetched";

/** The provider's sign-in models (SIGN_IN_MODELS) while that sign-in is the
 *  active login - "sign in with ChatGPT" for OpenAI: its token can't list
 *  models, and only accepts its own preset family. Null otherwise. */
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

/// Model picker for writing (completion and grammar) or the chat, for
/// whichever provider is active. Seeded from the catalog's `knownModels` (a
/// small pre-supplied list, same idea as pi.dev's models.json) so the
/// dropdown is never empty; ModelListRow adds any live-fetched extras on
/// top. Where "sign in with ChatGPT" is active its presets (agent-models.ts)
/// replace the catalog's. Custom endpoints keep their configured model as
/// the fallback, while these two fields can optionally override it for
/// writing and chat independently.
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

  // An API model id can be left behind when the user later enables Codex
  // OAuth. The OAuth backend only accepts its preset family; normalize an
  // incompatible saved choice to that mode's default instead of rendering a
  // blank select and sending a model the login cannot use.
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
  // A list to choose from, or only a name to type (a custom endpoint, whose
  // models are never listed here). Decided before the saved name joins the
  // options: counting it turned the text field into a one-option select at
  // the first keystroke, so a model name could only ever be one character.
  const hasList = knownAndFetched.length > 0;
  if (current && !knownAndFetched.includes(current)) {
    knownAndFetched.push(current);
  }
  // "gpt-6-luna · vision · tools · 400K", "(deprecated)" - from the bundled
  // models.dev snapshot, so a long fetched list can be chosen from. This is
  // also where what a model can do is shown: vision, tools, context.
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

/// One fetch for both pickers: the provider's live model list, added on
/// top of the catalog's known models. Absent where listing can't work - a
/// custom endpoint, the ChatGPT login, or a provider the catalog marks
/// unlistable.
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

/// The global config folder: the global agent.md and skills/, which apply
/// to every document. Opens it in the file manager (creating it, with the
/// starter agent.md, on first use).
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

/// WHICH folder is the project folder (in code: the workspace root).
///
/// The default - the folder of the document being edited - is right until
/// the user's sources and their draft don't live together, and then there is
/// no way out of it: `.textus/` is looked for there, and the agent's
/// find_files/read_file are sandboxed to it (ai/workspace.rs), so material
/// one folder over is simply unreachable. This makes the root explicit while
/// keeping the default for everyone it already suits. The project bar's
/// menu offers the same choice, with the same labels.
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

/// The GLOBAL writing instructions (agent.md) - sent with every
/// conversation, for all documents. Textus IS a markdown editor, so the
/// button just opens the file as a document (creating the comment-only
/// starter on first use) instead of embedding a bespoke editor here. A
/// project's .textus/agent.md is layered after it; the project bar's menu
/// opens that one.
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
 *  the three that share it. Mirrors `Backend::key_id` in
 *  src-tauri/src/ai/web/search.rs. */
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

/**
 * Settings > Textus AI > Search service, under Web search: what Textus's own
 * web_search uses when the chat model can't search by itself. Shown only
 * where it matters - the chosen model has no search of its own, or a
 * service was chosen before - with the key (or SearXNG's address) right
 * under it, and the row saying where queries go.
 */
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

/** A search service's key: saved with the AI providers' keys
 *  (auth/keys.rs), never in Settings. */
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
