import type { RefObject } from "react";
import { fill } from "../../i18n/fill";
import type { DocumentSnapshot } from "../../editor/markdown/doc-markdown";
import { scrollBehavior } from "../../engine/motion/motion";
import type { AgentRequestOptions } from "./conversation/conversation-types";
import type {
  AgentTurn,
  ChatAttachment,
  EditProposal,
  ImageAttachment,
} from "../types";
import type { ChatComposerHandle } from "./ChatComposer";
import { useQueueInsert } from "./useQueueInsert";
import { composeMessage } from "./user-message";
import { type ChatBodyProps, proposalsFromTurns } from "./chat-body-types";
import { useMessageQueue } from "./useChatBodyState";
import type { useFollowBottom } from "./useFollowBottom";

type Compose = (state: {
  document: DocumentSnapshot;
  selectionMarkdown: string | null;
  cursor?: { before: string; after: string } | null;
}) => { message: string; images?: ImageAttachment[] };

/** Every way a message leaves the conversation pane: the box, a chip, Ask
 *  again, Continue, Retry, and the queue that holds them while a reply is
 *  coming. */
export function useChatSend(
  props: Pick<
    ChatBodyProps,
    | "conversation"
    | "document"
    | "selectionMarkdown"
    | "refreshContext"
    | "prepareMessage"
    | "onProposals"
    | "labels"
  >,
  follow: ReturnType<typeof useFollowBottom>,
  composer: RefObject<ChatComposerHandle | null>,
) {
  const { conversation, document, selectionMarkdown, refreshContext } = props;
  const { prepareMessage, onProposals, labels } = props;
  const { busy, retryable, send, stop, steer, retry, streaming } = conversation;
  const listRef = follow.ref;

  function afterSend(newTurns: AgentTurn[] | undefined) {
    const proposals = proposalsFromTurns(newTurns ?? []);
    if (proposals.length > 0) onProposals(proposals);
    follow.stick();
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({
        top: listRef.current.scrollHeight,
        behavior: scrollBehavior(),
      });
    });
  }

  /**
   * Composes a new message against the document as it reads at send time
   * (`refreshContext` first). Retry doesn't come through here: it resends the
   * failed message verbatim, against the document it was composed for.
   */
  function dispatchSend(buildMessage: Compose, options: AgentRequestOptions) {
    // In flight from the start: a second send meanwhile joins the queue.
    void (async () => {
      const turns = await run(async () => {
        const latest = refreshContext ? await refreshContext() : null;
        const state = latest ?? { document, selectionMarkdown };
        const { message, images } = buildMessage(state);
        return send(state.document, message, images, {
          ...options,
          focusHeading: latest?.focusHeading ?? null,
        });
      });
      afterSend(turns);
    })();
  }

  // Messages sent while a reply is coming, sent in turn once the replies
  // before them finish. A failed reply pauses them; Stop gives them back.
  const queueState = useMessageQueue(
    busy,
    retryable,
    conversation.conversationId,
    async (next) => {
      const latest = refreshContext ? await refreshContext() : null;
      const turns = await send(
        latest?.document ?? document,
        next.message,
        next.images,
        { ...next.options, focusHeading: latest?.focusHeading ?? null },
      );
      afterSend(turns);
      return turns;
    },
    (typed) => composer.current?.restore(typed),
  );
  const { queue, setQueue, queuePaused, goOn, giveBack } = queueState;
  const { nextQueued, sending, run } = queueState;
  const insertQueued = useQueueInsert(queue, setQueue, {
    turns: streaming?.turns,
    steer,
    stop,
  });

  function handleSend(
    typedMessage: string,
    attachments: ChatAttachment[],
    includeSelection: boolean,
    options: AgentRequestOptions,
    typed: string = typedMessage,
  ) {
    const message = prepareMessage?.(typedMessage) ?? typedMessage;
    submit(
      (state) => composeMessage(state, message, attachments, includeSelection),
      options,
      typed,
    );
  }

  /** Sends now when nothing is under way, else queues: every send from the
   *  box, a chip, Ask again or Continue comes through here. */
  function submit(
    compose: (state: {
      selectionMarkdown: string | null;
      cursor?: { before: string; after: string } | null;
    }) => { message: string; images?: ImageAttachment[] },
    options: AgentRequestOptions,
    typed: string,
  ) {
    if (!busy && queue.length === 0 && !sending.current) {
      dispatchSend(compose, options);
      return;
    }
    void (async () => {
      const latest = refreshContext ? await refreshContext() : null;
      const composed = compose(latest ?? { selectionMarkdown });
      const id = nextQueued.current++;
      setQueue((now) => [...now, { id, typed, ...composed, options }]);
    })();
  }

  /** Stop drops the queue too: what was waiting goes back in the box. */
  function stopAll() {
    giveBack();
    stop();
  }

  /** An anchor that no longer resolves: ask the model to re-issue the edit
   *  against the document as it now reads, rather than writing text whose
   *  target we can't locate. */
  function handleRelocate(proposal: EditProposal) {
    const message = fill(labels.relocateRequest, { text: proposal.text ?? "" });
    submit(() => ({ message }), { mode: "write", webSearch: false }, message);
  }

  /** Continue, after an exchange ran out of steps: asks it to go on, the
   *  way the last message was sent. */
  function handleContinue() {
    const message = labels.continueRequest;
    submit(
      () => ({ message }),
      conversation.lastOptions() ?? { mode: "write", webSearch: false },
      message,
    );
  }

  function handleRetry() {
    void (async () => {
      afterSend(await run(retry));
    })();
  }

  return {
    queue,
    setQueue,
    queuePaused,
    goOn,
    insertQueued,
    handleSend,
    stopAll,
    handleRelocate,
    handleContinue,
    handleRetry,
  };
}
