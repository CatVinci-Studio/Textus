import { useCallback, useEffect, useRef, useState } from "react";
import { ai } from "../../platform/ipc";
import { announce } from "../../ui/announce";
import { usePresenceProps } from "../../ui/usePresence";
import { parseKindKey } from "./change-kind";
import {
  answer,
  choicesFor,
  describeKind,
  forget,
  parseLog,
  record,
  suggestion,
  type Answer,
  type ChoiceLog,
  type LearnLabels,
} from "./revision-learning";
import type { DecidedChange } from "./usePendingEdits";
import "./ReviewBar.css";

export interface RevisionLearningLabels extends LearnLabels {
  learnSuggestion: string;
  learnRemember: string;
  learnNotNow: string;
  learnNever: string;
  learnSaved: string;
  learnLabel: string;
  memoryActionFailed: string;
}

/** Records the writer's revision choices and the one suggestion they may
 *  lead to. One window's reads and writes of the log run in turn. */
export function useRevisionLearning({
  docPath,
  workspaceRoot,
}: {
  docPath: string | null;
  workspaceRoot: string | null;
}) {
  const [kind, setKind] = useState<string | null>(null);
  const [saved, setSaved] = useState<"saved" | "failed" | null>(null);
  const queue = useRef<Promise<ChoiceLog | null>>(Promise.resolve(null));
  const update = useCallback((change: (log: ChoiceLog) => ChoiceLog) => {
    const next = queue.current.then(async () => {
      const log = change(
        parseLog(await ai.revisionChoicesRead().catch(() => null)),
      );
      await ai.revisionChoicesWrite(log).catch(() => {});
      return log;
    });
    queue.current = next.catch(() => null);
    return next;
  }, []);

  const recordChoices = useCallback(
    (callId: string, changes: DecidedChange[]) => {
      // No changes: an undo took the decision back.
      if (changes.length === 0) {
        void update((log) => forget(log, callId));
        return;
      }
      const choices = choicesFor(callId, changes, Date.now());
      if (choices.length === 0) return;
      void update((log) => record(log, choices)).then((log) => {
        const due = suggestion(log, Date.now());
        // One at a time: a suggestion on offer stays until answered.
        if (due) setKind((current) => current ?? due);
      });
    },
    [update],
  );

  /** It came on screen: the cooldown starts. */
  const shown = useCallback(() => {
    void update((log) => ({ ...log, lastAsked: Date.now() }));
  }, [update]);

  const reply = useCallback(
    async (given: Answer, rule?: string) => {
      if (!kind) return;
      if (given === "remembered" && rule) {
        try {
          await ai.memoryRemember(
            docPath,
            workspaceRoot,
            "requirement",
            "personal",
            rule,
          );
        } catch (err) {
          // Already remembered in these words: that is what was asked.
          if (!String(err).startsWith("Already remembered")) {
            setSaved("failed");
            return;
          }
        }
        setSaved("saved");
      }
      setKind(null);
      await update((log) => answer(log, kind, given, Date.now()));
    },
    [kind, docPath, workspaceRoot, update],
  );

  return {
    kind,
    saved,
    clearSaved: () => setSaved(null),
    record: recordChoices,
    shown,
    reply,
  };
}

export type RevisionLearning = ReturnType<typeof useRevisionLearning>;

/** The suggestion to remember a repeated choice as a personal memory, shown
 *  in the review bar's place only after a review is finished. */
export function RevisionLearningBar({
  learning,
  labels,
  phone,
}: {
  learning: RevisionLearning;
  labels: RevisionLearningLabels;
  phone: boolean;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const presence = usePresenceProps(rootRef);
  const { kind, saved, shown, reply, clearSaved } = learning;
  const parsed = kind ? parseKindKey(kind) : null;
  useEffect(() => {
    if (kind) shown();
  }, [kind, shown]);
  // The "remembered" line goes by itself.
  useEffect(() => {
    if (saved !== "saved") return;
    const timer = setTimeout(clearSaved, 4000);
    return () => clearTimeout(timer);
  }, [saved, clearSaved]);
  // The line that stands alone once the suggestion is answered, said to a
  // screen reader as it appears.
  const savedLine =
    !parsed && saved
      ? saved === "saved"
        ? labels.learnSaved
        : labels.memoryActionFailed
      : null;
  useEffect(() => {
    if (savedLine) announce(savedLine);
  }, [savedLine]);
  const className = `review-bar learn-bar${phone ? " review-bar-phone" : ""}`;
  if (!parsed) {
    if (!savedLine) return null;
    return (
      <div {...presence} className={className}>
        <span className="learn-bar-text">{savedLine}</span>
      </div>
    );
  }
  const { what, rule } = describeKind(parsed, labels);
  return (
    <div
      {...presence}
      className={className}
      role="group"
      aria-label={labels.learnLabel}
    >
      <span className="learn-bar-text">
        {saved === "failed"
          ? labels.memoryActionFailed
          : labels.learnSuggestion
              .replace("{what}", what)
              .replace("{rule}", rule)}
      </span>
      <div className="review-bar-actions">
        <button
          type="button"
          className="review-bar-button review-bar-accept"
          onClick={() => void reply("remembered", rule)}
        >
          {labels.learnRemember}
        </button>
        <button
          type="button"
          className="review-bar-button"
          onClick={() => void reply("later")}
        >
          {labels.learnNotNow}
        </button>
        <button
          type="button"
          className="learn-bar-never"
          onClick={() => void reply("never")}
        >
          {labels.learnNever}
        </button>
      </div>
    </div>
  );
}
