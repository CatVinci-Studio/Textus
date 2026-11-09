/**
 * Writes and parses the tagged chat message: the typed prose plus selection,
 * attachments and skill blocks. The tagged string is what the model sees and
 * history replays; the transcript parses it back to prose and chips.
 */

import { escapeHtml } from "../../utils/html";
import type { ChatAttachment, ImageAttachment } from "../types";

/** Wraps the selection the message rode out with. */
export function selectedTextBlock(markdown: string): string {
  return `<selected-text>\n${markdown}\n</selected-text>`;
}

/** Marks where the cursor is when nothing is selected: the text just
 *  before and after it, with ⟦cursor⟧ at the spot - what "write a
 *  transition here" refers to (and where insert_at_cursor writes). */
export function cursorBlock(before: string, after: string): string {
  return `<cursor>\n${before}⟦cursor⟧${after}\n</cursor>`;
}

/** Wraps one attachment's extracted text. */
export function attachedFileBlock(
  name: string,
  content: string,
  path?: string,
): string {
  // The path is where read_file finds the whole file.
  const where = path && path !== name ? ` path="${escapeHtml(path)}"` : "";
  return `<attached-file name="${name}"${where}>\n${content}\n</attached-file>`;
}

/** Wraps a skill the user called with /name: its instructions, marked as
 *  already loaded. `typed` is an alias they typed, shown in the transcript;
 *  with no prompt (a built-in the backend expands) the block is empty. */
export function skillBlock(
  name: string,
  prompt: string,
  typed?: string,
): string {
  const attr =
    typed && typed !== `/${name}` ? ` typed="${escapeHtml(typed)}"` : "";
  return prompt
    ? `<skill name="${name}"${attr}>\n${prompt}\n</skill>`
    : `<skill name="${name}"${attr}></skill>`;
}

function unescapeAttr(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** The message with every context block stripped and nothing parsed out -
 *  for callers that only want the prose, like the history list's title. */
export function userMessageBody(text: string): string {
  return parseUserMessage(text).body;
}

export interface ParsedUserMessage {
  /** What the user actually typed, with the context blocks removed - a
   *  skill's expanded instructions folded back into the /name they typed. */
  body: string;
  /** The <selected-text> block's content, if the message carried one. */
  selection: string | null;
  /** File names from any <attached-file name="..."> blocks, in order. */
  attachments: string[];
}

const SELECTED_TEXT = /<selected-text>\n?([\s\S]*?)\n?<\/selected-text>\n*/;
const CURSOR = /<cursor>\n?[\s\S]*?\n?<\/cursor>\n*/;
const ATTACHED_FILE =
  /<attached-file name="([^"]*)"(?: path="[^"]*")?>\n?[\s\S]*?\n?<\/attached-file>\n*/g;
const SKILL =
  /<skill name="([^"]*)"(?: typed="([^"]*)")?>(?:\n?[\s\S]*?\n?)?<\/skill>\n*/;

export function parseUserMessage(text: string): ParsedUserMessage {
  const attachments: string[] = [];
  let body = text.replace(ATTACHED_FILE, (_full, name: string) => {
    attachments.push(name);
    return "";
  });

  body = body.replace(CURSOR, "");
  // A /name skill went out with its whole prompt; the user typed the name.
  body = body.replace(
    SKILL,
    (_full, name: string, typed: string | undefined) =>
      `${typed ? unescapeAttr(typed) : `/${name}`} `,
  );

  let selection: string | null = null;
  const selectionMatch = SELECTED_TEXT.exec(body);
  if (selectionMatch) {
    selection = selectionMatch[1];
    body = body.replace(SELECTED_TEXT, "");
  }

  return { body: body.trim(), selection, attachments };
}

/** The message as sent: the selection (or the caret's surroundings) and
 *  text attachments tagged in front of what was typed; images apart. */
export function composeMessage(
  {
    selectionMarkdown: selection,
    cursor,
  }: {
    selectionMarkdown: string | null;
    cursor?: { before: string; after: string } | null;
  },
  message: string,
  attachments: ChatAttachment[],
  includeSelection: boolean,
): { message: string; images?: ImageAttachment[] } {
  // The tag carries the selection's markdown so formatting survives the
  // trip; with nothing selected, the caret's surroundings say where "here" is.
  const tagged =
    selection && includeSelection
      ? `${selectedTextBlock(selection)}\n\n${message}`
      : cursor
        ? `${cursorBlock(cursor.before, cursor.after)}\n\n${message}`
        : message;
  // Text attachments were extracted in Rust and ride inside the prompt;
  // images go as provider image parts.
  const attachmentBlocks = attachments
    .filter((f) => f.kind === "text")
    .map((f) => attachedFileBlock(f.name, f.content, f.path))
    .join("\n\n");
  return {
    message: attachmentBlocks ? `${attachmentBlocks}\n\n${tagged}` : tagged,
    // Not filtered on vision here: the composer and the backend both refuse
    // an image the provider can't read; dropping it would be a third policy.
    images: attachments
      .filter((f) => f.kind === "image")
      .map((f) => ({
        name: f.name,
        mime: f.mime,
        dataBase64: f.dataBase64,
      })),
  };
}
