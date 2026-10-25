import type { SkillCategory } from "../ai/skills/builtin";
import type { WebSearchStatus_Serialize } from "./bindings/ai";
import type {
  GeneratedImageData as GeneratedImage,
  StreamEvent_Serialize,
} from "./bindings/ai-agent";
import type {
  ConventionsOptions_Serialize,
  DocReport_Serialize,
  EffectiveConventions_Serialize,
  Finding_Serialize,
  Lang,
  Measure_Serialize,
  Profile_Serialize,
} from "./bindings/ai-conventions";
import type {
  LibraryUse as LibraryUseAnswer,
  Remembering_Serialize,
} from "./bindings/ai-memory";
import type {
  AgentMode_Serialize as AgentMode,
  AgentSkill_Serialize,
  AgentWorkspace_Serialize,
  Forgotten_Serialize,
  LibraryEntry_Serialize,
  Memories_Serialize,
  MemoryKind as Kind,
  Memory_Serialize,
  ProjectConventions as StyleFrontMatter,
  Remembered_Serialize,
  Scope,
  SkillLabel,
} from "./bindings/ai-project";

/**
 * What the AI commands send and return: stream events, completion hints,
 * the project's library and memory, writing conventions and their
 * findings, skills (ipc.ts). What Rust answers is generated from its types
 * (src/platform/bindings/ai*.ts) and named here as the callers know it;
 * what the frontend sends keeps its own, narrower type where it has one,
 * which ipc.ts checks against the generated request.
 */

/// Mirrors ai::cancel::CANCELLED - the error string ai_agent_message rejects
/// with when a stop() call won the race against the in-flight request. Not a
/// real failure, so callers should treat it differently from other errors.
export const AI_CANCELLED = "cancelled";

/** A picture waiting for a decision (ai/images/pending.rs). */
export type GeneratedImageData = GeneratedImage;

/** Whether the provider searches by itself, and otherwise the search
 *  service Textus's web_search uses, null when none is set up
 *  (ai/web/mod.rs). */
export type WebSearchStatus = WebSearchStatus_Serialize;

/** One live fragment of an in-flight ai_agent_message, delivered over a
 *  Tauri channel while the agent loop runs (ai/agent/events.rs). Purely
 *  additive display data - the command still resolves with the complete
 *  turn list, which stays the authoritative result. */
export type StreamEvent = StreamEvent_Serialize;

/** Where the cursor sits, beyond the raw text around it - what lets a
 *  completion fit the document instead of guessing from 2000 characters.
 *  Narrower than CompletionHints in src-tauri/src/ai/client/completion.rs,
 *  which takes the strings as they come; ipc.ts checks it against the
 *  generated type. */
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

/** A project library entry (`.textus/library/*.md`, ai::project);
 *  `remembered` is set on an entry Textus AI wrote (ai::memory). */
export type LibraryEntry = LibraryEntry_Serialize;

/** Where and when Textus AI remembered something (ai/memory.rs). */
export type Remembered = Remembered_Serialize;

/** One thing Textus AI remembered by itself (ai/memory.rs). `id` is
 *  `<scope>/memory/<file stem>`. */
export type Memory = Memory_Serialize;

export type MemoryScope = Scope;
export type MemoryKind = Kind;

/** One change the memory pass made - `Remembering` in ai/memory.rs: what
 *  is remembered now (or, `forgot`, what was taken back), and `previous`,
 *  the file before, for Undo to put back. */
export type RememberedChange = Remembering_Serialize;

/** Every memory for a document, personal first, and what was deleted or
 *  forgotten lately (ai/memory.rs). */
export type Memories = Memories_Serialize;

/** A deleted or forgotten memory or library entry, kept to restore
 *  (ai/memory/forgotten.rs). */
export type ForgottenMemory = Forgotten_Serialize;

/** Which library entries reached Textus AI (ai/project.rs). */
export type LibraryUse = LibraryUseAnswer;

/** What shapes Textus AI for one document - `AgentWorkspace` in
 *  ai/workspace.rs; see docs/design/ai-concepts.md. */
export type AgentWorkspaceInfo = AgentWorkspace_Serialize;

// ---------------------------------------------------------------------------
// Writing conventions (src-tauri/src/ai/rules/profile.rs)

/** The settings.json key of the global writing conventions default. No
 *  frontend code reads it, but keep it: profile.rs's tests check it against
 *  the key the backend uses. */
export const WRITING_CONVENTIONS_KEY = "writingConventions";
/** Its default value, and the per-language value meaning "no choice". */
export const WRITING_CONVENTIONS_AUTOMATIC = "automatic";

/** A document language as the rules engine names it (rules::detect). */
export type ConventionsLang = Lang;

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
export type ProjectConventions = StyleFrontMatter;

/** A resolved profile (rules::Profile). */
export type ConventionsProfile = Profile_Serialize;

export type WritingConventionsOptions = ConventionsOptions_Serialize;

export type EffectiveConventions = EffectiveConventions_Serialize;

/** One finding of the rules engine (rules::Finding). */
export type ConventionsFinding = Finding_Serialize;

export type ConventionsReport = DocReport_Serialize;

/** An exact platform count (rules::measure). */
export type TextMeasure = Measure_Serialize;

/**
 * One skill as the `/` menu and Settings list it (ai::workspace::AgentSkill,
 * from `list_skills`): the built-ins, the global config folder's skills/
 * and the project's .textus/skills/, each layer replacing same-named skills
 * of the layers before it. Hidden skills are never listed. Written by hand:
 * the frontend also makes one from a workspace's skills (skill-picker.ts),
 * where the later fields are unknown, and `category` is one of the `/`
 * menu's groups where Rust holds a plain string. Its other fields are
 * AgentSkill's (src/platform/bindings/ai-skills.ts).
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
  invocation: AgentSkill_Serialize["invocation"];
  source: AgentSkill_Serialize["source"];
  /** A global or project skill with a built-in's name - a copy made by
   *  Customize… (`basedOn` set), or the user's own skill that happens to
   *  share it. */
  overridesBuiltin: boolean;
  /** The panel modes it applies in; only those offer it in the `/` menu.
   *  Write's for a skill that doesn't say. */
  modes: AgentMode[];
  /** What a market or user skill is called, and its one-line hint, by UI
   *  language code (a built-in's are in src/ai/skills/texts). */
  labels?: Record<string, SkillLabel>;
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
