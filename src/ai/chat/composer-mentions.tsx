import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import type { ChatAttachment } from "../types";
import { basename } from "../../utils/path";

/**
 * A file picked from the @ menu stays in the message as "@name", drawn as a
 * chip: a layer under the textarea sets the same text with the mentions
 * boxed, the textarea's own text over it. Backspace takes a mention whole;
 * a mention gone from the text takes its file with it.
 */

/** What a picked file reads as in the message. */
export function mentionText(path: string): string {
  return `@${basename(path)}`;
}

/** Where each of `paths`' mentions sits in `input`: a whole word, followed
 *  by a space or the end. */
export function mentionRanges(
  input: string,
  paths: readonly string[],
): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  for (const text of new Set(paths.map(mentionText))) {
    let at = input.indexOf(text);
    while (at !== -1) {
      const end = at + text.length;
      const before = at === 0 || /\s/.test(input[at - 1]);
      const after = end === input.length || /\s/.test(input[end]);
      if (before && after) ranges.push({ start: at, end });
      at = input.indexOf(text, end);
    }
  }
  return ranges.sort((a, b) => a.start - b.start);
}

/** The mentioned paths still in `input`. */
export function stillMentioned(
  input: string,
  paths: readonly string[],
): string[] {
  return paths.filter((p) => mentionRanges(input, [p]).length > 0);
}

/** Backspace at a mention's end (or the space after it): the input without
 *  it, and where the caret goes; null where the caret ends no mention. */
export function backspaceMention(
  input: string,
  caret: number,
  paths: readonly string[],
): { input: string; caret: number } | null {
  const hit = mentionRanges(input, paths).find(
    (r) => caret === r.end || (caret === r.end + 1 && input[r.end] === " "),
  );
  if (!hit) return null;
  return {
    input: input.slice(0, hit.start) + input.slice(caret),
    caret: hit.start,
  };
}

/** The layer under the textarea that draws its mentions as chips; scrolls
 *  with it. */
export function MentionLayer({
  input,
  paths,
  textarea,
}: {
  input: string;
  paths: readonly string[];
  textarea: RefObject<HTMLTextAreaElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const field = textarea.current;
    const layer = ref.current;
    if (!field || !layer) return;
    const follow = () => (layer.scrollTop = field.scrollTop);
    follow();
    field.addEventListener("scroll", follow);
    return () => field.removeEventListener("scroll", follow);
  });
  const ranges = mentionRanges(input, paths);
  if (ranges.length === 0) return null;
  const parts: (string | { chip: string })[] = [];
  let at = 0;
  for (const r of ranges) {
    parts.push(input.slice(at, r.start), { chip: input.slice(r.start, r.end) });
    at = r.end;
  }
  // A trailing newline needs a character after it to take its line.
  parts.push(input.slice(at) + "​");
  return (
    <div ref={ref} className="inline-chat-mentions" aria-hidden>
      {parts.map((p, i) =>
        typeof p === "string" ? (
          p
        ) : (
          <mark key={i} className="inline-chat-mention">
            {p.chip}
          </mark>
        ),
      )}
    </div>
  );
}

/** The files mentioned in the message: added as one is picked, dropped with
 *  their attachment once their mention leaves the text. */
export function useMentions(
  input: string,
  setInput: Dispatch<SetStateAction<string>>,
  setAttachments: Dispatch<SetStateAction<ChatAttachment[]>>,
  textarea: RefObject<HTMLTextAreaElement | null>,
) {
  const [paths, setPaths] = useState<string[]>([]);
  useEffect(() => {
    const kept = stillMentioned(input, paths);
    if (kept.length === paths.length) return;
    const gone = paths.filter((p) => !kept.includes(p));
    setPaths(kept);
    setAttachments((prev) =>
      prev.filter((f) => !(f.kind === "text" && gone.includes(f.path ?? ""))),
    );
  }, [input, paths, setAttachments]);

  /** Puts `path`'s mention where the "@query" was typed. */
  function add(path: string, token: RegExp) {
    setInput((prev) => prev.replace(token, `$1${mentionText(path)} `));
    setPaths((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }

  /** Backspace takes a mention whole; true when it did. */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    const field = e.currentTarget;
    if (e.key !== "Backspace" || field.selectionStart !== field.selectionEnd)
      return false;
    const next = backspaceMention(input, field.selectionStart, paths);
    if (!next) return false;
    e.preventDefault();
    setInput(next.input);
    requestAnimationFrame(() =>
      textarea.current?.setSelectionRange(next.caret, next.caret),
    );
    return true;
  }

  return { paths, add, onKeyDown };
}
