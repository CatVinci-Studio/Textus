import type {
  AgentMode,
  Creation,
  CreationKind,
  UserThemeMeta,
} from "../../prefs/settings-types";
import type { PluginRecord } from "../../plugins/store/plugin-records";

/**
 * What Create made, across the three stores it installs into: plugins,
 * user themes and global skills each keep their own files, and the
 * settings' `creations` only remembers which entries came from a reply's
 * card. Pure: the cards and the list do the installing and removing.
 */

/** `list` with `made` first, over an earlier entry for the same thing. */
export function withCreation(list: Creation[], made: Creation): Creation[] {
  return [made, ...withoutCreation(list, made.kind, made.id)];
}

export function withoutCreation(
  list: Creation[],
  kind: CreationKind,
  id: string,
): Creation[] {
  return list.filter((c) => !(c.kind === kind && c.id === id));
}

/** A global skill as the list needs it (`AgentSkill` from list_skills). */
export interface SkillState {
  name: string;
  source?: string;
  modes?: AgentMode[];
  off?: boolean;
}

/** Where each made thing stands now. */
export type CreationState =
  | { kind: "plugin"; on: boolean; problem: boolean }
  | { kind: "theme"; inUse: boolean }
  | { kind: "skill"; modes: AgentMode[]; off: boolean }
  /** Not looked up yet (the skills are still loading). */
  | { kind: "unknown" };

export interface CreationRow {
  creation: Creation;
  state: CreationState;
}

/** The made things still installed, newest first, with where each stands.
 *  One removed elsewhere (Settings, another window, the Finder) is left out
 *  but stays remembered, so a reinstall of it shows again;
 *  `skills` null means they haven't loaded, and keeps every skill. */
export function creationRows(
  list: Creation[],
  now: {
    plugins: PluginRecord[];
    userThemes: UserThemeMeta[];
    themeId: string;
    skills: SkillState[] | null;
  },
): CreationRow[] {
  const rows: CreationRow[] = [];
  for (const creation of [...list].sort((a, b) => b.at - a.at)) {
    const state = stateOf(creation, now);
    if (state) rows.push({ creation, state });
  }
  return rows;
}

function stateOf(
  creation: Creation,
  now: Parameters<typeof creationRows>[1],
): CreationState | null {
  switch (creation.kind) {
    case "plugin": {
      const record = now.plugins.find((r) => r.id === creation.id);
      if (!record) return null;
      return {
        kind: "plugin",
        on: record.status === "on",
        problem: record.status === "broken" || record.status === "incompatible",
      };
    }
    case "theme":
      return now.userThemes.some((t) => t.id === creation.id)
        ? { kind: "theme", inUse: now.themeId === creation.id }
        : null;
    case "skill": {
      if (!now.skills) return { kind: "unknown" };
      const skill = now.skills.find(
        (s) => s.name === creation.id && s.source === "global",
      );
      return skill
        ? { kind: "skill", modes: skill.modes ?? [], off: skill.off ?? false }
        : null;
    }
  }
}
