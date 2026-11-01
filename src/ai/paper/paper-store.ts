import { useSyncExternalStore } from "react";
import type { AgentTurn } from "../types";
import type {
  ActivityKind,
  BudgetCounts,
  Outline,
  PaperEvent,
  PaperPhase,
  SectionStatus,
} from "../../platform/bindings/ai-paper";
import type { PaperSources } from "./paper-document";

/** The name a paper card's turns go by in the conversation. Keep in step
 *  with Rust's `PAPER_TURN` (ai/agent/history.rs), which keeps them from
 *  the model. */
export const PAPER_TURN = "write_paper";

/** What the conversation keeps of a paper: enough to draw its card. */
export interface PaperCardInfo {
  /** This paper's card, in this session's store. */
  key: string;
  topic: string;
}

/** One research question as the card lists it. */
export interface QuestionState {
  text: string;
  /** Waiting for a helper, being researched, finished or failed. */
  state: "waiting" | "active" | "done" | "failed";
  notes: number;
}

/** One thing a research helper did, as the card's recent list shows it. */
export interface PaperActivity {
  /** Unique in its run: the list's key. */
  id: number;
  question: number;
  kind: ActivityKind;
  detail: string;
}

/** How many of the helpers' latest steps the card keeps. */
export const RECENT_ACTIVITY = 4;

/** A paper's run as its card shows it. Session only: a card reopened from
 *  History has none, and says its run has ended. */
export interface PaperRunState {
  phase: PaperPhase | "starting";
  /** What the paper is on: its title until the finished paper has one. */
  topic: string;
  /** The paper's id in `.textus/papers/`, once research has made it. */
  paperId: string | null;
  sections: Record<number, SectionStatus>;
  used: BudgetCounts | null;
  outline: Outline | null;
  /** Approve was pressed: the outline is saved and drafting starting. */
  approving: boolean;
  /** Why the run stopped, when it failed. */
  error: string | null;
  /** Paused by the user, or found stopped when its card came back: it
   *  goes on from what was kept. */
  paused: boolean;
  /** The paper is written in the document for good. */
  written: boolean;
  /** Its pictures still to come into the document. */
  picturesLeft: number;
  /** "characters" or "words", in the UI language: the outline's lengths. */
  unit: string;
  /** The tail of what the planner is thinking, while it plans. */
  thinking: string;
  questions: QuestionState[];
  /** The helpers' latest steps, newest first. */
  recent: PaperActivity[];
  /** When the run entered its phase, for the time it has spent there. */
  phaseSince: number;
  /** The outline as the outliner writes it, before it is whole. */
  outlineDraft: {
    attempt: number;
    thesis: string | null;
    titles: string[];
  } | null;
  /** What each section's writer has written so far. */
  sectionText: Record<number, string>;
  /** False when research can't search the web; null until it says. */
  webSearch: boolean | null;
  /** What the sections may cite, once drafting has begun. */
  sources: PaperSources | null;
}

const NEW_RUN: PaperRunState = {
  phase: "starting",
  topic: "",
  paperId: null,
  sections: {},
  used: null,
  outline: null,
  approving: false,
  error: null,
  paused: false,
  written: false,
  picturesLeft: 0,
  unit: "",
  thinking: "",
  questions: [],
  recent: [],
  phaseSince: 0,
  outlineDraft: null,
  sectionText: {},
  webSearch: null,
  sources: null,
};

const runs = new Map<string, PaperRunState>();
const listeners = new Set<() => void>();

export function paperRun(key: string): PaperRunState | undefined {
  return runs.get(key);
}

export function updatePaperRun(
  key: string,
  change: (run: PaperRunState) => Partial<PaperRunState>,
) {
  const run = runs.get(key) ?? { ...NEW_RUN, phaseSince: Date.now() };
  runs.set(key, { ...run, ...change(run) });
  for (const listen of listeners) listen();
}

/** A run's state changed by one of its events. */
export function applyPaperEvent(key: string, event: PaperEvent) {
  updatePaperRun(key, (run) => {
    switch (event.type) {
      case "phase":
        return run.phase === event.phase
          ? {}
          : { phase: event.phase, thinking: "", phaseSince: Date.now() };
      case "section":
        return { sections: { ...run.sections, [event.index]: event.status } };
      case "budget":
        return { used: event.used };
      case "outlineReady":
        return { outline: event.outline };
      case "error":
        // A helper's failure costs one question, not the run: shown only
        // if the run then fails.
        return {};
      case "ready":
        return {};
      case "outlineDraft":
        return {
          outlineDraft: {
            attempt: event.attempt,
            thesis: event.thesis ?? null,
            titles: event.titles,
          },
        };
      case "sectionText":
        return {
          sectionText: { ...run.sectionText, [event.index]: event.text },
        };
      case "sources":
        return {
          sources: { heading: event.heading, sources: event.sources },
        };
      case "webSearch":
        return { webSearch: event.available };
      case "thinking":
        return { thinking: event.text };
      case "questions":
        return {
          questions: event.questions.map((text) => ({
            text,
            state: "waiting",
            notes: 0,
          })),
        };
      case "activity":
        return {
          questions: withQuestion(run.questions, event.question, (q) => ({
            state: "active",
            notes: q.notes + (event.kind === "note" ? 1 : 0),
          })),
          recent: [
            {
              id: (run.recent[0]?.id ?? 0) + 1,
              question: event.question,
              kind: event.kind,
              detail: event.detail,
            },
            ...run.recent,
          ].slice(0, RECENT_ACTIVITY),
        };
      case "questionDone":
        return {
          questions: withQuestion(run.questions, event.question, () => ({
            state: event.failed ? "failed" : "done",
            notes: event.notes,
          })),
        };
    }
  });
}

/** `questions` with question `index` changed, the rest as they were. */
function withQuestion(
  questions: QuestionState[],
  index: number,
  change: (q: QuestionState) => Partial<QuestionState>,
): QuestionState[] {
  if (!questions[index]) return questions;
  return questions.map((q, i) => (i === index ? { ...q, ...change(q) } : q));
}

function subscribe(listen: () => void) {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

/** The run behind card `key`, re-rendering as it changes. */
export function usePaperRun(key: string): PaperRunState | undefined {
  return useSyncExternalStore(subscribe, () => runs.get(key));
}

/** What a card's buttons do, registered by the editor that runs papers. */
export interface PaperActions {
  approve: (key: string, outline: Outline) => void;
  /** Pauses the run: what it kept stays, to go on from. */
  stop: (key: string) => void;
  /** Goes on with a paused or failed paper from what it kept. */
  resume: (key: string) => void;
  /** A card with no run - the app was restarted - learns how far its
   *  paper came. */
  restore: (key: string, topic: string) => void;
}

/** A new paper's card key, which is also its id in `.textus/papers/`:
 *  lowercase hex of the time, as Rust's `new_id`, so ids sort by age. */
export function newPaperId(): string {
  const nanos =
    BigInt(Date.now()) * 1_000_000n + BigInt(Math.floor(Math.random() * 1e6));
  return nanos.toString(16);
}

let actions: PaperActions | null = null;

/** Cards that asked to be restored before the editor that runs papers
 *  was there to hear it - a card's effects run before its editor's. */
const toRestore = new Map<string, string>();

export function setPaperActions(next: PaperActions | null) {
  actions = next;
  if (!next) return;
  for (const [key, topic] of toRestore) next.restore(key, topic);
  toRestore.clear();
}

/** Asks how far card `key`'s paper came, now or once papers can run. */
export function restorePaperCard(key: string, topic: string) {
  if (actions) actions.restore(key, topic);
  else toRestore.set(key, topic);
}

export function paperActions(): PaperActions | null {
  return actions;
}

/** The turns that put a paper's card in the conversation: the user's ask,
 *  and the card. */
export function paperCardTurns(
  key: string,
  topic: string,
  ask: string,
): AgentTurn[] {
  const info: PaperCardInfo = { key, topic };
  return [
    { kind: "User", text: ask },
    {
      kind: "ToolCall",
      call_id: `${PAPER_TURN}-${key}`,
      name: PAPER_TURN,
      arguments: "{}",
    },
    {
      kind: "ToolResult",
      call_id: `${PAPER_TURN}-${key}`,
      output: JSON.stringify(info),
    },
  ];
}

/** A card turn's paper, or null for any other result. */
export function parsePaperCard(
  callId: string,
  output: string,
): PaperCardInfo | null {
  if (!callId.startsWith(`${PAPER_TURN}-`)) return null;
  try {
    const info = JSON.parse(output) as Partial<PaperCardInfo>;
    return typeof info.key === "string" && typeof info.topic === "string"
      ? { key: info.key, topic: info.topic }
      : null;
  } catch {
    return null;
  }
}

/** What the conversation says once the paper is in the document. */
export function paperWrittenTurns(reply: string): AgentTurn[] {
  return [{ kind: "Assistant", text: reply }];
}

/** The language a paper on `topic` is written in: Chinese for a topic in
 *  Chinese characters when the UI isn't Chinese or Japanese, else the UI's. */
export function paperLanguage(topic: string, uiLanguage: string): string {
  const han = /[一-鿿]/.test(topic);
  const kana = /[぀-ヿ]/.test(topic);
  const hangul = /[가-힯]/.test(topic);
  if (kana) return "ja";
  if (hangul) return "ko";
  if (han && !/^(zh|ja)/.test(uiLanguage)) return "zh";
  if (!han && /^(zh|ja|ko)/.test(uiLanguage) && /[a-z]{3}/i.test(topic))
    return "en";
  return uiLanguage;
}
