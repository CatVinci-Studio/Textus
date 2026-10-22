/**
 * The operations a propose_edit tool call can carry. Mirrors EDIT_ACTIONS in
 * src-tauri/src/ai/tools/ - the backend validates proposals against the
 * same list, so the two must stay in sync.
 */
export type EditAction =
  | "replace"
  | "replace_selection"
  | "insert_before"
  | "insert_after"
  | "delete"
  | "append"
  | "insert_at_cursor";

export const EDIT_ACTIONS: readonly EditAction[] = [
  "replace",
  "replace_selection",
  "insert_before",
  "insert_after",
  "delete",
  "append",
  "insert_at_cursor",
];

/** A validated propose_edit payload: what to do, where, and with what text. */
export interface EditProposal {
  action: EditAction;
  /** The id of the block the edit is in (doc-blocks.ts) - where it is
   *  placed - and of the run's last block, for a run. Absent for `append`,
   *  `replace_selection`, `insert_at_cursor`, and an edit of text proposed
   *  and not decided yet (which has no id: `anchor` quotes it). */
  block?: string;
  lastBlock?: string;
  /** The text the edit is about, as the document had it: the run's text,
   *  or the words inside it an insertion goes next to. */
  anchor?: string;
  /** New markdown content; absent only for `delete`. */
  text?: string;
  /** One sentence on why, shown on the proposal card (optional). */
  reason?: string;
  /** A generate_image proposal's picture, waiting in the backend
   *  (ai/images.rs) until Accept saves it; `text` then names it by
   *  generatedImageSrc(id) until it has a file. */
  image?: {
    id: string;
    alt: string;
    width: number;
    height: number;
    /** Still being made: the document shows its frame until it comes. */
    pending?: boolean;
  };
}

/**
 * One skill, from the global config folder's skills/ or the project's
 * .textus/skills/*.md files - see src-tauri/src/ai/workspace.rs. The
 * frontend only needs name/description for the /name picker; the prompt is
 * used when the user forces a skill manually.
 */
export interface AgentSkill {
  name: string;
  description: string;
  prompt: string;
  /** The rest of ai::workspace::AgentSkill (see SkillListItem in ipc.ts);
   *  optional so a minimal skill still type-checks. */
  category?: string | null;
  invocation?: "both" | "userOnly" | "hidden";
  source?: "builtin" | "global" | "project";
  overridesBuiltin?: boolean;
  enabled?: boolean;
  aliases?: Record<string, string[]>;
  packs?: string[];
  version?: string | null;
  basedOn?: string | null;
  builtinUpdated?: boolean;
}

/**
 * A file attached to an outgoing chat message via the "+" button.
 *
 * Two destinations, decided in Rust by format (commands/attachment.rs):
 * anything with text in it - PDF, Word, spreadsheets, plain files - is
 * EXTRACTED and inlined into the message as an `<attached-file>` block, which
 * works with every provider. Images have no text to extract, so they travel
 * as base64 and become the provider's own image content part.
 *
 * A discriminated union, mirroring the Rust enum: the two carry nothing in
 * common but a name, so `kind` narrows to exactly the fields that mean
 * something rather than leaving the other half documented as empty.
 */
export type ChatAttachment =
  | {
      kind: "text";
      name: string;
      /** Extracted text, inlined into the outgoing message. */
      content: string;
      /** `content` was cut at the extraction cap. Shown on the chip - a
       *  silent truncation reads as "the model has my whole file". */
      truncated: boolean;
    }
  | {
      kind: "image";
      name: string;
      /** "image/png", ... */
      mime: string;
      dataBase64: string;
    };

/** The image half of a ChatAttachment, as `ai_agent_message` takes it.
 *  Mirrors ImageAttachment in src-tauri/crates/aicompat/src/agent.rs. */
export interface ImageAttachment {
  name: string;
  mime: string;
  dataBase64: string;
}

/** How hard the model is asked to think: Fast from Quick Ask, Deep while
 *  the composer's Deep thinking is on, Auto (the provider's default)
 *  otherwise. Mirrors ThinkingLevel in
 *  src-tauri/crates/aicompat/src/capabilities.rs. */
export type ThinkingLevel = "fast" | "auto" | "deep";

/** A web page a reply cites as [n], numbered once per conversation.
 *  Mirrors `Source` in src-tauri/crates/aicompat/src/agent.rs. */
export interface WebSource {
  n: number;
  url: string;
  title: string;
}

/** Mirrors AgentTurn in src-tauri/crates/aicompat/src/agent.rs. Its
 *  ToolResult also carries the images read_file showed the model, but
 *  agent.rs's for_history drops them before a turn reaches the frontend. */
export type AgentTurn =
  | { kind: "User"; text: string; images?: ImageAttachment[] }
  | { kind: "Assistant"; text: string; sources?: WebSource[] }
  | { kind: "ToolCall"; call_id: string; name: string; arguments: string }
  | { kind: "ToolResult"; call_id: string; output: string };
