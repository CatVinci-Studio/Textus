import { webSearchOn } from "../web-search-on";
import { errorText } from "../../../utils/error-text";
import { ai, AI_CANCELLED, IpcError } from "../../../platform/ipc";
import { resolveStrings } from "../../../i18n/strings";
import { reportAiState } from "../../../plugins/ai-state";
import { externalAgent } from "../../../plugins/contributions/agents";
import type { Settings } from "../../../prefs/SettingsContext";
import type { DocumentSnapshot } from "../../../editor/markdown/doc-markdown";
import { imageModelOf } from "../../image-models";
import { annotateProposalStatuses } from "../../revision/proposal-status";
import type { AgentTurn, ImageAttachment } from "../../types";
import { withoutAgentSteps } from "../../agents/agent-view";
import {
  AGENT_REQUEST,
  agentFolder,
  agentRequest,
} from "../../agents/agent-request";
import { keepCancelledTurns } from "../cancelled-turns";
import { afterFileChanges } from "../file-changes";
import { streamStep } from "../stream-step";
import { thinkingDone } from "../thought";
import {
  nameAfter,
  offerSkillAfter,
  rememberAfter,
} from "./conversation-passes";
import type { ConversationModel } from "./conversation-model";
import type { AgentRequestOptions } from "./conversation-types";
import { chosenModel } from "../../chosen-model";

const requestPrefs = (settings: Settings) => ({
  searchService: settings.searchService,
  searxngUrl: settings.searxngUrl,
  // Revisions: the folder's other files are kept as revisions, not written.
  askBeforeFileChanges: settings.aiChangeMode === "revision",
});

/** One message of `model`'s conversation, about `document`: the request,
 *  the reply streaming in, and what it leaves in the history. */
export async function sendMessage(
  model: ConversationModel,
  document: DocumentSnapshot,
  message: string,
  images: ImageAttachment[] = [],
  options?: AgentRequestOptions,
): Promise<AgentTurn[] | undefined> {
  const env = model.env();
  const { settings, port, docPath, workspaceRoot } = env;
  const sent = options ?? {
    mode: "review",
    webSearch: webSearchOn(),
  };
  const trimmed = message.trim();
  const { busy, history, conversationId } = model.snapshot();
  if (!trimmed || busy || !settings.textusAi) return undefined;
  // Files the reply changes are marked when it ends, however it ends.
  const revisions = settings.aiChangeMode === "revision";
  const provider = settings.aiProvider;
  const chosen = chosenModel(settings);
  model.lastOptions = sent;
  model.about = port;
  // What is said here is the folder's conversation from now on.
  model.publish(env);
  model.next.clear();
  model.patch({ error: null, retryable: null });
  model.setBusy(true);
  // The user's message shows immediately as a streamed turn - the real
  // one only enters the history when the whole exchange resolves.
  model.setStreaming({
    turns: [{ kind: "User", text: trimmed, images }],
    text: "",
    thought: null,
  });
  // Where this exchange's user turn lands in the history.
  const at = history.length;
  const keepThought = () => {
    const thought = thinkingDone(
      model.streamingNow?.thought ?? null,
      Date.now(),
    );
    if (thought)
      model.patch({
        thoughts: { ...model.snapshot().thoughts, [at]: thought },
      });
  };
  // An external agent answers the chat, not a model; never in Create or
  // Quick Ask.
  const agent =
    model.persist && sent.mode !== "create"
      ? externalAgent(settings.chatAgent)
      : undefined;
  const folder = agent ? agentFolder(workspaceRoot, docPath) : null;
  const requestId = (agent ? AGENT_REQUEST : "") + crypto.randomUUID();
  const generation = model.generation;
  const current = () => generation === model.generation;
  // Plugins are told who answers: an agent's provider and name, if it says.
  const [aiProvider, aiModel] = agent
    ? [agent.provider ?? agent.key, agent.name]
    : [provider, chosen];
  reportAiState("thinking", aiProvider, aiModel);
  let ended: "done" | "failed" | "stopped" = "stopped";
  model.requestId = requestId;
  // add_comment arguments streaming in, by call id.
  const commentArgs = new Map<string, string>();
  try {
    if (agent && !folder)
      throw new Error(resolveStrings(settings.language).agentNeedsFolder);
    const newTurns = agent
      ? await agentRequest({
          agent,
          conversation: conversationId,
          folder: folder!,
          docPath,
          message: trimmed,
          images,
          get: () => model.streamingNow,
          set: (value, opts) => {
            if (current()) model.setStreaming(value, opts);
          },
        })
      : await ai.agentMessage({
          provider,
          blocks: document.blocks,
          docPath,
          workspaceRoot,
          conversation: conversationId,
          history: annotateProposalStatuses(
            withoutAgentSteps(history),
            port?.proposalStatuses() ?? {},
          ),
          message: trimmed,
          images,
          webSearch: sent.webSearch,
          thinking: sent.thinking,
          ...requestPrefs(settings),
          mode: sent.mode,
          focusHeading: sent.focusHeading ?? null,
          // The agent is told the UI's names for things in this language.
          uiLanguage: settings.language,
          model: chosen,
          // generate_image is offered only with an image model.
          imageModel: imageModelOf(settings),
          requestId,
          onEvent: (event) => {
            if (!current()) return;
            port?.onStreamEvent(event);
            const step = streamStep(
              model.streamingNow,
              event,
              document.blocks,
              commentArgs,
              Date.now(),
            );
            if (!step) return;
            if (step.phase) reportAiState(step.phase, aiProvider, aiModel);
            model.setStreaming(step.next, { textOnly: step.textOnly });
          },
        });
    if (!current()) return undefined;
    keepThought();
    model.setHistory((prev) => [...prev, ...newTurns]);
    // What follows asks Textus AI's model, which an agent's chat doesn't use,
    // and is about a conversation that is kept: never a Quick Ask's.
    const after = [...history, ...newTurns];
    if (!agent && model.persist) {
      void rememberAfter(model, env, after, at + newTurns.length);
      void offerSkillAfter(model, env, after, at + newTurns.length);
      model.next.suggestAfter(after, provider, chosen, settings.textusAi);
    }
    // Named by Textus AI's model, whoever answered.
    if (model.persist) void nameAfter(model, env, after);
    void afterFileChanges(conversationId, newTurns, revisions);
    ended = "done";
    return newTurns;
  } catch (err) {
    if (!current()) return undefined;
    // A user-initiated stop() isn't a failure: no error, nothing to retry.
    // What already streamed enters history as a completed exchange would.
    if (err instanceof IpcError && err.cause === AI_CANCELLED) {
      const partial = model.streamingNow;
      const kept = keepCancelledTurns(
        partial?.turns ?? [],
        partial?.text ?? "",
      );
      if (kept.length === 0) return undefined;
      keepThought();
      model.setHistory((prev) => [...prev, ...kept]);
      void afterFileChanges(conversationId, kept, revisions);
      return kept;
    }
    ended = "failed";
    // Files already changed before it failed: shown, marked and undoable
    // all the same (as revisions, kept for their files).
    void afterFileChanges(
      conversationId,
      model.streamingNow?.turns ?? [],
      revisions,
    );
    model.patch({
      error: errorText(err),
      retryable: { document, message: trimmed, images, options: sent },
    });
    return undefined;
  } finally {
    reportAiState("idle", aiProvider, aiModel, ended);
    port?.onReplyEnd?.(ended === "failed");
    if (current()) {
      model.requestId = null;
      model.setStreaming(null);
      model.setBusy(false);
    }
  }
}
