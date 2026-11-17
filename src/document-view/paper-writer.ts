import { fill } from "../i18n/fill";
import { AI_CANCELLED, ai } from "../platform/ipc";
import { errorText } from "../utils/error-text";
import { imageModelOf } from "../ai/image-models";
import type { AgentConversation } from "../ai/chat/conversation/conversation-types";
import type { Settings } from "../prefs/SettingsContext";
import type { Strings } from "../i18n/strings";
import type {
  Genre,
  Outline,
  PaperProgress,
} from "../platform/bindings/ai-paper";
import {
  applyPaperEvent,
  newPaperId,
  paperCardTurns,
  paperLanguage,
  paperRun,
  paperWrittenTurns,
  updatePaperRun,
} from "../ai/paper/paper-store";
import { withoutPictures } from "../ai/paper/paper-document";
import { figureErrors } from "../ai/paper/figure-check";
import type { usePaperDocument } from "./usePaperDocument";
import { chosenModel } from "../ai/chosen-model";
import { aiRoot } from "../ai/workspace/ai-root";

/** What a paper's steps read when they start, so a run picks up the
 *  settings of its moment. */
export type PaperLatest = {
  settings: Settings;
  filePath: string | null;
  conversation: AgentConversation;
  t: Strings;
  paperDocument: ReturnType<typeof usePaperDocument>;
};

/** A document's paper runs: research, outline approval, drafting straight
 *  into the document, stopping, going on, and cards restored. */
export function paperWriter(latest: { readonly current: PaperLatest }) {
  // Each card's request in flight, to stop it.
  const requests = new Map<string, string>();

  /** What every paper command is sent with. */
  const common = () => {
    const { settings: s, filePath: docPath } = latest.current;
    return {
      provider: s.aiProvider,
      model: chosenModel(s),
      docPath,
      workspaceRoot: aiRoot(s),
      imageModel: imageModelOf(s),
    };
  };

  /** A run that ended short: paused by the user, or failed. What was
   *  written stays, as text of the user's own, and what was kept on disk
   *  is gone on from with Continue. */
  const fail = (key: string, err: unknown) => {
    requests.delete(key);
    latest.current.paperDocument.settle(key);
    const paused = errorText(err) === AI_CANCELLED;
    updatePaperRun(key, () => ({
      error: paused ? null : errorText(err),
      paused,
      approving: false,
    }));
  };

  /** Drafts paper `key` from its approved outline once `ready` resolves,
   *  writing it into the document as it comes; to true when it was begun
   *  before, so what was written of it is taken back, not written twice. */
  const draft = (key: string, id: string, ready: Promise<boolean>) => {
    const base = common();
    const requestId = crypto.randomUUID();
    requests.set(key, requestId);
    void ready
      .then((goingOn) => {
        latest.current.paperDocument.begin(key, goingOn);
        return ai.paperDraft(
          {
            provider: base.provider,
            model: base.model,
            docPath: base.docPath,
            workspaceRoot: base.workspaceRoot,
            requestId,
            id,
            imageModel: base.imageModel,
            checkClaims: latest.current.settings.researchCheckClaims,
          },
          (event) => {
            if (event.type === "drawFigures") {
              // A writer's figures, drawn before its section is kept; no
              // answer leaves them to Rust's own checks.
              void figureErrors(event.blocks).then((errors) =>
                ai.paperFiguresDrawn(event.callId, errors).catch(() => {}),
              );
              return;
            }
            applyPaperEvent(key, event);
            if (event.type === "sectionText")
              latest.current.paperDocument.update(key);
            if (event.type !== "ready") return;
            latest.current.paperDocument.settle(
              key,
              withoutPictures(event.markdown),
            );
            latest.current.conversation.append(
              paperWrittenTurns(latest.current.t.paperWritten),
            );
            updatePaperRun(key, () => ({ written: true }));
            void latest.current.paperDocument.addPictures(key, event.markdown);
          },
        );
      })
      .then(() => {
        requests.delete(key);
        latest.current.paperDocument.settle(key);
        updatePaperRun(key, () => ({ approving: false }));
      })
      .catch((err) => fail(key, err));
  };

  const approve = (key: string, outline: Outline) => {
    const run = paperRun(key);
    if (!run?.paperId || run.approving) return;
    const id = run.paperId;
    const base = common();
    updatePaperRun(key, () => ({ approving: true, error: null }));
    draft(
      key,
      id,
      ai
        .paperSaveOutline(base.docPath, base.workspaceRoot, id, outline)
        .then((saved) => {
          updatePaperRun(key, () => ({ outline: saved }));
          return false;
        }),
    );
  };

  /** Researches and outlines paper `key`, or goes on with what it kept. */
  const research = (
    key: string,
    topic: string,
    genre: Genre | null,
    targetChars: number | null,
    // The conversation whose attached files a new paper reads; a paper
    // going on keeps its own copy.
    conversation: string | null = null,
  ) => {
    const { settings: s } = latest.current;
    const requestId = crypto.randomUUID();
    requests.set(key, requestId);
    void ai
      .paperRun(
        {
          ...common(),
          searchService: s.searchService,
          searxngUrl: s.searxngUrl || null,
          requestId,
          id: key,
          topic,
          language: paperLanguage(topic, s.language),
          genre,
          targetChars,
          conversation,
          subHelpers: s.researchSubHelpers,
        },
        (event) => applyPaperEvent(key, event),
      )
      .then((paper) => {
        requests.delete(key);
        updatePaperRun(key, () => ({ paperId: paper.id }));
        // A genre written straight on approves its own outline.
        const run = paperRun(key);
        if (run?.outline && run.form?.checkpoint === false)
          approve(key, run.outline);
      })
      .catch((err) => fail(key, err));
  };

  const stop = (key: string) => {
    const requestId = requests.get(key);
    if (requestId) void ai.cancelAgentMessage(requestId);
  };

  /** How far paper `key` came, as kept beside its document. */
  const status = (key: string): Promise<PaperProgress> => {
    const base = common();
    return ai.paperStatus(base.docPath, base.workspaceRoot, key);
  };

  const resume = (key: string) => {
    const run = paperRun(key);
    if (!run || requests.has(key)) return;
    // Held until the run's own request replaces it: a second Continue
    // while the paper's state is read starts nothing.
    requests.set(key, "");
    updatePaperRun(key, () => ({
      paused: false,
      error: null,
      phaseSince: Date.now(),
    }));
    void status(key)
      .then(({ paper, outline, form }) => {
        updatePaperRun(key, () => ({ genre: paper.genre ?? null, form }));
        if (
          (paper.stage === "drafting" || paper.stage === "reviewed") &&
          outline
        ) {
          updatePaperRun(key, () => ({
            outline,
            approving: true,
            sectionText: {},
            sections: {},
          }));
          draft(key, paper.id, Promise.resolve(true));
        } else if (paper.stage !== "done") {
          research(key, paper.topic, paper.genre ?? null, paper.targetChars);
        } else {
          requests.delete(key);
        }
      })
      .catch((err) => fail(key, err));
  };

  const restore = (key: string, topic: string) => {
    if (paperRun(key)) return;
    void status(key)
      .then(({ paper, outline, form }) => {
        if (paperRun(key)) return;
        const { t: strings } = latest.current;
        updatePaperRun(key, () => ({
          topic,
          paperId: paper.id,
          genre: paper.genre ?? null,
          form,
          outline,
          unit: /^(zh|ja|ko)/.test(paper.language)
            ? strings.paperUnitCharacters
            : strings.paperUnitWords,
          ...(paper.stage === "done"
            ? { phase: "done", written: true }
            : paper.stage === "outlined" && outline
              ? { phase: "awaitingOutline" }
              : { paused: true }),
        }));
      })
      // Not kept, or from before papers could go on: its run has ended.
      .catch(() => {});
  };

  /** Starts a piece on `topic` of `genre`, or of the model's choice when
   *  null, at its genre's length, researched from the files attached to
   *  `conversation` too. Its card's key is its id, so the card finds it
   *  again after a restart. */
  const start = (
    topic: string,
    genre: Genre | null,
    conversation: string,
    openPanel: () => void,
  ) => {
    const { settings: s, t: strings } = latest.current;
    const key = newPaperId();
    const language = paperLanguage(topic, s.language);
    updatePaperRun(key, () => ({
      topic,
      paperId: key,
      // A genre picked shows on the card at once; the model's, once chosen.
      genre,
      unit: /^(zh|ja|ko)/.test(language)
        ? strings.paperUnitCharacters
        : strings.paperUnitWords,
    }));
    openPanel();
    latest.current.conversation.append(
      paperCardTurns(key, topic, fill(strings.paperAsk, { topic })),
    );
    research(key, topic, genre, null, conversation);
  };

  return { approve, stop, resume, restore, start };
}
