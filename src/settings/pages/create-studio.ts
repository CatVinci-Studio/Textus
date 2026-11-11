import type { Strings } from "../../i18n/strings";

import type { CreateKind } from "../../ai/chat/create-request";

export type { CreateKind };

/** The kinds offered, plugins first. */
export const CREATE_KINDS: readonly CreateKind[] = ["plugin", "theme", "skill"];

/** The first message: the kind's skill called by name, so the AI starts
 *  with its instructions loaded instead of guessing what is wanted. */
export function createMessage(kind: CreateKind, text: string): string {
  return `/${kind} ${text.trim()}`;
}

/** A starting point for each kind, as the user would say it. */
export const CREATE_EXAMPLES: Record<CreateKind, keyof Strings> = {
  plugin: "createExamplePluginTodo",
  theme: "createExampleThemeAmber",
  skill: "createExampleSkillWeekly",
};
