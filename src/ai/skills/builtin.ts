import type { AgentMode } from "../../settings/settings-types";

/** The built-in skills as the frontend needs them. The backend's list decides
 *  which exist; this one sets Settings' order and is the fallback. */

export const SKILL_CATEGORIES = [
  "write",
  "revise",
  "check",
  "format",
  "create",
] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Each mode's own skills, always on; every other skill comes from the
 *  market. Keep in step with the backend's skill files. */
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
