import { PLUGINS_SHOWN } from "../../plugins/store/availability";
import type { Strings } from "../../i18n/strings";

/** What Settings › Extensions › Create makes; each is the name of the
 *  built-in skill that makes it. */
export type CreateKind = "plugin" | "theme" | "skill";

/** The kinds offered, plugins first where the app shows them. */
export function createKinds(pluginsShown = PLUGINS_SHOWN): CreateKind[] {
  return pluginsShown ? ["plugin", "theme", "skill"] : ["theme", "skill"];
}

/** The first message: the kind's skill called by name, so the AI starts
 *  with its instructions loaded instead of guessing what is wanted. */
export function createMessage(kind: CreateKind, text: string): string {
  return `/${kind} ${text.trim()}`;
}

/** Two starting points for each kind, as the user would say them. */
export const CREATE_EXAMPLES: Record<CreateKind, readonly (keyof Strings)[]> = {
  plugin: ["createExamplePluginTodo", "createExamplePluginCount"],
  theme: ["createExampleThemeAmber", "createExampleThemeMono"],
  skill: ["createExampleSkillWeekly", "createExampleSkillPolish"],
};
