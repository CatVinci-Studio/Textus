import type { AgentMode } from "../../settings/settings-types";

/**
 * The built-in skills the app ships (src-tauri/src/ai/skills/), as far as
 * the frontend needs to know them: the name, the `/` menu's group, whether
 * the model may pick one up by itself, and the panel mode it belongs to. Their
 * words for people - label, one-line hint, the aliases typed after `/` -
 * live in src/i18n/skills/<code>.ts, one file per UI language.
 *
 * The backend's skill list (`list_skills`) is the authority on which exist
 * and which are on; this list is the order Settings shows them in and the
 * fallback when a list comes without them.
 */

export const SKILL_CATEGORIES = [
  "write",
  "revise",
  "check",
  "format",
  "create",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Each mode's own skills, always on (src-tauri/src/ai/skills/*.md says
 *  the same in `textus-modes`); every other skill comes from the market. */
export const BUILTIN_SKILLS = [
  { name: "expand", category: "revise", invocation: "userOnly", mode: "write" },
  {
    name: "tighten",
    category: "revise",
    invocation: "userOnly",
    mode: "write",
  },
  { name: "translate", category: "revise", invocation: "both", mode: "write" },
  {
    name: "summarize",
    category: "format",
    invocation: "userOnly",
    mode: "write",
  },
  { name: "proofread", category: "check", invocation: "both", mode: "review" },
  { name: "continuity", category: "check", invocation: "both", mode: "review" },
  { name: "theme", category: "create", invocation: "both", mode: "create" },
  { name: "plugin", category: "create", invocation: "both", mode: "create" },
  { name: "skill", category: "create", invocation: "both", mode: "create" },
] as const satisfies readonly {
  name: string;
  category: SkillCategory;
  invocation: "both" | "userOnly";
  mode: AgentMode;
}[];

export type BuiltinSkillName = (typeof BUILTIN_SKILLS)[number]["name"];

const NAMES = new Set<string>(BUILTIN_SKILLS.map((s) => s.name));

export function isBuiltinSkillName(name: string): name is BuiltinSkillName {
  return NAMES.has(name);
}

/** A built-in's words in one UI language. */
export interface SkillText {
  /** What Settings and the `/` menu call it (about 24 characters at most). */
  label: string;
  /** One line on what it does. */
  hint: string;
  /** Extra words people type after `/` for it, besides its name and label. */
  aliases: string[];
}

/** One language's file: every built-in, so none shows in another language. */
export type SkillTexts = Record<BuiltinSkillName, SkillText>;
