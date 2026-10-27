import type { SkillCategory } from "../ai/skills/builtin";
import type { WebSearchStatus_Serialize } from "./bindings/ai";
import type {
  GeneratedImageData as GeneratedImage,
  StreamEvent_Serialize,
} from "./bindings/ai-agent";
import type { Lang } from "./bindings/ai-conventions";
import type {
  LibraryUse as LibraryUseAnswer,
  Remembering_Serialize,
} from "./bindings/ai-memory";
import type {
  AgentMode_Serialize as AgentMode,
  AgentSkill_Serialize,
  AgentWorkspace_Serialize,
  LibraryEntry_Serialize,
  MemoryKind as Kind,
  Memory_Serialize,
  Remembered_Serialize,
  Scope,
  SkillLabel,
} from "./bindings/ai-project";

/**
 * What the AI commands send and return. Rust's answers are generated types,
 * renamed here; requests keep their own narrower types where they have one.
 */

/// The error ai_agent_message rejects with when stop() won the race. Not a
/// real failure, so callers treat it apart from other errors.
export const AI_CANCELLED = "cancelled";

/** A picture waiting for a decision. */
export type GeneratedImageData = GeneratedImage;

/** Whether the provider searches by itself, and otherwise the search
 *  service web_search uses, null when none is set up. */
export type WebSearchStatus = WebSearchStatus_Serialize;

/** One live fragment of an in-flight ai_agent_message. Display only: the
 *  command still resolves with the authoritative turn list. */
export type StreamEvent = StreamEvent_Serialize;

/** Where the cursor sits, beyond the raw text around it, so a completion
 *  fits the document. Narrower than the Rust type. */
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
  /** The context's text without code, diagram and math source, which the
   *  backend reads the language from. */
  prose?: string;
  /** The app's language, for when the prose is too short to tell. */
  uiLanguage?: string | null;
}

/** A project library entry; `remembered` is set on one Textus AI wrote. */
export type LibraryEntry = LibraryEntry_Serialize;

/** Where and when Textus AI remembered something. */
export type Remembered = Remembered_Serialize;

/** One thing Textus AI remembered by itself. `id` is
 *  `<scope>/memory/<file stem>`. */
export type Memory = Memory_Serialize;

export type MemoryScope = Scope;
export type MemoryKind = Kind;

/** One change the memory pass made, with `previous`, the file before, for
 *  Undo to put back. */
export type RememberedChange = Remembering_Serialize;

/** Which library entries reached Textus AI. */
export type LibraryUse = LibraryUseAnswer;

/** What shapes Textus AI for one document. */
export type AgentWorkspaceInfo = AgentWorkspace_Serialize;

// Writing conventions

/** The settings.json key of the writing conventions default. Unread here,
 *  but a Rust test checks it against the backend's key.
 *  @public */
export const WRITING_CONVENTIONS_KEY = "writingConventions";
/** Its default value, and the per-language value meaning "no choice";
 *  checked by the same test.
 *  @public */
export const WRITING_CONVENTIONS_AUTOMATIC = "automatic";

/** A document language as the rules engine names it. */
export type ConventionsLang = Lang;

/**
 * The profiles each language offers, the first being Automatic's (null: no
 * national norm). A Rust test keeps this in step with the backend's list.
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
 * One skill as the `/` menu and Settings list it; later layers replace
 * same-named skills. Hand-written: the frontend builds some itself, and
 * `category` is narrower than Rust's string.
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
  /** A global or project skill sharing a built-in's name: a Customize… copy
   *  (`basedOn` set) or the user's own. */
  overridesBuiltin: boolean;
  /** The panel modes it applies in; only those offer it in the `/` menu.
   *  Write's for a skill that doesn't say. */
  modes: AgentMode[];
  /** A market or user skill's name and one-line hint, by UI language code. */
  labels?: Record<string, SkillLabel>;
  /** Extra words typed after `/` for it, by UI language code. */
  aliases: Record<string, string[]>;
  /** Reference-pack sections Rust appends when it is used. */
  packs?: string[];
  /** A built-in's `textus-version`. */
  version?: string | null;
  /** "tighten@1" on a Customize… copy; only then can Reset delete it. */
  basedOn?: string | null;
  /** That copy is older than the bundled built-in. */
  builtinUpdated?: boolean;
}
