import { agentsIpc } from "../../platform/ipc-plugins";
import { fs } from "../../platform/ipc-files";
import { appVersion } from "../../platform/app-info";
import { currentStrings } from "../../i18n/current";
import { getWindowAccess, openDocumentAt } from "../../plugins/app-bridge";
import type { ExternalAgent } from "../../plugins/contributions/agents";
import { FILE_WRITTEN_EVENT } from "../../utils/events";
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

/**
 * One exchange with an external agent, in a session kept for the
 * conversation: the agent keeps its own context between messages, so each
 * prompt carries only the new message and the document it is about.
 */

/** A step the agent asks the user to allow, shown under the reply. */
export interface PendingPermission {
  title: string;
  options: PermissionOption[];
  /** The option chosen, or null to refuse. */
  choose(optionId: string | null): void;
}

export interface ExchangeEvents {
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
  /** Its stderr, kept for when it stops. */
  stopped: string | null;
  /** Refuses the permission being asked, if one is. */
  refuse: (() => void) | null;
}

const sessions = new Map<string, Session>();

/** Ends a conversation's agent, if it has one. */
export function endAgentSession(conversation: string): void {
  const session = sessions.get(conversation);
  sessions.delete(conversation);
  session?.connection.stop();
}

/** Stops the step the agent is on; what streamed so far stays. */
export function cancelAgentExchange(conversation: string): void {
  const session = sessions.get(conversation);
  if (!session) return;
  session.refuse?.();
  session.connection.notify("session/cancel", { sessionId: session.sessionId });
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
    stopped: null,
    refuse: null,
    sessionId: "",
  } as unknown as Session;
  session.connection = new AcpConnection(
    {
      send: async (line) => agentsIpc.send(await handle!, line),
      stop: () => void handle?.then((h) => agentsIpc.stop(h)),
    },
    {
      update: ({ update }) => deliver(session, update),
      requestPermission: (p) => ask(session, p.toolCall.title ?? "", p.options),
      // An open document as the editor has it, typed or not.
      readTextFile: async ({ path, line, limit }) => {
        const doc = openDocumentAt(path);
        const content = doc ? doc.text() : await fs.readTextFile(path);
        return { content: lines(content, line, limit) };
      },
      // An open document is changed in its editor, one undo step, and
      // saved: read again from disk, it would start over and lose the
      // conversation beside it.
      writeTextFile: async ({ path, content }) => {
        const doc = openDocumentAt(path);
        if (doc) {
          if (!doc.replaceText(content, doc.revision()))
            throw new Error(`${path} changed while it was being written.`);
          await getWindowAccess()?.saveAt(path);
          return null;
        }
        await fs.writeTextFile(path, content);
        window.dispatchEvent(
          new CustomEvent(FILE_WRITTEN_EVENT, { detail: path }),
        );
        return null;
      },
    },
  );
  handle = agentsIpc.start(agent.plugin, agent.id, cwd, (out) => {
    if (out.type === "line") session.connection.receive(out.text);
    else {
      session.stopped = out.stderr.trim();
      session.connection.close(new Error(stoppedText(agent, out.stderr)));
      if (sessions.get(conversation) === session) sessions.delete(conversation);
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
      session.connection.request<{ sessionId: string }>("session/new", {
        cwd,
        mcpServers: [],
      });
    let opened: { sessionId: string };
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
  } catch (err) {
    session.connection.stop();
    throw explain(agent, err);
  }
  return session;
}

function stoppedText(agent: ExternalAgent, stderr: string): string {
  const tail = stderr.trim().split("\n").slice(-4).join("\n");
  return [
    currentStrings().agentStopped.replace("{agent}", agent.name),
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
      [currentStrings().agentSignIn.replace("{agent}", agent.name), agent.setup]
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
    events.permission({ title, options, choose });
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
    session = await start(o.agent, o.conversation, o.cwd);
    sessions.set(o.conversation, session);
  }
  const user: AgentTurn = { kind: "User", text: o.message };
  current.set(session, { turns: [user], text: "" });
  session.events = o.events;
  const prompt: ContentBlock[] = [{ type: "text", text: o.message }];
  if (o.docPath)
    prompt.push({
      type: "resource_link",
      uri: `file://${o.docPath}`,
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
    throw explain(o.agent, err);
  } finally {
    session.events = null;
    o.events.permission(null);
  }
}

/** What streamed before a stop or a failure, landed. */
export function partialAgentTurns(conversation: string): AgentTurn[] {
  const session = sessions.get(conversation);
  const view = session && current.get(session);
  return view ? finish(view) : [];
}
