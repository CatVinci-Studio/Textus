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
  /** The paper's id in `.textus/papers/`, once research has made it. */
  paperId: string | null;
  sections: Record<number, SectionStatus>;
  used: BudgetCounts | null;
  outline: Outline | null;
  /** Approve was pressed: the outline is saved and drafting starting. */
  approving: boolean;
  /** Why the run stopped, when it failed. */
  error: string | null;
  /** The paper was proposed. */
  proposed: boolean;
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
  /** The tail of what each section's writer has written so far. */
  sectionText: Record<number, string>;
  /** False when research can't search the web; null until it says. */
  webSearch: boolean | null;
}

const NEW_RUN: PaperRunState = {
  phase: "starting",
  paperId: null,
  sections: {},
  used: null,
  outline: null,
  approving: false,
  error: null,
  proposed: false,
  unit: "",
  thinking: "",
  questions: [],
  recent: [],
  phaseSince: 0,
  outlineDraft: null,
  sectionText: {},
  webSearch: null,
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
  stop: (key: string) => void;
}

let actions: PaperActions | null = null;

export function setPaperActions(next: PaperActions | null) {
  actions = next;
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

/** The finished paper as one proposal: appended to the document, like
 *  any proposal the AI makes. */
export function paperProposalTurns(
  key: string,
  markdown: string,
  reply: string,
): AgentTurn[] {
  const callId = `paper-${key}#0`;
  return [
    {
      kind: "ToolCall",
      call_id: callId,
      name: "propose_edit",
      arguments: JSON.stringify({ action: "append", text: markdown }),
    },
    { kind: "ToolResult", call_id: callId, output: "Edit proposed" },
    { kind: "Assistant", text: reply },
  ];
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
