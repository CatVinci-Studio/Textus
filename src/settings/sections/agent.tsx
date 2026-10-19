import { errorText } from "../../utils/error-text";
import {
  formatContext,
  modelInfo,
  orderForPicker,
  readFetchedModels,
  writeFetchedModels,
} from "../../ai/model-info";
import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../SettingsContext";
import { localeOf, type Strings } from "../../i18n/strings";
import {
  OPENAI_OAUTH_AGENT_MODEL_PRESETS,
  OPENAI_OAUTH_WRITING_MODEL_PRESETS,
} from "../agent-models";
import { useActiveProvider } from "../../ai/provider-catalog";
import { ai, auth } from "../../platform/ipc";
import { Select } from "../../ui/Select";
import { SettingRow, VERBATIM_INPUT } from "./controls";

// The AI category's model pickers, and the rows for the concepts in
// docs/design/ai-concepts.md: the project folder, the global writing instructions
// (agent.md), skills and the global config folder. Those are files, not
// settings - these rows open folders and files rather than embedding
// editors; Help > AI Features Guide explains them.

/** Fired after a model list is fetched, so both pickers (writing and
 *  chat) pick up the new list from the cache at once. */
const MODELS_FETCHED_EVENT = "textus-models-fetched";

/** Whether "sign in with ChatGPT" is the active OpenAI login - that OAuth
 *  token can't list models, and only accepts its own preset family. */
function useCodexOauthActive(provider: string): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    if (provider !== "openai") {
      setActive(false);
      return;
    }
    auth
      .oauthStatus("openai")
      .then((s) => {
        if (!cancelled) setActive(s.configured);
      })
      .catch(() => {
        if (!cancelled) setActive(false);
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);
  return active;
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
  const codexOauthActive = useCodexOauthActive(provider);
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
    if (!codexOauthActive || provider !== "openai" || !current) return;
    const presets =
      kind === "agent"
        ? OPENAI_OAUTH_AGENT_MODEL_PRESETS
        : OPENAI_OAUTH_WRITING_MODEL_PRESETS;
    if (!presets.some((option) => option.value === current)) {
      setCurrent("");
    }
  }, [codexOauthActive, current, kind, provider, setCurrent]);

  const useCodexPresets = provider === "openai" && codexOauthActive;
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
  const codexDefaultModel = kind === "agent" ? "gpt-6.1-sol" : "gpt-6-luna";
  const codexPresets =
    kind === "agent"
      ? OPENAI_OAUTH_AGENT_MODEL_PRESETS
      : OPENAI_OAUTH_WRITING_MODEL_PRESETS;
  const presetOptions: { value: string; label: string }[] = useCodexPresets
    ? codexPresets.map((option) => ({
        value: option.value,
        label: option.value || `${codexDefaultModel} (${t.modelDefault})`,
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
      {useCodexPresets || defaultModel || hasList ? (
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
  const codexOauthActive = useCodexOauthActive(provider);
  const entry = useActiveProvider();
  const { at } = useFetchedModels(provider);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A failed fetch belongs to the provider it was tried against.
  useEffect(() => setError(null), [provider]);

  const canFetch =
    provider !== "custom" &&
    !(provider === "openai" && codexOauthActive) &&
    (entry?.modelsListable ?? true);
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
/// list_files/read_file are sandboxed to it (ai/workspace.rs), so material
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

  // Which folder is in use is a value, so it shows under the label; that
  // the AI reads nothing outside it is the "?".
  return (
    <SettingRow
      label={t.agentWorkspaceRootLabel}
      help={t.agentWorkspaceRootHelp}
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
    <SettingRow
      label={t.agentSystemPromptLabel}
      help={t.agentSystemPromptHint}
      error={error}
    >
      <button
        className="text-button settings-inline-button"
        onClick={editAgentMd}
      >
        {t.agentSystemPromptEdit}
      </button>
    </SettingRow>
  );
}
