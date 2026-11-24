import { useEffect, useRef, useState } from "react";
import { showMessage } from "../engine/controls/app-dialog";

/** Where a name's own part ends: before its extension for a file
 *  ("plan.md" → "plan"), the whole name for a folder or a dotfile. */
export function stemEnd(name: string, isDir: boolean): number {
  const dot = name.lastIndexOf(".");
  return isDir || dot <= 0 ? name.length : dot;
}

/**
 * A name typed in place in a tree row, as in a file manager: it opens with
 * the name's own part selected; Enter or leaving it gives the name, Escape
 * or an empty or unchanged one gives up. `commit` answers why a name can't
 * be (a taken one): after Enter that is said under the field, which stays
 * to try another; after leaving it, in a message, and the field goes.
 */
export function NameField({
  initial,
  isDir,
  fresh = false,
  label,
  commit,
  cancel,
}: {
  initial: string;
  isDir: boolean;
  /** A new entry's name: given as it is, too. */
  fresh?: boolean;
  label: string;
  /** Null once done, else what is wrong with the name. `byKey`: ended
   *  with Enter or Escape, the keyboard staying in the tree; else the
   *  user went elsewhere, which keeps it. */
  commit: (name: string, byKey: boolean) => Promise<string | null>;
  cancel: (byKey: boolean) => void;
}) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /** Settled (or being), so a blur after Enter doesn't give it twice. */
  const busy = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.setSelectionRange(0, stemEnd(initial, isDir));
  }, [initial, isDir]);

  const finish = async (how: "enter" | "leave") => {
    if (busy.current) return;
    const typed = name.trim();
    const byKey = how === "enter";
    if (!typed || (typed === initial && !fresh)) return cancel(byKey);
    busy.current = true;
    const wrong = await commit(typed, byKey);
    if (wrong === null) return;
    if (how === "leave") {
      cancel(false);
      await showMessage(wrong);
      return;
    }
    busy.current = false;
    setProblem(wrong);
    input.current?.focus();
  };

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <span className="tree-name-field">
      <input
        ref={input}
        className="tree-draft-input"
        aria-label={label}
        aria-invalid={problem !== null}
        value={name}
        spellCheck={false}
        onChange={(e) => {
          setName(e.target.value);
          setProblem(null);
        }}
        onKeyDown={(e) => {
          // The tree's keys (arrows, type-ahead, its commands) stay out.
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key !== "Enter" && e.key !== "Escape") return;
          // Or the key goes on to the button of a notice this opens.
          e.preventDefault();
          if (e.key === "Enter") void finish("enter");
          else if (!busy.current) {
            busy.current = true;
            cancel(true);
          }
        }}
        onBlur={() => void finish("leave")}
        // The row's own click, press and menu are not the field's.
        onClick={stop}
        onDoubleClick={stop}
        onPointerDown={stop}
        onContextMenu={stop}
      />
      {problem && (
        <span className="tree-name-problem" role="alert">
          {problem}
        </span>
      )}
    </span>
  );
}
