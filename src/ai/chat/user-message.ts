/**
 * An outgoing chat message carries more than what the user typed: the
 * selection they had, and any files they attached, wrapped in tags the model
 * reads as context (see InlineChat's send path). That tagged string is also
 * the history replayed to the model on the next turn, so it can't be
 * simplified away at send time - but showing it verbatim in the transcript
 * put a wall of XML and the user's own selected text in place of the one
 * sentence they actually wrote.
 *
 * Parsing it back apart at render time keeps both: the wire format is
 * untouched (and conversations restored from history parse the same way),
 * while the bubble shows the prose and folds the context into chips.
 *
 * WRITING the format lives here too. It used to be written inline in
 * ChatBody's send path and read by two different regexes (here and in
 * chat-history's title cleaner), so three places had to agree on it with
 * nothing checking that they did - and every way of getting it wrong is
 * silent: chips stop appearing, or a wall of raw XML shows up as a
 * conversation's title.
 */

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

/** Instructions an app feature writes for the model behind a short visible
 *  line (auto-writing's per-section brief): sent in full, never shown. */
export function taskBriefBlock(text: string): string {
  return `<task-brief>\n${text}\n</task-brief>`;
}

/** Wraps one attachment's extracted text. */
export function attachedFileBlock(name: string, content: string): string {
  return `<attached-file name="${name}">\n${content}\n</attached-file>`;
}

/** Wraps a skill the user called with /name: its instructions, marked as
 *  already loaded (agent.rs's skill index tells the model not to load it
 *  again with use_skill). Mirrored by live_eval's resolve_skill_message.
 *
 *  `typed` is what the user typed when it wasn't `/name` itself - an alias
 *  such as `/续写` - so the transcript shows their word, not the canonical
 *  name. With no prompt (a built-in the backend expands itself) the block
 *  is empty. */
export function skillBlock(
  name: string,
  prompt: string,
  typed?: string,
): string {
  const attr =
    typed && typed !== `/${name}` ? ` typed="${escapeAttr(typed)}"` : "";
  return prompt
    ? `<skill name="${name}"${attr}>\n${prompt}\n</skill>`
    : `<skill name="${name}"${attr}></skill>`;
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
const TASK_BRIEF = /\n*<task-brief>\n?[\s\S]*?\n?<\/task-brief>\n*/;
const ATTACHED_FILE =
  /<attached-file name="([^"]*)">\n?[\s\S]*?\n?<\/attached-file>\n*/g;
const SKILL =
  /<skill name="([^"]*)"(?: typed="([^"]*)")?>(?:\n?[\s\S]*?\n?)?<\/skill>\n*/;

export function parseUserMessage(text: string): ParsedUserMessage {
  const attachments: string[] = [];
  let body = text.replace(ATTACHED_FILE, (_full, name: string) => {
    attachments.push(name);
    return "";
  });

  body = body.replace(CURSOR, "").replace(TASK_BRIEF, "\n");
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
