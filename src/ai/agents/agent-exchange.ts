import { fill } from "../../i18n/fill";
import { filesChanged } from "../chat/file-changes";
import { isInside } from "../../utils/path";
import { IpcError } from "../../platform/ipc-call";
import { AI_CANCELLED } from "../../platform/ipc-ai-types";
import { agentsIpc } from "../../platform/ipc-plugins";
import { fs } from "../../platform/ipc-files";
import { appVersion } from "../../platform/app-info";
import { currentStrings } from "../../i18n/current";
import { getWindowAccess } from "../../plugins/app-bridge";
import { openDocumentAt } from "../../registry/open-documents";
import type { ExternalAgent } from "../../plugins/contributions/agents";
import type { AgentTurn } from "../types";
import {
  AcpConnection,
  AcpError,
  AUTH_REQUIRED,
  CLIENT_CAPABILITIES,
  PROTOCOL_VERSION,
  type ContentBlock,
  type PermissionOption,
  type PermissionOutcome,
  type SessionUpdate,
} from "./acp-client";
import { applyUpdate, finish, thoughtOf, type AgentView } from "./agent-view";
import {
  applyChoices,
  choicesToSend,
  heardCommands,
  heardOptions,
  heardValue,
  offerOf,
} from "./agent-offers";
import { modeOption } from "./agent-mode";
import { loadSettings, subscribeRemote } from "../../prefs/settings-store";

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
}

const sessions = new Map<string, Session>();
/** Sessions out of use whose reply still runs, by conversation: Stop and
 *  closing the chat still reach them. */
const retired = new Map<string, Session>();
const sessionListeners = new Set<() => void>();
const sessionsChanged = () => sessionListeners.forEach((fn) => fn());

/** Hears sessions start and end in this window. */
export function subscribeSessions(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => sessionListeners.delete(listener);
}
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
 *  mode its menu no longer shows; the next message starts it afresh. */
async function setInSessions(agent: string, configId: string, value: string) {
  const isMode = configId === modeOption(offerOf(agent).options)?.id;
  const live = new Set(sessions.values());
  await Promise.all(
    [...live].map(async (session) => {
      if (session.agent !== agent || !session.sessionId) return;
      try {
        const answer = await session.connection.request<{
          configOptions?: unknown;
        } | null>("session/set_config_option", {
          sessionId: session.sessionId,
          configId,
          value,
        });
        if (answer?.configOptions) heardOptions(agent, answer.configOptions);
        else heardValue(agent, configId, value);
      } catch {
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
  setTimeout(() => {
    const now = sessions.get(conversation) ?? retired.get(conversation);
    if (now !== session || !session.events) return;
    session.stopped = true;
    endAgentSession(conversation);
  }, STOP_GRACE_MS);
}

/** What an agent reads or writes through Textus stays in its session's
 *  folder and out of hidden folders, as Textus AI's own tools do. */
function withinFolder(folder: string, path: string): void {
  const rest = isInside(path, folder) ? path.slice(folder.length) : null;
  const parts = rest?.split(/[\\/]/).filter(Boolean) ?? [];
  if (!rest || parts.some((part) => part.startsWith(".")))
    throw new Error(`${path} is outside the folder this session works in.`);
}

/** `content` from line `line` (1-based), at most `limit` lines. */
function lines(content: string, line?: number | null, limit?: number | null) {
  if (!line && !limit) return content;
  const all = content.split("\n");
  const from = Math.max(0, (line ?? 1) - 1);
  return all.slice(from, limit ? from + limit : undefined).join("\n");
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
        ask(session, p.toolCall.title ?? "", p.toolCall.kind, p.options),
      // An open document as the editor has it, typed or not.
      readTextFile: async ({ path, line, limit }) => {
        withinFolder(session.cwd, path);
        const doc = openDocumentAt(path);
        const content = doc ? doc.text() : await fs.readTextFile(path);
        return { content: lines(content, line, limit) };
      },
      // An open document is changed in its editor, one undo step, and
      // saved: read again from disk, it would start over and lose the
      // conversation beside it. Either way the file is marked as Textus
      // AI's own changes are, each place in it put back from the editor.
      writeTextFile: async ({ path, content }) => {
        withinFolder(session.cwd, path);
        const doc = openDocumentAt(path);
        if (doc) {
          const before = doc.text();
          if (!doc.replaceText(content, doc.revision()))
            throw new Error(`${path} changed while it was being written.`);
          await getWindowAccess()?.saveAt(path);
          filesChanged([{ file: path, applied: true, before }]);
          return null;
        }
        const before = await fs.readTextFile(path).catch(() => null);
        await fs.writeTextFile(path, content);
        filesChanged([{ file: path, applied: true, before }]);
        return null;
      },
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
    }>("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: CLIENT_CAPABILITIES,
      clientInfo: { name: "Textus", version: await appVersion() },
    });
    const open = () =>
      session.connection.request<{
        sessionId: string;
        configOptions?: unknown;
      }>("session/new", { cwd, mcpServers: [] });
    let opened: { sessionId: string; configOptions?: unknown };
    try {
      opened = await open();
    } catch (err) {
      // A sign-in the agent runs itself (a browser opens); one it wants
      // run in a terminal is the user's, as its setup says.
      const own = init?.authMethods?.find((m) => !m.type || m.type === "agent");
      if (!(err instanceof AcpError && err.code === AUTH_REQUIRED && own))
        throw err;
      await session.connection.request("authenticate", { methodId: own.id });
      opened = await open();
    }
    session.sessionId = opened.sessionId;
    // What the user chose for this agent; a change asks first unless
    // they chose a mode that doesn't, whatever the agent's own settings say.
    await applyChoices(agent.key, opened.configOptions, (configId, value) =>
      session.connection.request("session/set_config_option", {
        sessionId: opened.sessionId,
        configId,
        value,
      }),
    );
  } catch (err) {
    session.connection.stop();
    throw explain(agent, err);
  }
  return session;
}

function stoppedText(agent: ExternalAgent, stderr: string): string {
  const tail = stderr.trim().split("\n").slice(-4).join("\n");
  return [
    fill(currentStrings().agentStopped, { agent: agent.name }),
    tail,
    agent.setup,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** An error as the user can act on it: sign in, or install. */
function explain(agent: ExternalAgent, err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof AcpError && err.code === AUTH_REQUIRED)
    return new Error(
      [fill(currentStrings().agentSignIn, { agent: agent.name }), agent.setup]
        .filter(Boolean)
        .join("\n\n"),
    );
  return new Error(
    agent.setup && !message.includes(agent.setup)
      ? `${message}\n\n${agent.setup}`
      : message,
  );
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
  title: string,
  kind: string | undefined,
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
    events.permission({ title, kind, options, choose });
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
  const user: AgentTurn = { kind: "User", text: o.message };
  current.set(session, { turns: [user], text: "" });
  session.events = o.events;
  const prompt: ContentBlock[] = [{ type: "text", text: o.message }];
  if (o.docPath)
    prompt.push({
      type: "resource_link",
      uri: fileUri(o.docPath),
      name: o.docPath.split(/[\\/]/).pop() ?? o.docPath,
      mimeType: "text/markdown",
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
    o.events.permission(null);
    if (session.retired) {
      session.connection.stop();
      for (const [conversation, s] of [...retired])
        if (s === session) retired.delete(conversation);
    }
  }
}

/** `path` as a file: URI, its spaces and the rest encoded; a Windows
 *  drive's path as file:///C:/… */
export function fileUri(path: string): string {
  const slashed = path.replace(/\\/g, "/");
  const encoded = (slashed.startsWith("/") ? slashed : "/" + slashed)
    .split("/")
    .map(encodeURIComponent)
    .join("/")
    .replace(/^\/([A-Za-z])%3A/, "/$1:");
  return "file://" + encoded;
}
