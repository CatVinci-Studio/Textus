/**
 * The operations a propose_edit tool call can carry. Mirrors EDIT_ACTIONS in
 * src-tauri/src/ai/tools.rs - the backend validates proposals against the
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
  /** Exact document text the edit targets; absent for `append` and
   *  `replace_selection` (the latter targets the captured selection). */
  anchor?: string;
  /** New markdown content; absent only for `delete`. */
  text?: string;
  /** A longer verbatim quote containing `anchor`, itself unique in the
   *  document - disambiguates which occurrence a repeated anchor means
   *  (see findMarkdownMatch). Mirrors the `context` field tools.rs offers. */
  context?: string;
  /** One sentence on why, shown on the proposal card (optional). */
  reason?: string;
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

/** Mirrors AgentTurn in src-tauri/crates/aicompat/src/agent.rs. Its
 *  ToolResult also carries the images view_image showed the model, but
 *  agent.rs's for_history drops them before a turn reaches the frontend. */
export type AgentTurn =
  | { kind: "User"; text: string; images?: ImageAttachment[] }
  | { kind: "Assistant"; text: string }
  | { kind: "ToolCall"; call_id: string; name: string; arguments: string }
  | { kind: "ToolResult"; call_id: string; output: string };
