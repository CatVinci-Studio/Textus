import { PathText } from "../../engine/controls/PathText";
import { fill } from "../../i18n/fill";
import { useSettingsIndexing } from "../indexing";
import {
  formatContext,
  modelInfo,
  orderForPicker,
  useFetchedModels,
  writeFetchedModels,
} from "../../ai/model-info";
import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import { localeOf, type Strings } from "../../i18n/strings";
import { SIGN_IN_MODELS, type SignInModels } from "../../ai/sign-in-models";
import { useProviderCatalog } from "../../ai/provider-catalog";
import { useSignedIn } from "../../ai/provider-connection";
import { writingProviderOf } from "../../prefs/settings-types";
import { ai } from "../../platform/ipc";
import { Select } from "../../engine/controls/Select";
import { SettingRow, VERBATIM_INPUT } from "./controls";
import { explainError } from "../../utils/error-explain";

// The AI category's model pickers, and rows for the project folder, global
// writing instructions, skills and config folder. Those are files, so these
// rows open them rather than embedding editors.

/** The provider's sign-in models while that sign-in is the active login: its
 *  token can't list models and only accepts its own presets. Null otherwise. */
function useSignInModels(provider: string): SignInModels | null {
  const active = useSignedIn(provider);
  return active ? (SIGN_IN_MODELS[provider] ?? null) : null;
}

/** Whether a provider's model list is fetched here: not the custom
 *  endpoint's (its panel lists them) nor a sign-in's fixed models. */
export function useModelListShown(provider: string): boolean {
  const signIn = useSignInModels(provider);
  return provider !== "custom" && !signIn;
}

/// Model picker for writing (completion and grammar) or the chat. Seeded
/// from the catalog's `knownModels` so it is never empty; sign-in presets
/// replace those where that login is active. Custom endpoints fall back to
/// their configured model.
function ProviderModelRow({
  t,
  kind,
  provider: given,
  label: givenLabel,
}: {
  t: Strings;
  kind: "writing" | "agent";
  /** Whose models; else the one this kind uses now. */
  provider?: string;
  label?: string;
}) {
  const { settings, setSettings } = useSettings();
  const provider =
    given ??
    (kind === "agent" ? settings.aiProvider : writingProviderOf(settings));
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
  const entry = useProviderCatalog().find((e) => e.id === provider);

  // The OAuth backend only accepts its preset family, so a saved API model id
  // becomes that mode's default rather than a blank select.
  const indexing = useSettingsIndexing();
  useEffect(() => {
    if (indexing || !signIn || !current) return;
    const presets = kind === "agent" ? signIn.agent : signIn.writing;
    if (!presets.some((option) => option.value === current)) {
      setCurrent("");
    }
  }, [signIn, current, kind, setCurrent, indexing]);

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
  const label =
    givenLabel ?? (kind === "agent" ? t.agentModelLabel : t.writingModelLabel);

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
          className="tx-input settings-text-input"
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

export function ModelListRow({
  t,
  provider: given,
}: {
  t: Strings;
  provider?: string;
}) {
  const { settings } = useSettings();
  const provider = given ?? settings.aiProvider;
  const shown = useModelListShown(provider);
  const { at } = useFetchedModels(provider);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // A failed fetch belongs to the provider it was tried against.
  useEffect(() => setError(null), [provider]);

  if (!shown) return null;

  async function fetchModels() {
    setLoading(true);
    setError(null);
    try {
      const list = await ai.fetchAgentModels(provider);
      writeFetchedModels(provider, list);
    } catch (err) {
      setError(explainError(err, t));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SettingRow
      label={t.modelListLabel}
      hint={
        at
          ? fill(t.modelFetchedAt, {
              date: new Date(at).toLocaleDateString(
                localeOf(settings.language),
              ),
            })
          : undefined
      }
      error={error}
    >
      <button
        className="tx-button text-button settings-inline-button"
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
      setError(explainError(err, t));
    }
  }

  return (
    <SettingRow label={t.agentWorkspaceLabel} error={error}>
      <button
        className="tx-button text-button settings-inline-button"
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
      setError(explainError(err, t));
    }
  }

  // Which folder is in use is a value, so it shows under the label.
  return (
    <SettingRow
      label={t.agentWorkspaceRootLabel}
      hint={root ? <PathText path={root} /> : t.agentWorkspaceRootDefault}
      error={error}
    >
      <div className="settings-inline-buttons">
        {root && (
          <button
            className="tx-button text-button settings-inline-button"
            onClick={() => setSettings({ agentWorkspaceRoot: "" })}
          >
            {t.projectFollowSidebar}
          </button>
        )}
        <button
          className="tx-button text-button settings-inline-button"
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
      setError(explainError(err, t));
    }
  }

  return (
    <SettingRow label={t.agentSystemPromptLabel} error={error}>
      <button
        className="tx-button text-button settings-inline-button"
        onClick={editAgentMd}
      >
        {t.agentSystemPromptEdit}
      </button>
    </SettingRow>
  );
}
