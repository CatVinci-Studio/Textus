import type { AgentMode_Serialize as AgentMode } from "./bindings/ai-skills";
import { isIOSApp } from "./capabilities";
import { iosFiles } from "./ios-files";
import { command, desktopActionCommand, desktopQueryCommand } from "./ipc-call";
import type { SkillListItem } from "./ipc-ai-types";

/** The AI's project folder, its agent.md and the skills: where they are and
 *  what applies in which mode. Part of `ai`. */
export const aiWorkspace = {
  /** Folder picker behind "Choose project folder…". */
  pickWorkspaceRoot: (): Promise<string | null> =>
    isIOSApp
      ? iosFiles.pickProjectFolder()
      : desktopQueryCommand("pick_workspace_root", null),
  /** Reveals the global config folder, creating it with `template` as its
   *  agent.md on first use. */
  openGlobalAgentDir: (template: string) =>
    desktopActionCommand("open_global_agent_dir", template),
  /** The global agent.md's path, created from `template` if missing. */
  ensureGlobalAgentMd: (template: string) =>
    command("ensure_global_agent_md", template),
  importAgentSkill: () => command("import_agent_skill"),
  /** Every skill for this document with the modes it applies in. Both null:
   *  the built-ins and the global ones, as Settings shows them. */
  listSkills: (docPath: string | null, workspaceRoot: string | null) =>
    command("list_skills", docPath, workspaceRoot) as Promise<SkillListItem[]>,
  /** Copies a built-in into the global skills/ (or finds the copy) and
   *  returns its path, to open in a tab. */
  customizeBuiltinSkill: (name: string) =>
    command("customize_builtin_skill", name),
  /** Deletes the Customize… copy so the built-in applies again; returns the
   *  deleted files' paths. */
  resetBuiltinSkill: (name: string) => command("reset_builtin_skill", name),
  /** Moves one of the user's global skills to the Trash; returns the
   *  deleted files' paths. */
  deleteGlobalSkill: (name: string) => command("delete_global_skill", name),
  /** Sets the modes a user skill applies in; a built-in's are fixed. */
  setSkillModes: (
    name: string,
    source: SkillListItem["source"],
    docPath: string | null,
    workspaceRoot: string | null,
    modes: AgentMode[],
  ) => command("set_skill_modes", name, source, docPath, workspaceRoot, modes),
  /** Turns a user skill off for now, or on again; a built-in is always on. */
  setSkillOff: (
    name: string,
    source: SkillListItem["source"],
    docPath: string | null,
    workspaceRoot: string | null,
    off: boolean,
  ) => command("set_skill_off", name, source, docPath, workspaceRoot, off),
};
