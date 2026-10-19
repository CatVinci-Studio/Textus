/**
 * The built-in writing skills the app ships (src-tauri/src/ai/skills/, the
 * catalogue's §1), as far as the frontend needs to know them: the name, the
 * `/` menu's group, and whether the model may pick one up by itself. Their
 * words for people - label, one-line hint, the aliases typed after `/` -
 * live in src/i18n/skills/<code>.ts, one file per UI language.
 *
 * The backend's skill list (`list_skills`) is the authority on which exist
 * and which are on; this list is the order Settings shows them in and the
 * fallback when a list comes without them.
 */

export const SKILL_CATEGORIES = ["write", "revise", "check", "format"] as const;
export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

export const BUILTIN_SKILLS = [
  { name: "continue-story", category: "write", invocation: "both" },
  { name: "describe", category: "write", invocation: "both" },
  { name: "dialogue", category: "write", invocation: "both" },
  { name: "imitate-style", category: "write", invocation: "both" },
  { name: "expand", category: "revise", invocation: "userOnly" },
  { name: "tighten", category: "revise", invocation: "userOnly" },
  { name: "change-tone", category: "revise", invocation: "userOnly" },
  { name: "de-ai", category: "revise", invocation: "both" },
  { name: "translate", category: "revise", invocation: "both" },
  { name: "proofread", category: "check", invocation: "both" },
  { name: "continuity", category: "check", invocation: "both" },
  { name: "email", category: "format", invocation: "both" },
  { name: "notice", category: "format", invocation: "both" },
  { name: "minutes", category: "format", invocation: "both" },
  { name: "academic-polish", category: "format", invocation: "both" },
  { name: "social-post", category: "format", invocation: "both" },
  { name: "headline", category: "format", invocation: "both" },
  { name: "summarize", category: "format", invocation: "userOnly" },
  { name: "theme", category: "format", invocation: "both" },
] as const satisfies readonly {
  name: string;
  category: SkillCategory;
  invocation: "both" | "userOnly";
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
