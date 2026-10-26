import type { SkillListItem } from "../../platform/ipc";
import type { Lang } from "../../i18n/langs";
import { LANGS } from "../../i18n/langs";
import { SKILL_TEXTS } from "../skills/texts";
import {
  BUILTIN_SKILLS,
  SKILL_CATEGORIES,
  isBuiltinSkillName,
  type SkillCategory,
} from "../skills/builtin";
import type { AgentSkill } from "../types";
import type { AgentMode } from "../../settings/settings-types";
import { getUiState, setUiState } from "../../storage/ui-state";
import { CJK_SCRIPT } from "../../utils/cjk";

/**
 * The composer's two pickers, as plain functions: when they open, what they
 * list, and what a typed `/word` means. ChatComposer only renders them.
 *
 * A Chinese IME types the slash key as `、` (Pinyin layouts) or `／`, a
 * Japanese one as `・`, and the at-sign as `＠` - a picker that answered
 * only to the ASCII characters stayed shut for those users, which looked
 * like no skills at all.
 */

/** The input is one `/word` still being typed: the skill picker is open. */
export const SKILL_TRIGGER = /^[/／、・](\S*)$/;
/** A whole `/word rest…` message: the word, then whatever follows it. */
export const SKILL_COMMAND = /^[/／、・](\S+)(?:\s+([\s\S]*))?$/;
/** An `@path` being typed at the end of the input: the file picker. */
export const MENTION_TRIGGER = /(?:^|\s)[@＠]([^\s@＠]*)$/;
/** The same `@path`, for removing it once a file is picked. */
export const MENTION_TOKEN = /(^|\s)[@＠][^\s@＠]*$/;

/** How many recently used skills lead the menu. */
const RECENT_LIMIT = 5;

/** One row of the skill picker. */
export interface PickerSkill {
  name: string;
  /** A built-in's label in the UI language; null for the user's own
   *  skills, which are shown by their `/name`. */
  label: string | null;
  /** One line on what it does. */
  hint: string;
  source: SkillListItem["source"];
  /** The built-ins' group; null for the user's own skills, which are
   *  grouped by where they come from. */
  category: SkillCategory | null;
  /** What filtering matches: the name, and the label and aliases in the
   *  UI language and English. */
  terms: string[];
  /** What a typed `/word` resolves by: every language's labels and
   *  aliases, so `/续写` works whatever the UI is in. */
  allTerms: string[];
}

/** Case- and width-insensitive form for matching (NFKC folds full-width
 *  Latin typed with a CJK IME on). */
export function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase();
}

const ORDER = new Map<string, number>(
  BUILTIN_SKILLS.map((skill, index) => [skill.name, index]),
);

/** The skill list a workspace load gives (name, description, prompt), in
 *  the list's shape - for when there is no `list_skills` answer. */
export function listFromWorkspace(skills: AgentSkill[]): SkillListItem[] {
  return skills.map((skill) => {
    const builtin = BUILTIN_SKILLS.find((b) => b.name === skill.name);
    const category = skill.category ?? builtin?.category ?? null;
    return {
      name: skill.name,
      description: skill.description || skill.prompt,
      prompt: skill.prompt,
      category: (SKILL_CATEGORIES as readonly string[]).includes(category ?? "")
        ? (category as SkillCategory)
        : null,
      invocation: skill.invocation ?? builtin?.invocation ?? "both",
      source: skill.source ?? "global",
      overridesBuiltin: skill.overridesBuiltin ?? false,
      modes: skill.modes ?? ["write"],
      labels: skill.labels,
      aliases: skill.aliases ?? {},
      basedOn: skill.basedOn ?? null,
    };
  });
}

/** The skills the `/` menu offers in `mode`, in the UI language: hidden
 *  reference packs and other modes' skills left out. */
export function pickerSkills(
  items: SkillListItem[],
  lang: Lang,
  mode: AgentMode,
): PickerSkill[] {
  return items
    .filter(
      (item) =>
        (item.modes ?? ["write"]).includes(mode) &&
        (item.invocation as string) !== "hidden",
    )
    .map((item) => {
      // A built-in, or a copy of one made by Customize…; a skill the user
      // wrote with a built-in's name is theirs, shown by its /name.
      const builtin =
        isBuiltinSkillName(item.name) &&
        (item.source === "builtin" || !!item.basedOn || !item.overridesBuiltin)
          ? item.name
          : null;
      // A market or user skill names itself in its file, per language.
      const own = item.labels ?? {};
      const local = builtin
        ? SKILL_TEXTS[lang][builtin]
        : (own[lang] ?? own.en ?? null);
      const english = builtin ? SKILL_TEXTS.en[builtin] : (own.en ?? null);
      const backend = item.aliases ?? {};
      const terms = [
        item.name,
        ...(local ? [local.label] : []),
        ...(english ? [english.label] : []),
        ...(builtin ? [...SKILL_TEXTS[lang][builtin].aliases] : []),
        ...(builtin ? [...SKILL_TEXTS.en[builtin].aliases] : []),
        ...(backend[lang] ?? []),
        ...(backend.en ?? []),
      ];
      const allTerms = [
        item.name,
        ...(builtin
          ? LANGS.flatMap((code) => {
              const text = SKILL_TEXTS[code][builtin];
              return [text.label, ...text.aliases];
            })
          : Object.values(own).map((l) => l.label)),
        ...Object.values(backend).flat(),
      ];
      return {
        name: item.name,
        label: local?.label ?? null,
        // A copy made by Customize… keeps the built-in's words: its own
        // description is the long one written for the model.
        hint: local?.hint || item.description,
        source: item.source,
        category: builtin ? (item.category ?? null) : null,
        terms: unique(terms),
        allTerms: unique(allTerms),
      };
    });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.trim()))];
}

/** How well `skill` matches the folded query: lower is better, -1 none. */
function score(skill: PickerSkill, query: string): number {
  if (!query) return 0;
  const terms = skill.terms.map(fold);
  if (terms.includes(query) || skill.allTerms.map(fold).includes(query))
    return 0;
  if (fold(skill.name).startsWith(query)) return 1;
  const words = (term: string) => term.split(/[\s\-·・、,]+/);
  if (
    terms.some(
      (t) => t.startsWith(query) || words(t).some((w) => w.startsWith(query)),
    )
  )
    return 2;
  // CJK labels have no spaces to start a word at: 写 should find 接着写.
  if (CJK_SCRIPT.test(query) && terms.some((t) => t.includes(query))) return 3;
  // Another language's word - a bilingual user typing /続き in English.
  if (skill.allTerms.some((t) => fold(t).startsWith(query))) return 4;
  return -1;
}

function sortKey(skill: PickerSkill): number {
  return ORDER.get(skill.name) ?? 1000;
}

/** The skills matching what follows the `/`, best first: an exact name,
 *  label or alias, then prefixes; ties go to the recently used. */
export function matchSkills(
  skills: PickerSkill[],
  query: string,
  recent: string[],
): PickerSkill[] {
  const q = fold(query);
  const rank = (name: string) => {
    const i = recent.indexOf(name);
    return i < 0 ? RECENT_LIMIT + 1 : i;
  };
  return skills
    .map((skill) => ({ skill, score: score(skill, q) }))
    .filter((entry) => entry.score >= 0)
    .sort(
      (a, b) =>
        a.score - b.score ||
        rank(a.skill.name) - rank(b.skill.name) ||
        sortKey(a.skill) - sortKey(b.skill) ||
        a.skill.name.localeCompare(b.skill.name),
    )
    .map((entry) => entry.skill);
}

export type PickerGroupId = "recent" | "project" | "global" | SkillCategory;

export interface PickerGroup {
  id: PickerGroupId;
  skills: PickerSkill[];
}

/** The menu for a bare `/`: the recently used first, then this project's
 *  skills, the user's own, and the built-ins by category. */
export function groupSkills(
  skills: PickerSkill[],
  recent: string[],
): PickerGroup[] {
  const recentSkills = recent
    .map((name) => skills.find((s) => s.name === name))
    .filter((s): s is PickerSkill => !!s)
    .slice(0, RECENT_LIMIT);
  const shown = new Set(recentSkills.map((s) => s.name));
  const rest = skills.filter((s) => !shown.has(s.name));
  const byName = (a: PickerSkill, b: PickerSkill) =>
    sortKey(a) - sortKey(b) || a.name.localeCompare(b.name);
  const groups: PickerGroup[] = [
    { id: "recent", skills: recentSkills },
    {
      id: "project",
      skills: rest.filter((s) => !s.category && s.source === "project"),
    },
    {
      id: "global",
      skills: rest.filter((s) => !s.category && s.source !== "project"),
    },
    ...SKILL_CATEGORIES.map((category) => ({
      id: category,
      skills: rest.filter((s) => s.category === category),
    })),
  ];
  return groups
    .map((g) => ({
      ...g,
      skills: [...g.skills].sort(g.id === "recent" ? () => 0 : byName),
    }))
    .filter((g) => g.skills.length > 0);
}

/** The skill a typed `/word` names - its name, or any language's label or
 *  alias for it - or null when it names none (then it is just text that
 *  starts with a slash). */
export function resolveSkillName(
  token: string,
  skills: PickerSkill[],
): string | null {
  const exact = skills.find((s) => s.name === token);
  if (exact) return exact.name;
  const q = fold(token);
  return (
    skills.find((s) => fold(s.name) === q)?.name ??
    skills.find((s) => s.allTerms.some((t) => fold(t) === q))?.name ??
    null
  );
}

/** The recently used skills, newest first (ui-state.json). */
export function recentSkills(): string[] {
  const value = getUiState("recentSkills");
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

export function rememberSkill(name: string): void {
  setUiState(
    "recentSkills",
    [name, ...recentSkills().filter((n) => n !== name)].slice(0, RECENT_LIMIT),
  );
}
