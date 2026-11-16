import { closeHistory } from "@milkdown/kit/prose/history";
import { Plugin, PluginKey, type Transaction } from "@milkdown/kit/prose/state";
import { $prose } from "@milkdown/kit/utils";

const ownStep = new Set(["paste", "cut", "drop"]);

const isOwnStep = (tr: Transaction) =>
  tr.docChanged && ownStep.has(tr.getMeta("uiEvent"));

const key = new PluginKey<boolean>("own-undo-step");

/** A paste, cut or drop is an undo step of its own, as in Word or Pages:
 *  the history would fold two quick pastes, or a paste and the typing
 *  right after it, into one. */
export const ownUndoStepPlugin = $prose(() => {
  // A transaction filtered between another's apply and the view's update is
  // a plugin's appended one (marked only after the filter): part of that step.
  let appending = false;
  return new Plugin<boolean>({
    key,
    state: {
      init: () => false,
      apply: (tr, afterOwnStep) => {
        if (tr.getMeta("appendedTransaction")) return afterOwnStep;
        appending = true;
        return tr.docChanged ? isOwnStep(tr) : afterOwnStep;
      },
    },
    view: () => ({ update: () => void (appending = false) }),
    filterTransaction(tr, state) {
      if (
        !appending &&
        (isOwnStep(tr) || (tr.docChanged && key.getState(state)))
      )
        closeHistory(tr);
      return true;
    },
  });
});
