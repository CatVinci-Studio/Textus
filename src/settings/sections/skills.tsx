import { useCallback, useEffect, useState } from "react";
import { useSettings } from "../../prefs/SettingsContext";
import type { Strings, TextKey } from "../../i18n/strings";
import { skillText } from "../../ai/skills/texts";
import { BUILTIN_SKILLS } from "../../ai/skills/builtin";
import { listFromWorkspace } from "../../ai/chat/skill-picker";
import { AGENT_MODES, type AgentMode } from "../../prefs/settings-types";
import { ModeChoice } from "../../ai/chat/ModeChoice";
import type { AgentSkill } from "../../ai/types";
import { ai, type SkillListItem } from "../../platform/ipc";
import { showConfirm } from "../../ui/app-dialog";
import { Select } from "../../ui/Select";
import { SettingRow } from "./controls";
import {
  AUTOMATIC_CONVENTIONS,
  CONVENTION_PROFILES,
  conventionsLanguageName,
  conventionsProfileName,
  isConventionsValue,
} from "../writing-conventions";
import { errorText } from "../../utils/error-text";
import { matchesWords } from "../../utils/match-words";
import { explainError } from "../../utils/error-explain";

// Settings > Textus AI: skills and the Writing conventions row. Skills are
// files, so these rows mirror and open them rather than embedding an editor.

/** Fired after a skill changes here, so every section showing the list
 *  reloads it. */
export const SKILLS_CHANGED_EVENT = "textus-skills-changed";

export function announceChange() {
  window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
}

/** The skill list as Settings shows it: built-ins and the global layer.
 *  `list` is null where the backend has none. */
function useSkillList() {
  const [list, setList] = useState<SkillListItem[] | null>(null);
  const [workspaceSkills, setWorkspaceSkills] = useState<AgentSkill[]>([]);

  const reload = useCallback(() => {
    ai.listSkills(null, null)
      .then((items) => setList(Array.isArray(items) ? items : null))
      .catch(() => setList(null));
    // Both null = the global layer only, which is exactly what's editable.
    ai.loadAgentWorkspace(null, null)
      .then((ws) => setWorkspaceSkills(ws?.skills ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
    window.addEventListener(SKILLS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SKILLS_CHANGED_EVENT, reload);
  }, [reload]);

  return { list, setList, workspaceSkills };
}

/** Import Skill…: picks a skill file and copies it into the global
 *  skills folder; every list showing skills reloads. */
export async function importSkill(): Promise<void> {
  await ai.importAgentSkill();
  announceChange();
}

/// The Skills row and the user's own skills under it.
export function AgentSkillsSection({ t }: { t: Strings }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <SettingRow label={t.agentSkillsLabel} error={error}>
        <button
          className="text-button settings-inline-button"
          onClick={() =>
            importSkill().then(
              () => setError(null),
              (err: unknown) => setError(explainError(err, t)),
            )
          }
        >
          {t.agentSkillsImport}
        </button>
      </SettingRow>
      <OwnSkillsList t={t} />
    </>
  );
}

/// The user's own skills, each with the modes it applies in (at least one).
/// A skill with a built-in's name says it replaces it.
export function OwnSkillsList({
  t,
  query = "",
}: {
  t: Strings;
  query?: string;
}) {
  const { settings } = useSettings();
  const lang = settings.language;
  const { list, setList, workspaceSkills } = useSkillList();
  const [error, setError] = useState<string | null>(null);
  const own: SkillListItem[] = (
    list
      ? // Copies made by Customize… show under Built-in skills instead.
        list.filter((item) => item.source !== "builtin" && !item.basedOn)
      : listFromWorkspace(workspaceSkills)
  ).filter((item) =>
    matchesWords(
      `${item.name}\n${(item.labels?.[lang] ?? item.labels?.en)?.label ?? ""}`,
      query,
    ),
  );

  async function setModes(skill: SkillListItem, modes: AgentMode[]) {
    if (modes.length === 0) return;
    setError(null);
    const before = list;
    // At once on screen; put back if the backend says no.
    setList(
      (list ?? []).map((i) => (i.name === skill.name ? { ...i, modes } : i)),
    );
    try {
      await ai.setSkillModes(skill.name, skill.source, null, null, modes);
      announceChange();
    } catch (err) {
      setList(before);
      setError(explainError(err, t));
    }
  }

  if (own.length === 0) return null;
  return (
    <div className="settings-skill-list">
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {own.map((skill) => {
        const words = skill.labels?.[lang] ?? skill.labels?.en;
        const shadows = skill.overridesBuiltin;
        const modes = skill.modes ?? ["write"];
        return (
          <div
            key={skill.name}
            className="settings-skill-item"
            data-skill={skill.name}
          >
            <span className="settings-skill-text">
              <span className="settings-skill-title">
                <span className="settings-skill-name">
                  {words?.label ?? skill.name}
                </span>
                {(shadows || skill.source === "project") && (
                  <span className="settings-skill-tag">
                    {shadows ? t.agentSkillsShadows : t.skillGroupProject}
                  </span>
                )}
              </span>
              <span className="settings-skill-desc">
                <span className="settings-builtin-skill-name">
                  /{skill.name}
                </span>
                {` · ${words?.hint ?? skill.description}`}
              </span>
            </span>
            <span className="settings-skill-modes">
              <ModeChoice
                t={t}
                modes={modes}
                onChange={(next) => void setModes(skill, next)}
              />
            </span>
          </div>
        );
      })}
    </div>
  );
}

const MODE_LABEL: Record<AgentMode, TextKey> = {
  write: "agentModeWrite",
  review: "agentModeReview",
  create: "agentModeCreate",
};

/// The built-in skills by mode, always on. Customize… copies one into the
/// global skills folder and opens it; Reset deletes the copy. `flat` drops
/// the disclosure.
export function BuiltinSkillsSection({
  t,
  query = "",
  flat,
  onOpenFile,
  onFilesDeleted,
  onClose,
}: {
  t: Strings;
  query?: string;
  flat?: boolean;
  onOpenFile: (path: string) => void;
  onFilesDeleted?: (paths: string[]) => void;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const lang = settings.language;
  const { list } = useSkillList();
  const [error, setError] = useState<string | null>(null);
  // The backend's error codes in the user's words.
  const failed = (err: unknown) => {
    const text = errorText(err);
    setError(
      text === "NOT_A_COPY"
        ? t.agentSkillsNotACopy
        : text === "UNKNOWN_BUILTIN"
          ? t.agentSkillsUnknownBuiltin
          : explainError(err, t),
    );
  };

  // One item per name: the built-in, a Customize… copy (`basedOn`), or the
  // user's own skill that replaces it outright.
  const item = (name: string) => list?.find((i) => i.name === name);
  const isCopy = (i: SkillListItem | undefined) =>
    !!i && i.source !== "builtin" && !!i.basedOn;
  const isOwn = (i: SkillListItem | undefined) =>
    !!i && i.source !== "builtin" && !i.basedOn;

  async function openCopy(name: string) {
    setError(null);
    try {
      const path = await ai.customizeBuiltinSkill(name);
      announceChange();
      onClose(); // the editor is behind the settings panel
      onOpenFile(path);
    } catch (err) {
      failed(err);
    }
  }

  async function reset(name: string, label: string) {
    setError(null);
    const ok = await showConfirm(
      t.agentSkillsResetConfirm.replace("{name}", label),
      { okLabel: t.agentSkillsReset, cancelLabel: t.cancel, danger: true },
    );
    if (!ok) return;
    try {
      const deleted = await ai.resetBuiltinSkill(name);
      announceChange();
      if (Array.isArray(deleted) && deleted.length > 0) {
        onFilesDeleted?.(deleted);
      }
    } catch (err) {
      failed(err);
    }
  }

  const rows = (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {AGENT_MODES.map((mode) => ({
        mode,
        names: BUILTIN_SKILLS.filter(
          (s) =>
            s.mode === mode &&
            matchesWords(`${s.name}\n${skillText(lang, s.name).label}`, query),
        ),
      }))
        .filter(({ names }) => names.length > 0)
        .map(({ mode, names }) => (
          <div
            key={mode}
            className="settings-builtin-category"
            role="group"
            aria-label={t[MODE_LABEL[mode]]}
            data-mode={mode}
          >
            <div className="settings-builtin-category-title" aria-hidden="true">
              {t[MODE_LABEL[mode]]}
            </div>
            {names.map(({ name }) => {
              const text = skillText(lang, name);
              const current = item(name);
              const customized = isCopy(current);
              const own = isOwn(current);
              // The copy predates the bundled built-in's latest version.
              const outdated = customized && !!current?.builtinUpdated;
              return (
                <div
                  key={name}
                  className="settings-row settings-builtin-skill"
                  data-skill={name}
                >
                  <div className="settings-row-text">
                    <div className="settings-row-label">
                      {text.label}
                      <span className="settings-skill-tag" data-search-ignore>
                        {customized
                          ? t.agentSkillsCustomized
                          : own
                            ? t.agentSkillsShadows
                            : t.agentSkillsBuiltinTag}
                      </span>
                      {outdated && (
                        <span
                          className="settings-skill-tag settings-skill-tag-notice"
                          data-search-ignore
                        >
                          {t.agentSkillsBuiltinUpdated}
                        </span>
                      )}
                    </div>
                    <div className="settings-row-hint">
                      <span className="settings-builtin-skill-name">
                        /{name}
                      </span>
                      {" · "}
                      {text.hint}
                    </div>
                    {outdated && (
                      <div className="settings-row-hint settings-skill-update-hint">
                        {t.agentSkillsBuiltinUpdatedHint}
                      </div>
                    )}
                  </div>
                  <div className="settings-row-control">
                    <span className="settings-skill-actions">
                      {own || customized ? (
                        <button
                          className="settings-skill-action"
                          aria-label={`${t.agentSkillsOpen}: ${text.label}`}
                          onClick={() => openCopy(name)}
                        >
                          {t.agentSkillsOpen}
                        </button>
                      ) : (
                        <button
                          className="settings-skill-action"
                          aria-label={`${t.agentSkillsCustomize}: ${text.label}`}
                          onClick={() => openCopy(name)}
                        >
                          {t.agentSkillsCustomize}
                        </button>
                      )}
                      {customized && (
                        <button
                          className="settings-skill-action"
                          aria-label={`${t.agentSkillsReset}: ${text.label}`}
                          onClick={() => reset(name, text.label)}
                        >
                          {t.agentSkillsReset}
                        </button>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
    </>
  );
  if (flat) return rows;
  return (
    <details className="settings-advanced settings-builtin-skills">
      <summary>
        <span className="settings-builtin-skills-title">
          {t.agentSkillsBuiltin}
        </span>
      </summary>
      <div className="settings-advanced-body">{rows}</div>
    </details>
  );
}

/// Writing conventions: Automatic, or one profile, grouped by document
/// language.
export function WritingConventionsRow({ t }: { t: Strings }) {
  const { settings, setSettings } = useSettings();
  const lang = settings.language;
  const value = settings.writingConventions;
  const known = isConventionsValue(value);
  return (
    <SettingRow label={t.writingConventionsLabel}>
      <Select
        className="settings-select"
        aria-label={t.writingConventionsLabel}
        value={value}
        onChange={(e) => setSettings({ writingConventions: e.target.value })}
      >
        <option value={AUTOMATIC_CONVENTIONS}>
          {t.writingConventionsAuto}
        </option>
        {/* A newer build's profile stays selectable, by its own name. */}
        {!known && <option value={value}>{value}</option>}
        {CONVENTION_PROFILES.map((group) => (
          <optgroup
            key={group.language}
            label={conventionsLanguageName(lang, group.language)}
          >
            {group.profiles.map((profile) => (
              <option key={profile} value={profile}>
                {conventionsProfileName(t, lang, profile)}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </SettingRow>
  );
}
