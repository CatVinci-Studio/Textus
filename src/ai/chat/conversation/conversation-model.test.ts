// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTurn } from "../../types";
import type { StreamEvent } from "../../../platform/ipc";
import type { ConversationEnv } from "./conversation-types";
import type { DocumentPort } from "./document-port";

const agentMessage = vi.fn();
const cancelAgentMessage = vi.fn(() => Promise.resolve());
const saveConversation = vi.fn();
const loadConversationTurns = vi.fn();

vi.mock("../../../platform/ipc", async () => {
  const actual = await vi.importActual<typeof import("../../../platform/ipc")>(
    "../../../platform/ipc",
  );
  return {
    ...actual,
    ai: {
      agentMessage: (...args: unknown[]) => agentMessage(...args),
      cancelAgentMessage: (...args: unknown[]) =>
        cancelAgentMessage(...(args as [])),
      memoryPass: () => Promise.resolve([]),
      offerSkill: () => Promise.resolve(null),
      suggestNextMessage: () => Promise.resolve([]),
    },
  };
});
vi.mock("../chat-history", async () => ({
  ...(await vi.importActual<typeof import("../chat-history")>(
    "../chat-history",
  )),
  saveConversation: (...args: unknown[]) => saveConversation(...args),
  loadConversationTurns: (...args: unknown[]) => loadConversationTurns(...args),
}));

const { ConversationModel, stopConversations } =
  await import("./conversation-model");
const { conversationFor, resetConversationsForTests } =
  await import("./conversation-registry");
const { attachDocument, detachDocument } = await import("./document-port");
const { DRAFT, closeConversation, liveConversation, setLiveConversation } =
  await import("../conversation-scope");
const { normaliseSettings } = await import("../../../prefs/SettingsContext");
const { IpcError, AI_CANCELLED } = await import("../../../platform/ipc");

const settings = { ...normaliseSettings(null), textusAi: true };
const NO_DOCUMENT = { markdown: "", blocks: [] };
const reply = (text: string): AgentTurn[] => [
  { kind: "User", text },
  { kind: "Assistant", text: `Re: ${text}` },
];

function port(docPath: string | null): DocumentPort & { events: unknown[] } {
  const events: unknown[] = [];
  return {
    docPath,
    events,
    onStreamEvent: (event) => events.push(event),
    proposalStatuses: () => ({}),
  };
}

function modelAt(
  env: Partial<ConversationEnv> = {},
  persist = true,
): InstanceType<typeof ConversationModel> {
  return new ConversationModel({
    persist,
    env: () => ({
      docPath: null,
      workspaceRoot: null,
      settings,
      port: null,
      ...env,
    }),
  });
}

beforeEach(() => {
  localStorage.clear();
  resetConversationsForTests();
  agentMessage.mockReset();
  agentMessage.mockImplementation((args: { message: string }) =>
    Promise.resolve(reply(args.message)),
  );
  cancelAgentMessage.mockClear();
  saveConversation.mockReset();
  loadConversationTurns.mockReset();
  loadConversationTurns.mockResolvedValue(null);
});

describe("a conversation's model", () => {
  it("sends, tells its listeners, and keeps the exchange", async () => {
    const model = modelAt({ docPath: "/notes/a.md" });
    const seen: boolean[] = [];
    model.subscribe(() => seen.push(model.snapshot().busy));
    const sending = model.actions.send(NO_DOCUMENT, " 你好 ");
    expect(model.snapshot().busy).toBe(true);
    expect(model.snapshot().streaming?.turns).toEqual([
      { kind: "User", text: "你好", images: [] },
    ]);
    expect(await sending).toEqual(reply("你好"));
    const state = model.snapshot();
    expect(state.busy).toBe(false);
    expect(state.streaming).toBeNull();
    expect(state.history).toEqual(reply("你好"));
    expect(seen).toContain(true);
    expect(seen.at(-1)).toBe(false);
  });

  it("is saved under the document it was sent from, and is its scope's live one", async () => {
    const model = modelAt({ docPath: "/notes/a.md", workspaceRoot: "/notes" });
    await model.actions.send(NO_DOCUMENT, "一");
    expect(saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: model.id,
        docPath: "/notes/a.md",
        turns: reply("一"),
      }),
    );
    expect(liveConversation("/notes")).toBe(model.id);
    expect(model.scope).toBe("/notes");
  });

  it("with no document sends the empty one, to the folder alone", async () => {
    const model = modelAt();
    await model.actions.send(NO_DOCUMENT, "一");
    expect(agentMessage.mock.calls[0][0]).toMatchObject({
      blocks: [],
      docPath: null,
      workspaceRoot: null,
    });
    expect(model.scope).toBeNull();
    expect(saveConversation).toHaveBeenCalledWith(
      expect.objectContaining({ docPath: null }),
    );
  });

  it("streams into the document it was sent about, though another comes in front", async () => {
    const first = port("/a.md");
    const second = port("/b.md");
    let front: DocumentPort = first;
    const model = modelAt({
      get port() {
        return front;
      },
    });
    const event: StreamEvent = { type: "delta", text: "好" };
    agentMessage.mockImplementation(
      (args: { message: string; onEvent: (e: StreamEvent) => void }) => {
        front = second;
        args.onEvent(event);
        return Promise.resolve(reply(args.message));
      },
    );
    await model.actions.send(NO_DOCUMENT, "一");
    expect(first.events).toEqual([event]);
    expect(second.events).toEqual([]);
  });

  it("keeps a failed send to retry, and says why", async () => {
    const model = modelAt();
    agentMessage.mockRejectedValueOnce(new Error("no network"));
    expect(await model.actions.send(NO_DOCUMENT, "一")).toBeUndefined();
    expect(model.snapshot().error).toContain("no network");
    expect(model.snapshot().retryable?.message).toBe("一");
    expect(await model.actions.retry()).toEqual(reply("一"));
    expect(model.snapshot().error).toBeNull();
    expect(model.snapshot().retryable).toBeNull();
  });

  it("keeps what streamed when stopped", async () => {
    const model = modelAt();
    agentMessage.mockImplementation(
      (args: { onEvent: (e: StreamEvent) => void }) => {
        args.onEvent({ type: "delta", text: "写到一半" });
        return Promise.reject(new IpcError("ai_agent_message", AI_CANCELLED));
      },
    );
    const kept = await model.actions.send(NO_DOCUMENT, "一");
    expect(kept?.at(-1)).toEqual({ kind: "Assistant", text: "写到一半" });
    expect(model.snapshot().error).toBeNull();
    expect(model.snapshot().history).toEqual(kept);
  });

  it("a reset fences off the reply still on its way", async () => {
    const model = modelAt();
    let land: (turns: AgentTurn[]) => void = () => {};
    agentMessage.mockImplementation(
      () => new Promise<AgentTurn[]>((resolve) => (land = resolve)),
    );
    const sending = model.actions.send(NO_DOCUMENT, "一");
    const before = model.id;
    model.actions.reset();
    expect(cancelAgentMessage).toHaveBeenCalled();
    land(reply("一"));
    expect(await sending).toBeUndefined();
    expect(model.id).not.toBe(before);
    expect(model.snapshot()).toMatchObject({ history: [], busy: false });
  });

  it("Quick Ask's stays out of History and of the scope", async () => {
    const model = modelAt({ docPath: "/a.md" }, false);
    await model.actions.send(NO_DOCUMENT, "一");
    expect(saveConversation).not.toHaveBeenCalled();
    expect(liveConversation("/a.md")).toBeNull();
  });

  it("out of sight, changes with the turns and not with the reply", async () => {
    const model = modelAt();
    agentMessage.mockImplementation(
      (args: { message: string; onEvent: (e: StreamEvent) => void }) => {
        const settled = model.settledSnapshot();
        args.onEvent({
          type: "turn",
          turn: { kind: "Assistant", text: "好" },
        });
        expect(model.snapshot().streaming?.turns).toHaveLength(2);
        expect(model.settledSnapshot()).toBe(settled);
        return Promise.resolve(reply(args.message));
      },
    );
    await model.actions.send(NO_DOCUMENT, "一");
    expect(model.settledSnapshot().history).toEqual(reply("一"));
  });

  it("Textus AI turned off stops what runs", () => {
    const model = modelAt();
    agentMessage.mockImplementation(() => new Promise(() => {}));
    void model.actions.send(NO_DOCUMENT, "一");
    stopConversations();
    expect(cancelAgentMessage).toHaveBeenCalledWith(model.requestId);
  });
});

describe("the window's conversations", () => {
  it("the draft keeps its turns as documents come and go, and is found by its id once sent", async () => {
    const draft = conversationFor(DRAFT, null);
    const untitled = port(null);
    attachDocument(untitled);
    await draft.actions.send(NO_DOCUMENT, "一");
    expect(draft.about).toBe(untitled);
    detachDocument(untitled);
    expect(conversationFor(DRAFT, null)).toBe(draft);
    expect(draft.snapshot().history).toEqual(reply("一"));

    const saved = port("/notes/a.md");
    attachDocument(saved);
    await draft.actions.send(NO_DOCUMENT, "二");
    expect(liveConversation("/notes/a.md")).toBe(draft.id);
    expect(conversationFor(draft.id, "/notes/a.md")).toBe(draft);
    expect(conversationFor(DRAFT, null)).not.toBe(draft);
    detachDocument(saved);
  });

  it("reads a conversation from History once, without saving it again", async () => {
    loadConversationTurns.mockResolvedValue(reply("旧"));
    const model = conversationFor("c1", "/notes");
    await vi.waitFor(() =>
      expect(model.snapshot().history).toEqual(reply("旧")),
    );
    expect(conversationFor("c1", "/notes")).toBe(model);
    expect(loadConversationTurns).toHaveBeenCalledTimes(1);
    expect(saveConversation).not.toHaveBeenCalled();
  });

  it("a conversation restored into another model takes its twin's place", () => {
    setLiveConversation("/notes", "c1");
    const twin = conversationFor("c1", "/notes");
    const draft = conversationFor(DRAFT, null);
    draft.restore("c1", reply("旧"), {
      docPath: "/notes/a.md",
      workspaceRoot: "/notes",
    });
    expect(conversationFor("c1", "/notes")).toBe(draft);
    expect(twin).not.toBe(draft);
  });

  it("a conversation whose tab is closed ends its request", () => {
    setLiveConversation("/notes", "c1");
    setLiveConversation("/notes", "c2");
    const model = conversationFor("c1", "/notes");
    agentMessage.mockImplementation(() => new Promise(() => {}));
    void model.actions.send(NO_DOCUMENT, "一");
    setLiveConversation("/notes", "c2");
    closeConversation("/notes", "c1");
    expect(cancelAgentMessage).toHaveBeenCalled();
    expect(conversationFor("c1", "/notes")).not.toBe(model);
  });
});
