import { withoutCitationMarkers } from "../citation-markers";
import { resolveBlockEdit } from "../doc-blocks";
import { EDIT_ACTIONS, type EditAction, type EditProposal } from "../types";

/** A string field scanned out of an incomplete JSON fragment: what has
 *  arrived of its value, and whether the closing quote has been seen. */
export interface PartialString {
  value: string;
  complete: boolean;
}

/**
 * Best-effort scanner for a propose_edit `arguments` string that is still
 * streaming in. The fragment can end anywhere - mid-key, mid-value, even
 * mid-escape - and the scanner returns every string field whose value has
 * at least started. Callers re-run it on the whole accumulated fragment
 * after each delta (arguments are small; simplicity beats an incremental
 * parser here).
 *
 * Only flat string fields are handled, because that is propose_edit's whole
 * schema (action/anchor/text - see tools.rs); a non-string value is skipped
 * to the next comma. This is display plumbing, not validation: the
 * authoritative parse stays proposal.ts's parseProposal on the COMPLETE
 * arguments, and anything shown from here is replaced by that result.
 */
export function parsePartialToolArgs(
  fragment: string,
): Record<string, PartialString> {
  const fields: Record<string, PartialString> = {};
  const n = fragment.length;
  let i = 0;

  const skipWhitespace = () => {
    while (i < n && /\s/.test(fragment[i])) i++;
  };

  /** Reads the JSON string starting at fragment[i] === '"', decoding
   *  escapes, stopping cleanly if the fragment ends first. */
  const readString = (): PartialString => {
    i++;
    let out = "";
    while (i < n) {
      const ch = fragment[i];
      if (ch === '"') {
        i++;
        return { value: out, complete: true };
      }
      if (ch === "\\") {
        if (i + 1 >= n) break; // escape cut off at the fragment boundary
        const esc = fragment[i + 1];
        if (esc === "u") {
          if (i + 6 > n) break; // \uXXXX cut off mid-hex
          const code = parseInt(fragment.slice(i + 2, i + 6), 16);
          if (!Number.isNaN(code)) out += String.fromCharCode(code);
          i += 6;
        } else {
          const simple: Record<string, string> = {
            '"': '"',
            "\\": "\\",
            "/": "/",
            b: "\b",
            f: "\f",
            n: "\n",
            r: "\r",
            t: "\t",
          };
          out += simple[esc] ?? esc;
          i += 2;
        }
      } else {
        out += ch;
        i++;
      }
    }
    i = n;
    return { value: out, complete: false };
  };

  skipWhitespace();
  if (fragment[i] !== "{") return fields;
  i++;

  for (;;) {
    skipWhitespace();
    if (i >= n || fragment[i] === "}") return fields;
    if (fragment[i] === ",") {
      i++;
      continue;
    }
    if (fragment[i] !== '"') return fields; // malformed - stop guessing
    const key = readString();
    if (!key.complete) return fields;
    skipWhitespace();
    if (i >= n || fragment[i] !== ":") return fields;
    i++;
    skipWhitespace();
    if (i >= n) return fields;
    if (fragment[i] === '"') {
      const value = readString();
      fields[key.value] = value;
      if (!value.complete) return fields;
    } else {
      while (i < n && fragment[i] !== "," && fragment[i] !== "}") i++;
    }
  }
}

/** A streaming proposal that already knows where it lands: `proposal.text`
 *  holds what has arrived of the text so far (possibly empty). */
export interface DraftProposal {
  proposal: EditProposal;
  /** True once the `text` value's closing quote arrived. */
  textComplete: boolean;
}

/**
 * The earliest point a streaming propose_edit can be placed in the
 * document: the action is fully known and, for anchored actions, the anchor
 * is quoted in full (models emit fields in schema order - action, anchor,
 * text - so this is typically reached while the text is still streaming).
 * Returns null until then; the caller keeps feeding it grown fragments.
 */
export function draftProposal(
  fragment: string,
  /** The document as it is now, for an edit that names its block
   *  (doc-blocks.ts) rather than quoting it. */
  document?: string,
): DraftProposal | null {
  const fields = parsePartialToolArgs(fragment);
  const action = fields.action;
  if (!action?.complete) return null;
  if (!EDIT_ACTIONS.includes(action.value as EditAction)) return null;
  const needsAnchor =
    action.value !== "append" && action.value !== "replace_selection";
  const anchor = fields.anchor;
  // Named by its block: placed once the run's end is known too - its own
  // `last_block`, or a field written after it (schema order: block,
  // context, last_block, reason, text).
  if (fields.block?.value && document !== undefined) {
    if (!fields.block.complete) return null;
    const runKnown =
      fields.last_block?.complete || !!fields.reason || !!fields.text;
    if (!runKnown) return null;
    const text = withoutCitationMarkers(
      fields.text?.value ?? "",
      !fields.text?.complete,
    );
    const resolved = resolveBlockEdit(document, {
      action: action.value,
      block: fields.block.value,
      lastBlock: fields.last_block?.value || undefined,
      anchor: anchor?.complete && anchor.value ? anchor.value : undefined,
      text,
    });
    if (!resolved) return null;
    return {
      proposal: {
        action: resolved.action as EditAction,
        anchor: resolved.anchor,
        text: resolved.text,
        context: resolved.context,
      },
      textComplete: fields.text?.complete ?? false,
    };
  }
  if (needsAnchor && !anchor?.complete) return null;

  return {
    proposal: {
      action: action.value as EditAction,
      anchor: needsAnchor ? anchor?.value : undefined,
      // What it writes, without the citation markers an OpenAI model may
      // put in (citation-markers.ts) - the anchor quotes the document.
      text: withoutCitationMarkers(
        fields.text?.value ?? "",
        !fields.text?.complete,
      ),
      // Disambiguates a repeated anchor (findMarkdownMatch) - only once
      // fully quoted; a half-arrived context must not mislocate the draft.
      context: fields.context?.complete ? fields.context.value : undefined,
    },
    textComplete: fields.text?.complete ?? false,
  };
}
