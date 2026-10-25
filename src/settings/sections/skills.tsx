import { useCallback, useEffect, useState } from "react";
import { errorText } from "../../utils/error-text";
import { useSettings } from "../SettingsContext";
import type { Strings, TextKey } from "../../i18n/strings";
import { skillText } from "../../ai/skills/texts";
import {
  BUILTIN_SKILLS,
  SKILL_CATEGORIES,
  isBuiltinSkillName,
  type BuiltinSkillName,
  type SkillCategory,
} from "../../ai/skills/builtin";
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

// Settings > Textus AI: skills (the user's own, and the built-ins with their
// switches, Customize… and Reset) and the Writing conventions row. Skills
// are files: the rows here mirror them and open them in a tab, they never
// embed an editor.

/** Fired after a skill changes here, so every section showing the list
 *  reloads it. */
const SKILLS_CHANGED_EVENT = "textus-skills-changed";

function announceChange() {
  window.dispatchEvent(new Event(SKILLS_CHANGED_EVENT));
}

/** The skill list as Settings shows it: the built-ins and the global
 *  layer (no document, so no project). `list` is null where the backend
 *  has no list (then only the global skills are known). */
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

/// The Skills row - how to use one, and Import Skill… - and the user's own
/// skills under it.
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
              (err: unknown) => setError(errorText(err)),
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

/// The user's own skills. A skill with a built-in's name says it replaces
/// it.
export function OwnSkillsList({ t }: { t: Strings }) {
  const { list, workspaceSkills } = useSkillList();
  const own: {
    name: string;
    description: string;
    source: SkillListItem["source"];
    shadows: boolean;
  }[] = list
    ? list
        // Copies made by Customize… show under Built-in skills instead.
        .filter((item) => item.source !== "builtin" && !item.basedOn)
        .map((item) => ({
          name: item.name,
          description: item.description,
          source: item.source,
          shadows: item.overridesBuiltin,
        }))
    : workspaceSkills.map((skill) => ({
        name: skill.name,
        description: skill.description || skill.prompt,
        source: "global",
        shadows: isBuiltinSkillName(skill.name),
      }));

  return (
    <>
      {own.length > 0 && (
        <div className="settings-skill-list">
          {own.map((skill) => (
            <div key={skill.name} className="settings-skill-item">
              <span className="settings-skill-name">/{skill.name}</span>
              {(skill.shadows || skill.source === "project") && (
                <span className="settings-skill-tag">
                  {skill.shadows ? t.agentSkillsShadows : t.skillGroupProject}
                </span>
              )}
              <span className="settings-skill-desc">{skill.description}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const CATEGORY_LABEL: Record<SkillCategory, TextKey> = {
  write: "skillCategoryWrite",
  revise: "skillCategoryRevise",
  check: "skillCategoryCheck",
  format: "skillCategoryFormat",
};

/// The built-in skills, by category, behind a disclosure: each one's label
/// and what it does, a switch, and Customize… - which copies it into the
/// global config folder's skills/ and opens the copy in a tab. A customized
/// one opens its copy instead, and Reset deletes the copy.
///
/// `only` shows one side without the disclosure: "on" the skills in use
/// (Settings › Extensions › Skills, where the switch turns one off), "off"
/// the rest, each with Install, which turns it on (Get more).
export function BuiltinSkillsSection({
  t,
  only,
  query = "",
  onOpenFile,
  onFilesDeleted,
  onClose,
}: {
  t: Strings;
  only?: "on" | "off";
  /** Get more's search: only the skills whose words hold every one. */
  query?: string;
  onOpenFile: (path: string) => void;
  onFilesDeleted?: (paths: string[]) => void;
  onClose: () => void;
}) {
  const { settings } = useSettings();
  const lang = settings.language;
  const { list, setList } = useSkillList();
  const [error, setError] = useState<string | null>(null);
  // The backend's error codes (ai::workspace) in the user's words.
  const failed = (err: unknown) => {
    const text = errorText(err);
    setError(
      text === "NOT_A_COPY"
        ? t.agentSkillsNotACopy
        : text === "UNKNOWN_BUILTIN"
          ? t.agentSkillsUnknownBuiltin
          : text,
    );
  };

  // One item per name (ai::workspace::list_skills): the built-in itself,
  // a copy made by Customize… (`basedOn`, which follows the switch), or a
  // skill the user wrote with that name, which replaces it outright.
  const item = (name: string) => list?.find((i) => i.name === name);
  const isCopy = (i: SkillListItem | undefined) =>
    !!i && i.source !== "builtin" && !!i.basedOn;
  const isOwn = (i: SkillListItem | undefined) =>
    !!i && i.source !== "builtin" && !i.basedOn;
  const enabled = (name: string) => item(name)?.enabled ?? true;
  const onCount = BUILTIN_SKILLS.filter((s) => enabled(s.name)).length;

  async function setEnabled(name: string, on: boolean) {
    setError(null);
    const before = list;
    // At once on screen; put back if the backend says no.
    setList(
      (list ?? []).map((i) =>
        i.name === name && !isOwn(i) ? { ...i, enabled: on } : i,
      ),
    );
    try {
      await ai.setBuiltinSkillEnabled(name, on);
      announceChange();
    } catch (err) {
      setList(before);
      failed(err);
    }
  }

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

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = (name: BuiltinSkillName) => {
    if (only && (only === "on") !== enabled(name)) return false;
    const text = skillText(lang, name);
    const haystack = `${name}\n${text.label}\n${text.hint}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  };
  const rows = (
    <>
      {error && (
        <div className="settings-error" role="alert">
          {error}
        </div>
      )}
      {SKILL_CATEGORIES.filter((category) =>
        BUILTIN_SKILLS.some((s) => s.category === category && shown(s.name)),
      ).map((category) => (
        <div
          key={category}
          className="settings-builtin-category"
          role="group"
          aria-label={t[CATEGORY_LABEL[category]]}
        >
          <div className="settings-builtin-category-title" aria-hidden="true">
            {t[CATEGORY_LABEL[category]]}
          </div>
          {BUILTIN_SKILLS.filter(
            (s) => s.category === category && shown(s.name),
          ).map(({ name }) => {
            const text = skillText(lang, name);
            const current = item(name);
            const customized = isCopy(current);
            const own = isOwn(current);
            // The copy predates the bundled built-in's latest version.
            const outdated = customized && !!current?.builtinUpdated;
            const on = enabled(name);
            return (
              <div
                key={name}
                className="settings-row settings-builtin-skill"
                data-skill={name}
                data-enabled={on}
              >
                <div className="settings-row-text">
                  <div className="settings-row-label">
                    {text.label}
                    {(customized || own) && (
                      <span className="settings-skill-tag" data-search-ignore>
                        {customized
                          ? t.agentSkillsCustomized
                          : t.agentSkillsShadows}
                      </span>
                    )}
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
                    <span className="settings-builtin-skill-name">/{name}</span>
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
                  {only === "off" ? (
                    <button
                      type="button"
                      className="plugin-install"
                      aria-label={`${t.pluginInstall}: ${text.label}`}
                      disabled={own}
                      onClick={() => setEnabled(name, true)}
                    >
                      {t.pluginInstall}
                    </button>
                  ) : (
                    <>
                      <span className="settings-skill-actions">
                        {own ? (
                          <button
                            className="settings-skill-action"
                            aria-label={`${t.agentSkillsOpen}: ${text.label}`}
                            onClick={() => openCopy(name)}
                          >
                            {t.agentSkillsOpen}
                          </button>
                        ) : customized ? (
                          <>
                            <button
                              className="settings-skill-action"
                              aria-label={`${t.agentSkillsOpen}: ${text.label}`}
                              onClick={() => openCopy(name)}
                            >
                              {t.agentSkillsOpen}
                            </button>
                            <button
                              className="settings-skill-action"
                              aria-label={`${t.agentSkillsReset}: ${text.label}`}
                              onClick={() => reset(name, text.label)}
                            >
                              {t.agentSkillsReset}
                            </button>
                          </>
                        ) : (
                          <button
                            className="settings-skill-action"
                            aria-label={`${t.agentSkillsCustomize}: ${text.label}`}
                            onClick={() => openCopy(name)}
                          >
                            {t.agentSkillsCustomize}
                          </button>
                        )}
                      </span>
                      <input
                        type="checkbox"
                        aria-label={text.label}
                        checked={on}
                        // The user's own skill of this name isn't the
                        // built-in's to turn off.
                        disabled={own}
                        onChange={(e) => setEnabled(name, e.target.checked)}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
  if (only) return rows;
  return (
    <details className="settings-advanced settings-builtin-skills">
      <summary>
        <span className="settings-builtin-skills-title">
          {t.agentSkillsBuiltin}
        </span>
        <span className="settings-builtin-skills-count" data-search-ignore>
          {t.agentSkillsOnCount
            .replace("{n}", String(onCount))
            .replace("{total}", String(BUILTIN_SKILLS.length))}
        </span>
      </summary>
      <div className="settings-advanced-body">{rows}</div>
    </details>
  );
}

/// Writing conventions: Automatic, or one profile - grouped by the
/// document language it is for.
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
