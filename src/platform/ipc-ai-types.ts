import type { AgentSkill, AgentTurn } from "../ai/types";
import type { SkillCategory } from "../ai/skills/builtin";

/**
 * What the AI commands send and return: stream events, completion hints,
 * the project's library and memory, writing conventions and their
 * findings, skills (ipc.ts). Each mirrors its Rust type.
 */

/// Mirrors ai::cancel::CANCELLED - the error string ai_agent_message rejects
/// with when a stop() call won the race against the in-flight request. Not a
/// real failure, so callers should treat it differently from other errors.
export const AI_CANCELLED = "cancelled";

/** A picture waiting for a decision. Mirrors `GeneratedImageData` in
 *  src-tauri/src/ai/images.rs. */
export interface GeneratedImageData {
  mime: string;
  ext: string;
  dataBase64: string;
}

/** Mirrors `WebSearchStatus` in src-tauri/src/ai/web/mod.rs. */
export interface WebSearchStatus {
  /** The provider searches by itself. */
  native: boolean;
  /** Otherwise, the search service Textus's web_search uses; null when
   *  none is set up. */
  service: string | null;
}

/** One live fragment of an in-flight ai_agent_message, delivered over a
 *  Tauri channel while the agent loop runs. Purely additive display data -
 *  the command still resolves with the complete turn list, which stays the
 *  authoritative result. Mirrors `StreamEvent` in src-tauri/src/ai/agent/events.rs;
 *  the two must stay in sync. */
export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "toolStart"; callId: string; name: string }
  | { type: "toolArgsDelta"; callId: string; delta: string }
  | {
      type: "picture";
      callId: string;
      line: string;
      id: string;
      width: number;
      height: number;
    }
  | { type: "turn"; turn: AgentTurn }
  /** The step being streamed came back garbled and is asked for again:
   *  drop what it streamed. */
  | { type: "retry" }
  /** The model is thinking: a fragment of its reasoning, or "" where the
   *  provider only says that it thinks. Never part of the reply. */
  | { type: "thinking"; text: string };

/** Where the cursor sits, beyond the raw text around it - what lets a
 *  completion fit the document instead of guessing from 2000 characters.
 *  Mirrors CompletionHints in src-tauri/src/ai/client/completion.rs. */
export interface CompletionHints {
  /** The document's first heading, when it has one. */
  title: string | null;
  /** Headings enclosing the cursor, outermost first. */
  section: string[];
  /** What the cursor is in: "paragraph", "heading", "list item", ... */
  block: string;
  /** "short" for the as-you-type nudge, "long" for an explicit request. */
  length: "short" | "long";
  /** How many alternatives to write (the manual trigger asks for three). */
  candidates?: number;
  /** The context's prose - its text without code blocks, diagram and math
   *  source - which the backend reads the language from. */
  prose?: string;
  /** The app's language, for when the prose is too short to tell. */
  uiLanguage?: string | null;
}

/** A project library entry (`.textus/library/*.md`, ai::project). */
export interface LibraryEntry {
  name: string;
  aliases: string[];
  include: "always" | "detected" | "never";
  /** Relative to the project root. */
  file: string;
  body: string;
  /** Set on an entry Textus AI wrote (ai::memory) - also listed under "AI
   *  remembered". */
  remembered: Remembered | null;
}

/** Where and when Textus AI remembered something - `Remembered` in
 *  src-tauri/src/ai/memory.rs. */
export interface Remembered {
  created: string;
  updated: string;
  conversation: string | null;
  title: string | null;
  document: string | null;
}

/** One thing Textus AI remembered by itself - `Memory` in ai/memory.rs.
 *  `id` is `<scope>/memory/<file stem>`. */
export interface Memory {
  id: string;
  scope: MemoryScope;
  kind: MemoryKind;
  text: string;
  /** Absolute path, for Edit. */
  file: string;
  remembered: Remembered;
  /** Whether it fits the prompt's budget and so goes with requests. */
  included: boolean;
}

export type MemoryScope = "project" | "personal";
/** `MemoryKind` in ai/memory.rs. */
export type MemoryKind = "requirement" | "preference" | "style";

/** One change the memory pass made - `Remembering` in ai/memory.rs: what
 *  is remembered now (or, `forgot`, what was taken back), and `previous`,
 *  the file before, for Undo to put back. */
export interface RememberedChange {
  remembered: string;
  scope: MemoryScope;
  created: boolean;
  text: string;
  previous: string | null;
  /** A library entry's name: whom or what `text` is about. */
  name?: string;
  forgot?: boolean;
}

/** Every memory for a document, personal first - `Memories` in
 *  ai/memory.rs. `chars` of the included ones, of `cap`. */
export interface Memories {
  items: Memory[];
  chars: number;
  cap: number;
}

/** Which library entries reached Textus AI - `LibraryUse` in
 *  ai/project.rs: the entries' `file`s, those that came up but didn't fit,
 *  and whether that was the last request (or the document's text alone,
 *  before any). */
export interface LibraryUse {
  included: string[];
  leftOut: string[];
  lastRequest: boolean;
  /** The limit per request, in characters. */
  cap: number;
}

/** What shapes Textus AI for one document - see docs/design/ai-concepts.md. */
export interface AgentWorkspaceInfo {
  /** The global writing instructions (agent.md), comments stripped. */
  instructions: string[];
  /** The project's writing instructions (.textus/agent.md), if any. */
  project_instructions: string | null;
  /** Global and project skills; a project skill replaces a global one of
   *  the same name. */
  skills: AgentSkill[];
  /** The project folder; null for an unsaved draft or a folder too broad
   *  to expose (home, a drive root). */
  root: string | null;
  style: string | null;
  library: LibraryEntry[];
  /** What the style profile's front matter sets for the writing
   *  conventions (`conventions:` and option keys) - ai::rules::profile. */
  conventions?: ProjectConventions;
  /** What Textus AI remembered by itself, personal and the project's. */
  memories: Memories;
  /** Settings > Textus AI > Remember automatically. */
  remember: boolean;
  /** The project has a Levis project's `.levis/` with files `.textus/`
   *  lacks - offered for conversion (ai::levis_project). */
  levis_project: boolean;
}

// ---------------------------------------------------------------------------
// Writing conventions (src-tauri/src/ai/rules/profile.rs)

/** The settings.json key of the global writing conventions default. No
 *  frontend code reads it, but keep it: profile.rs's tests check it against
 *  the key the backend uses. */
export const WRITING_CONVENTIONS_KEY = "writingConventions";
/** Its default value, and the per-language value meaning "no choice". */
export const WRITING_CONVENTIONS_AUTOMATIC = "automatic";

/** A document language as the rules engine names it. */
export type ConventionsLang =
  "zh-Hans" | "zh-Hant" | "en" | "ja" | "ko" | "es" | "fr" | "de" | "ru" | "pt";

/**
 * The profiles each language offers, the first entry being the one
 * Automatic uses (null: no national norm - universal rules and consistency
 * checks only). Mirrors LANGUAGE_PROFILES in src-tauri/src/ai/rules/profile.rs
 * (a Rust test keeps them the same); `writingConventionsOptions()` returns
 * the same data from Rust, with the option keys.
 */
export const WRITING_CONVENTIONS: Record<
  ConventionsLang,
  { automatic: string | null; profiles: string[] }
> = {
  "zh-Hans": {
    automatic: "zh-Hans-CN",
    profiles: [
      "zh-Hans-CN",
      "zh-Hans-CN/tech",
      "zh-Hans-CN/gongwen",
      "zh-Hans-CN/academic",
      "zh-Hans-CN/fiction",
      "zh-Hans-CN/newmedia",
      "zh-Hant-CN",
    ],
  },
  "zh-Hant": {
    automatic: "zh-Hant-TW",
    profiles: ["zh-Hant-TW", "zh-Hant-TW/gongwen", "zh-Hant-HK"],
  },
  en: {
    automatic: null,
    profiles: [
      "en-US/general",
      "en-US/news",
      "en-US/tech-google",
      "en-US/tech-microsoft",
      "en-US/apa",
      "en-US/mla",
      "en-GB/govuk",
      "en-GB/oxford",
      "en-US/army",
      "en-AU",
    ],
  },
  ja: {
    automatic: "ja/jtf",
    profiles: ["ja/jtf", "ja/koyobun", "ja/fiction", "ja/tech"],
  },
  ko: { automatic: "ko", profiles: ["ko", "ko/official"] },
  es: { automatic: null, profiles: ["es-ES", "es-419", "es/eu"] },
  fr: { automatic: null, profiles: ["fr-FR", "fr-CA", "fr-CH", "fr/eu"] },
  de: {
    automatic: null,
    profiles: ["de-DE", "de-DE/din5008", "de-AT", "de-CH", "de/eu"],
  },
  ru: { automatic: "ru", profiles: ["ru", "ru/gost"] },
  pt: {
    automatic: "pt-BR",
    profiles: ["pt-BR", "pt-BR/official", "pt-PT", "pt/eu"],
  },
};

/**
 * The stored setting: "automatic", one profile (what the Settings row
 * stores - it applies to documents in that profile's language), or a
 * profile per language (a language left out, or set to "automatic", stays
 * Automatic), with optional option keys (`cjk-latin-space`, `quotes`,
 * `fr.spacing`...).
 */
export type WritingConventionsSetting =
  | typeof WRITING_CONVENTIONS_AUTOMATIC
  | string
  | ({ [lang in ConventionsLang]?: string } & {
      options?: Record<string, string>;
    });

/** `.textus/style.md` front matter, as Rust read it. */
export interface ProjectConventions {
  profiles: string[];
  options: Record<string, string>;
}

/** A resolved profile (rules::Profile). */
export interface ConventionsProfile {
  id: string;
  lang: ConventionsLang;
  region: string | null;
  preset: string | null;
  /** Chosen by the user (settings or project) rather than Automatic. */
  explicit: boolean;
  source: "automatic" | "settings" | "project";
  options: Record<string, string>;
}

export interface WritingConventionsOptions {
  settingKey: string;
  automatic: string;
  languages: {
    lang: ConventionsLang;
    automaticProfile: string | null;
    profiles: string[];
  }[];
  options: { key: string; values: string[] }[];
}

export interface EffectiveConventions {
  lang: ConventionsLang | null;
  profile: ConventionsProfile | null;
  byLanguage: ConventionsProfile[];
}

/** One finding of the rules engine (rules::Finding). */
export interface ConventionsFinding {
  rule: string;
  /** Unicode-scalar offsets into the checked Markdown. */
  start: number;
  end: number;
  original: string;
  /** Null when the finding only flags. */
  suggestion: string | null;
  severity: "error" | "warning" | "info";
  /** "safe": fine to apply without review ("fix all"). */
  fix: "safe" | "suggest" | "none";
  priority: "P0" | "P1" | "P2";
  /** In the language of the text it fired on. */
  message: string;
  /** 1-based line. */
  line?: number;
}

export interface ConventionsReport {
  lang: ConventionsLang | null;
  profile: ConventionsProfile | null;
  findings: ConventionsFinding[];
}

/** An exact platform count (rules::measure). */
export interface TextMeasure {
  metric: string;
  count: number;
  limit: number | null;
  unit: string;
  within: boolean;
  notes: string[];
}

/**
 * One skill as the `/` menu and Settings list it (ai::workspace::AgentSkill,
 * from `list_skills`): the built-ins, the global config folder's skills/
 * and the project's .textus/skills/, each layer replacing same-named skills
 * of the layers before it. Hidden skills are never listed.
 */
export interface SkillListItem {
  /** Canonical, ASCII kebab-case for a built-in; what follows the `/`. */
  name: string;
  description: string;
  /** The body sent to the model (comments stripped, packs not in it). */
  prompt?: string;
  /** The `/` menu's group; null for a user skill that doesn't say. */
  category: SkillCategory | null;
  /** "userOnly": offered in the `/` menu but never picked up by the model
   *  on its own. */
  invocation: "both" | "userOnly" | "hidden";
  source: "builtin" | "global" | "project";
  /** A global or project skill with a built-in's name - a copy made by
   *  Customize… (`basedOn` set), or the user's own skill that happens to
   *  share it. */
  overridesBuiltin: boolean;
  /** False for a built-in turned off in Settings, and for a copy of one
   *  made by Customize… (it stays listed so Settings can turn it back on;
   *  the `/` menu leaves it out). */
  enabled: boolean;
  /** Extra words typed after `/` for it, by UI language code. */
  aliases: Record<string, string[]>;
  /** Reference-pack sections Rust appends when it is used. */
  packs?: string[];
  /** A built-in's `textus-version`. */
  version?: string | null;
  /** "tighten@1" on a copy made by Customize… - only then can Reset
   *  delete it. */
  basedOn?: string | null;
  /** That copy is older than the bundled built-in. */
  builtinUpdated?: boolean;
}
