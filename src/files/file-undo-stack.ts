import { onOpenFolderChange } from "../platform/open-folder";
import type { FileStep } from "./file-undo";

/** How many steps the tree keeps to take back. */
const KEPT_STEPS = 50;

/** What running a step did: taken back (or done again), with the step that
 *  reverses it, if any; or refused, the step staying where it was. */
export type StepRun = { done: true; again: FileStep | null } | { done: false };

/**
 * The tree's file operations to take back, newest last, and those taken
 * back to do again. Undo and Redo run one at a time, in the order asked:
 * each takes its step off as it starts, so a notice's Undo and a held key
 * never run one twice. A refused step goes back where it was, and what is
 * queued after a refusal is dropped; a step finishing after something new
 * was done (or the stack emptied) leaves no Redo behind.
 */
export function fileUndoStack() {
  const steps: FileStep[] = [];
  const undone: FileStep[] = [];
  const keep = (list: FileStep[], step: FileStep) => {
    list.push(step);
    if (list.length > KEPT_STEPS) list.shift();
  };
  let pushes = 0;
  let clears = 0;
  let refusals = 0;
  let queue: Promise<void> = Promise.resolve();

  /** The newest step of `from` run, once those before it finish; `which`:
   *  only if it is that step then. `to` gets the step reversing it. */
  const enqueue = (
    from: FileStep[],
    to: FileStep[],
    run: (step: FileStep) => Promise<StepRun>,
    which?: FileStep,
  ): boolean => {
    const top = from[from.length - 1];
    if (!top || (which && which !== top)) return false;
    const asked = { refusals, clears };
    queue = queue.then(async () => {
      if (asked.refusals !== refusals || asked.clears !== clears) return;
      const step = from[from.length - 1];
      if (!step || (which && which !== step)) return;
      from.pop();
      const at = { index: from.length, pushes, clears };
      const result = await run(step).catch((): StepRun => ({ done: false }));
      if (at.clears !== clears) return;
      // Something new done meanwhile emptied the Redo list.
      const redoGone = at.pushes !== pushes;
      if (!result.done) {
        refusals++;
        if (from === undone && redoGone) return;
        from.splice(Math.min(at.index, from.length), 0, step);
      } else if (result.again && !(to === undone && redoGone)) {
        keep(to, result.again);
      }
    });
    return true;
  };

  return {
    /** A new operation: what was undone before can't be done again. */
    push(step: FileStep) {
      keep(steps, step);
      undone.length = 0;
      pushes++;
    },
    clear() {
      steps.length = 0;
      undone.length = 0;
      clears++;
    },
    get size() {
      return steps.length;
    },
    /** Takes back the newest step with `run`; with `which`, only if that
     *  is the newest (an older notice's Undo does nothing). False when
     *  there is none to take back. */
    undo: (run: (step: FileStep) => Promise<StepRun>, which?: FileStep) =>
      enqueue(steps, undone, run, which),
    /** Does the newest step taken back again with `run`. */
    redo: (run: (step: FileStep) => Promise<StepRun>) =>
      enqueue(undone, steps, run),
    /** Resolves once every Undo and Redo asked so far has finished. */
    settled: () => queue,
  };
}

/** This window's stack (its one owner): it outlives the tree's panel being
 *  switched away and the tree following another document, and empties
 *  only when another folder is opened or the folder is closed. */
export const windowFileUndo = fileUndoStack();

onOpenFolderChange(() => windowFileUndo.clear());
