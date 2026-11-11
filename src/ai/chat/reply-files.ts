/// The fenced blocks of a chat reply, read once for every kind of file the
/// chat offers under it (plugins, themes, skills).

/** A closed fenced block of a reply: ```js host.js ... ``` */
interface ReplyFile {
  /** The info string's first word, lower-cased ("" when it has none). */
  lang: string;
  /** The info string's last word when it names a file - it has a dot or a
   *  slash and follows the language ("js host.js" → host.js); else null. */
  path: string | null;
  /** The block's text, ending in a newline as a saved file does. */
  text: string;
}

/**
 * A closed fence at the start of a line: three or more backticks or tildes,
 * an info string, the body, and a closing line of the same fence. A backtick
 * fence's info string can't hold a backtick (CommonMark), a tilde one can;
 * neither may give back a fence character to its info string (````css is
 * not ``` with info `css).
 * Only one of groups 1 and 3 takes part, and a backreference to the other
 * matches nothing, so `\1\3` is the opening fence. A block with no closing
 * fence - one still streaming - doesn't match.
 */
const FENCE =
  /^(?:(`{3,})([^\n`]*)|(~{3,})(?!~)([^\n]*))\n([\s\S]*?)\n\1\3[ \t]*$/gm;

/** The path an info string names, if any. */
function pathOf(words: string[]): string | null {
  const last = words[words.length - 1];
  return words.length > 1 && /[./]/.test(last) ? last : null;
}

// The chat reads a reply for plugins, themes and skills on every streamed
// chunk; they all ask about the same text, so the last answer is kept.
// It is replaced by the next reply read; the blocks are not to be changed.
let last: { text: string; files: readonly ReplyFile[] } | null = null;

/** The closed fenced blocks of `text`, in order. */
export function replyFiles(text: string): readonly ReplyFile[] {
  if (last?.text === text) return last.files;
  const files: ReplyFile[] = [];
  for (const m of text.matchAll(FENCE)) {
    const words = (m[2] ?? m[4]).trim().split(/\s+/);
    files.push({
      lang: words[0].toLowerCase(),
      path: pathOf(words),
      text: `${m[5]}\n`,
    });
  }
  last = { text, files };
  return files;
}
