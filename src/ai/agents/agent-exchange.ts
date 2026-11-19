import { optionsOf, setOption, type Opened } from "./agent-legacy";
import { fill } from "../../i18n/fill";
import { IpcError } from "../../platform/ipc-call";
import { AI_CANCELLED } from "../../platform/ipc-ai-types";
import { agentsIpc } from "../../platform/ipc-plugins";
import { appVersion } from "../../platform/app-info";
import { currentStrings } from "../../i18n/current";
import type { ExternalAgent } from "../../plugins/contributions/agents";
import type { AgentTurn, ImageAttachment } from "../types";
import {
  AcpConnection,
  AcpError,
  AUTH_REQUIRED,
  CLIENT_CAPABILITIES,
  PROTOCOL_VERSION,
  type PermissionOption,
  type PermissionOutcome,
  type SessionUpdate,
  type ToolCallFields,
} from "./acp-client";
import { explain, stoppedText } from "./agent-errors";
import { stepFacts, type StepFacts } from "./agent-steps";
import {
  followEdit,
  readForAgent,
  writeForAgent,
  type EditSnapshots,
} from "./agent-files";
import { applyUpdate, finish, thoughtOf, type AgentView } from "./agent-view";
import {
  applyChoices,
  choicesToSend,
  heardCommands,
  heardOptions,
  heardValue,
  noteRefused,
  offerOf,
} from "./agent-offers";
import { modeOption } from "./agent-mode";
import { allowedUnasked } from "./agent-approval";
import { promptBlocks } from "./agent-prompt";
import { loadSettings, subscribeRemote } from "../../prefs/settings-store";
import { createSubscribers } from "../../utils/store";

/**
 * One exchange with an external agent, in a session kept for the
 * conversation: the agent keeps its own context between messages, so each
 * prompt carries only the new message and the document it is about.
 */

/** A step the agent asks the user to allow, shown under the reply. */
export interface PendingPermission {
  title: string;
  /** The step's kind as the agent names it: "execute" for a command. */
  kind?: string;
  /** The command it runs, or the file, address or search it reaches. */
  detail?: string;
  options: PermissionOption[];
  /** The option chosen, or null to refuse. */
  choose(optionId: string | null): void;
}

interface ExchangeEvents {
  /** The exchange so far. */
  view(view: AgentView): void;
  thinking(text: string): void;
  permission(pending: PendingPermission | null): void;
}

interface Session {
  agent: string;
  cwd: string;
  connection: AcpConnection;
  sessionId: string;
  /** The exchange running now, which hears updates and asks permission. */
  events: ExchangeEvents | null;
  /** Refuses the permission being asked, if one is. */
  refuse: (() => void) | null;
  /** Ended by Stop: what it was doing ends as a stop does, not an error. */
  stopped?: boolean;
  /** Out of use (it refused the mode): stopped once its reply ends. */
  retired?: boolean;
  /** It reads images in a prompt (ACP's promptCapabilities.image). */
  images?: boolean;
  /** Its mode and model are set the older way (agent-legacy.ts). */
  older?: boolean;
  /** Its steps as heard, by id, for the permissions that name only that. */
  steps: Map<string, StepFacts>;
  /** Its edit steps' files as they were, to mark what they changed. */
  edits: EditSnapshots;
}

const sessions = new Map<string, Session>();
/** Sessions out of use whose reply still runs, by conversation: Stop and
 *  closing the chat still reach them. */
const retired = new Map<string, Session>();
const subscribers = createSubscribers();
const sessionsChanged = subscribers.publish;

/** Hears sessions start and end in this window. */
export const subscribeSessions = subscribers.subscribe;
/** Conversations whose agent is still starting (or signing in): how to
 *  give up on it. */
const starting = new Map<string, () => void>();

/** Ends a conversation's agent, if it has one. */
export function endAgentSession(conversation: string): void {
  starting.get(conversation)?.();
  const session = sessions.get(conversation);
  sessions.delete(conversation);
  sessionsChanged();
  session?.connection.stop();
  retired.get(conversation)?.connection.stop();
  retired.delete(conversation);
}

/** A session no message goes to again; the reply it is giving finishes. */
function retire(session: Session) {
  for (const [conversation, s] of [...sessions])
    if (s === session) {
      sessions.delete(conversation);
      if (session.events) retired.set(conversation, session);
    }
  sessionsChanged();
  if (session.events) session.retired = true;
  else session.connection.stop();
}

/** Whether a session of `agent` runs in this window. */
export const agentRunning = (agent: string) =>
  [...sessions.values()].some((s) => s.agent === agent && s.sessionId);

/** Sets an option of `agent` in every session of it running in this
 *  window. A session that refuses the mode is ended: none goes on in a
 *  mode its menu no longer shows. The refusal is kept, so the next one
 *  starts in the mode that asks and isn't sent it again. */
async function setInSessions(agent: string, configId: string, value: string) {
  const isMode = configId === modeOption(offerOf(agent).options)?.id;
  const live = new Set(sessions.values());
  await Promise.all(
    [...live].map(async (session) => {
      if (session.agent !== agent || !session.sessionId) return;
      try {
        const answer = await setOption(session, configId, value);
        if (answer?.configOptions) heardOptions(agent, answer.configOptions);
        else heardValue(agent, configId, value);
      } catch {
        noteRefused(agent, configId, value);
        if (isMode) retire(session);
      }
    }),
  );
}

/** The options in the agent's order, each after it answered the one
 *  before (an effort its new model offers). */
async function sendInOrder(agent: string, entries: [string, string][]) {
  const order = offerOf(agent).options.map((o) => o.id);
  const rank = (id: string) =>
    order.includes(id) ? order.indexOf(id) : order.length;
  const sorted = [...entries].sort(([a], [b]) => rank(a) - rank(b));
  for (const [id, value] of sorted) await setInSessions(agent, id, value);
}

/** Each option still not as wanted, read again after each answer: a new
 *  model may bring the effort the user chose. */
async function sendWanted(agent: string) {
  const done = new Set<string>();
  for (;;) {
    const next = choicesToSend(agent).find(([id]) => !done.has(id));
    if (!next) return;
    done.add(next[0]);
    await setInSessions(agent, ...next);
  }
}

/** An option the user just chose in this window. */
export function setAgentOption(agent: string, configId: string, value: string) {
  // Seen here: another window's change later doesn't send it again.
  if (seen) seen = loadSettings().agentOptions;
  void setInSessions(agent, configId, value);
}

let seen: Record<string, Record<string, string>> | null = null;
/** A choice made in another window reaches this window's sessions too:
 *  only the choices that changed, never a re-send on any other setting. */
function followChoices() {
  if (seen) return;
  seen = loadSettings().agentOptions;
  subscribeRemote(() => {
    const now = loadSettings().agentOptions;
    const before = seen ?? {};
    seen = now;
    for (const agent of new Set([...sessions.values()].map((s) => s.agent))) {
      const changed = Object.entries(now[agent] ?? {}).filter(
        ([id, value]) => before[agent]?.[id] !== value,
      );
      if (changed.length) void sendInOrder(agent, changed);
    }
  });
}

/** How long an agent has to stop once asked before its process is ended. */
const STOP_GRACE_MS = 5000;

/** Stops the step the agent is on; what streamed so far stays. One that
 *  hasn't stopped by STOP_GRACE_MS is ended, its session with it. */
export function cancelAgentExchange(conversation: string): void {
  starting.get(conversation)?.();
  const session = sessions.get(conversation) ?? retired.get(conversation);
  if (!session) return;
  session.refuse?.();
  session.connection.notify("session/cancel", { sessionId: session.sessionId });
  // The exchange Stop was for: a new one sent meanwhile is left alone.
  const stopping = session.events;
  setTimeout(() => {
    const now = sessions.get(conversation) ?? retired.get(conversation);
    if (now !== session || !session.events || session.events !== stopping)
      return;
    session.stopped = true;
    endAgentSession(conversation);
  }, STOP_GRACE_MS);
}

async function start(
  agent: ExternalAgent,
  conversation: string,
  cwd: string,
): Promise<Session> {
  let handle: Promise<number> | null = null;
  const session = {
    agent: agent.key,
    cwd,
    events: null,
    refuse: null,
    sessionId: "",
    steps: new Map(),
    edits: new Map(),
  } as unknown as Session;
  session.connection = new AcpConnection(
    {
      send: async (line) => agentsIpc.send(await handle!, line),
      // A start that failed has nothing to stop.
      stop: () =>
        void handle?.then(
          (h) => agentsIpc.stop(h),
          () => {},
        ),
    },
    {
      update: ({ update }) => deliver(session, update),
      requestPermission: (p) =>
        allowedUnasked(session.agent, p.options) ??
        ask(
          session,
          stepFacts(session.steps.get(p.toolCall.toolCallId), p.toolCall),
          p.options,
        ),
      readTextFile: (p) => readForAgent(session.cwd, p),
      writeTextFile: (p) => writeForAgent(session.cwd, p),
    },
  );
  handle = agentsIpc.start(agent.plugin, agent.id, cwd, (out) => {
    if (out.type === "lines")
      for (const line of out.lines) session.connection.receive(line);
    else {
      session.connection.close(new Error(stoppedText(agent, out.stderr)));
      if (sessions.get(conversation) === session) {
        sessions.delete(conversation);
        sessionsChanged();
      }
    }
  });
  try {
    await handle;
    const init = await session.connection.request<{
      authMethods?: { id: string; type?: string }[];
      agentCapabilities?: { promptCapabilities?: { image?: boolean } };
    }>("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: { name: "Textus", version: await appVersion() },
    });
    session.images = !!init?.agentCapabilities?.promptCapabilities?.image;
    const open = () =>
      session.connection.request<Opened>("session/new", {
        cwd,
        mcpServers: [],
      });
    let opened: Opened;
    try {
      opened = await open();
    } catch (err) {
      // A sign-in the agent runs itself (a browser opens), the one its
      // plugin names if it does; one it wants run in a terminal is the
      // user's, as its setup says.
      const own = init?.authMethods?.find((m) =>
        agent.signIn === undefined
          ? !m.type || m.type === "agent"
          : m.id === agent.signIn,
      );
      if (!(err instanceof AcpError && err.code === AUTH_REQUIRED && own))
        throw err;
      await session.connection.request("authenticate", { methodId: own.id });
      opened = await open();
    }
    session.sessionId = opened.sessionId;
    // The mode that asks first, unless the user chose one that doesn't,
    // whatever the agent's own settings say.
    const { raw, older } = optionsOf(opened);
    session.older = older;
    await applyChoices(agent.key, raw, (configId, value) =>
      setOption(session, configId, value),
    );
  } catch (err) {
    session.connection.stop();
    throw explain(agent, err, true);
  }
  return session;
}

function deliver(session: Session, update: SessionUpdate) {
  // What the agent offers comes between exchanges too.
  const u = update as Record<string, unknown>;
  if (u.sessionUpdate === "available_commands_update")
    return heardCommands(session.agent, u.availableCommands);
  if (u.sessionUpdate === "config_option_update")
    return void heardOptions(session.agent, u.configOptions);
  if (u.sessionUpdate === "current_mode_update")
    return heardValue(
      session.agent,
      modeOption(offerOf(session.agent).options)?.id ?? "mode",
      String(u.currentModeId ?? ""),
    );
  if (
    u.sessionUpdate === "tool_call" ||
    u.sessionUpdate === "tool_call_update"
  ) {
    const fields = update as ToolCallFields;
    const id = fields.toolCallId;
    const step = stepFacts(session.steps.get(id), fields);
    session.steps.set(id, step);
    followEdit(session.edits, session.cwd, { ...fields, kind: step.kind });
  }
  const events = session.events;
  if (!events) return;
  const thought = thoughtOf(update);
  if (thought !== null) events.thinking(thought);
  else current.set(session, applyUpdate(current.get(session)!, update));
  if (thought === null) events.view(current.get(session)!);
}

/** Each running exchange's view, by session. */
const current = new WeakMap<Session, AgentView>();

function ask(
  session: Session,
  step: StepFacts,
  options: PermissionOption[],
): Promise<PermissionOutcome> {
  const events = session.events;
  if (!events) return Promise.resolve({ outcome: { outcome: "cancelled" } });
  return new Promise((resolve) => {
    const choose = (optionId: string | null) => {
      session.refuse = null;
      events.permission(null);
      resolve({
        outcome: optionId
          ? { outcome: "selected", optionId }
          : { outcome: "cancelled" },
      });
    };
    session.refuse = () => choose(null);
    events.permission({
      title: step.title ?? "",
      kind: step.kind,
      detail: step.detail,
      options,
      choose,
    });
  });
}

/** Sends `message` to `agent` in `conversation`'s session (starting it in
 *  `cwd` first), and resolves with the exchange's turns, the user's first. */
export async function runAgentExchange(o: {
  agent: ExternalAgent;
  conversation: string;
  cwd: string;
  docPath: string | null;
  message: string;
  /** Pictures attached to the message; sent only to an agent that reads
   *  them. */
  images?: ImageAttachment[];
  events: ExchangeEvents;
}): Promise<AgentTurn[]> {
  let session = sessions.get(o.conversation);
  if (session && (session.agent !== o.agent.key || session.cwd !== o.cwd)) {
    endAgentSession(o.conversation);
    session = undefined;
  }
  if (!session) {
    // Stop, Textus AI turned off or the tab closed while it starts: the
    // exchange ends now, and the agent once it is up.
    let giveUp = () => {};
    const gaveUp = new Promise<never>((_, reject) => {
      giveUp = () => reject(new IpcError("agent", AI_CANCELLED));
    });
    starting.set(o.conversation, giveUp);
    const made = start(o.agent, o.conversation, o.cwd);
    try {
      session = await Promise.race([made, gaveUp]);
    } catch (err) {
      void made.then(
        (late) => late.connection.stop(),
        () => undefined,
      );
      throw err;
    } finally {
      starting.delete(o.conversation);
    }
    sessions.set(o.conversation, session);
    sessionsChanged();
    followChoices();
    // Chosen while it started: set now.
    void sendWanted(o.agent.key);
  }
  const images = o.images ?? [];
  // Refused rather than dropped, as for a model: it would answer about a
  // picture it never saw.
  if (images.length && !session.images)
    throw new Error(
      fill(currentStrings().agentNoImages, { agent: o.agent.name }),
    );
  const user: AgentTurn = {
    kind: "User",
    text: o.message,
    ...(images.length ? { images } : {}),
  };
  current.set(session, { turns: [user], text: "" });
  session.events = o.events;
  const prompt = promptBlocks({
    message: o.message,
    docPath: o.docPath,
    images,
  });
  try {
    await session.connection.request("session/prompt", {
      sessionId: session.sessionId,
      prompt,
    });
    return finish(current.get(session)!);
  } catch (err) {
    if (session.stopped) throw new IpcError("agent", AI_CANCELLED);
    throw explain(o.agent, err);
  } finally {
    session.events = null;
    // Steps a stopped turn never finished keep no copies of their files.
    session.edits.clear();
    session.steps.clear();
    o.events.permission(null);
    if (session.retired) {
      session.connection.stop();
      for (const [conversation, s] of [...retired])
        if (s === session) retired.delete(conversation);
    }
  }
}
