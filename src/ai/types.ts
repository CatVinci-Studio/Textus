import type {
  ChatAttachment as Attachment,
  ImageAttachment as Image,
  ThinkingLevel as Thinking,
  WebSource as Source,
} from "../platform/bindings/ai-agent";
import type { AgentMode } from "../prefs/settings-types";

/** The operations a propose_edit call can carry. Keep in step with the
 *  backend's EDIT_ACTIONS, which validates proposals against it. */
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
  /** The block the edit is in, and the run's last block for a run. Absent for
   *  `append`, `replace_selection`, `insert_at_cursor`, and an edit of a still
   *  undecided proposal (`anchor` quotes it). */
  block?: string;
  lastBlock?: string;
  /** The text the edit is about, as the document had it: the run's text,
   *  or the words inside it an insertion goes next to. */
  anchor?: string;
  /** New markdown content; absent only for `delete`. */
  text?: string;
  /** One sentence on why, shown on the proposal card (optional). */
  reason?: string;
  /** A generate_image proposal's picture, held by the backend until Accept
   *  saves it; `text` names it by generatedImageSrc(id) until then. */
  image?: {
    id: string;
    alt: string;
    width: number;
    height: number;
    /** Still being made: the document shows its frame until it comes. */
    pending?: boolean;
  };
}

/** One skill, from the global or the project's skills folder. The prompt is
 *  used when the user forces a skill manually. */
export interface AgentSkill {
  name: string;
  description: string;
  prompt: string;
  /** Optional so a minimal skill still type-checks. */
  category?: string | null;
  invocation?: "both" | "userOnly" | "hidden";
  source?: "builtin" | "global" | "project";
  overridesBuiltin?: boolean;
  modes?: AgentMode[];
  labels?: Record<string, { label: string; hint: string }>;
  aliases?: Record<string, string[]>;
  packs?: string[];
  version?: string | null;
  basedOn?: string | null;
  builtinUpdated?: boolean;
}

/**
 * A file attached to a chat message. Anything with text is extracted and
 * inlined; images travel as base64 as the provider's own image part.
 */
export type ChatAttachment = Attachment;

/** The image half of a ChatAttachment. */
export type ImageAttachment = Image;

/** How hard the model is asked to think: Fast from Quick Ask, Deep while
 *  Deep thinking is on, Auto (the provider's default) otherwise. */
export type ThinkingLevel = Thinking;

/** A web page a reply cites as [n], numbered once per conversation. */
export type WebSource = Source;

/** AgentTurn as the frontend keeps it: a ToolCall's reasoning and a
 *  ToolResult's images are dropped first, and a saved User turn may have none. */
export type AgentTurn =
  | { kind: "User"; text: string; images?: ImageAttachment[] }
  | { kind: "Assistant"; text: string; sources?: WebSource[] }
  | { kind: "ToolCall"; call_id: string; name: string; arguments: string }
  | { kind: "ToolResult"; call_id: string; output: string };
