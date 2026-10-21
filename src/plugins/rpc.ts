/**
 * JSON-RPC 2.0 over a MessagePort - what the window (broker.ts), a
 * plugin's host and its webviews speak to each other.
 *
 * The frames get this same function as source text (frames.ts puts
 * `createEndpoint.toString()` into them), so it must stay self-contained:
 * nothing from outside its body, no imports, no helpers.
 */

export type Handlers = Record<string, (params: never) => unknown>;

export interface Endpoint {
  /** The other side's answer to `method`. */
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** A message that expects no answer. */
  notify(method: string, params?: unknown): void;
  /** Stops listening; every call still waiting is rejected. */
  close(): void;
}

interface Message {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Answers the requests `handlers` names on `port`; a call not answered
 *  within `timeoutMs` (0: no limit) is rejected. */
export function createEndpoint(
  port: MessagePort,
  handlers: Handlers,
  timeoutMs: number,
): Endpoint {
  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (err: Error) => void;
      timer?: ReturnType<typeof setTimeout>;
    }
  >();
  const send = (message: Message) => port.postMessage(message);
  const fail = (id: number, err: unknown) =>
    send({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: String(
          (err as { message?: string } | null)?.message ?? err ?? "Failed",
        ),
      },
    });
  port.onmessage = (event: MessageEvent<Message>) => {
    const m = event.data;
    if (!m || m.jsonrpc !== "2.0") return;
    if (m.method === undefined) {
      const waiting = m.id === undefined ? undefined : pending.get(m.id);
      if (!waiting || m.id === undefined) return;
      pending.delete(m.id);
      clearTimeout(waiting.timer);
      if (m.error) waiting.reject(new Error(m.error.message));
      else waiting.resolve(m.result);
      return;
    }
    const handler = Object.prototype.hasOwnProperty.call(handlers, m.method)
      ? (handlers[m.method] as (params: unknown) => unknown)
      : undefined;
    if (m.id === undefined) {
      try {
        handler?.(m.params);
      } catch (err) {
        setTimeout(() => {
          throw err;
        });
      }
      return;
    }
    const id = m.id;
    if (!handler) {
      fail(id, `No method ${m.method}`);
      return;
    }
    Promise.resolve()
      .then(() => handler(m.params))
      .then(
        (result) =>
          send({ jsonrpc: "2.0", id, result: result === undefined ? null : result }),
        (err) => fail(id, err),
      );
  };
  return {
    call<T>(method: string, params?: unknown) {
      return new Promise<T>((resolve, reject) => {
        const id = nextId++;
        const timer = timeoutMs
          ? setTimeout(() => {
              pending.delete(id);
              reject(new Error(`${method} took too long`));
            }, timeoutMs)
          : undefined;
        pending.set(id, {
          resolve: resolve as (value: unknown) => void,
          reject,
          timer,
        });
        send({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method: string, params?: unknown) {
      send({ jsonrpc: "2.0", method, params });
    },
    close() {
      for (const waiting of pending.values()) {
        clearTimeout(waiting.timer);
        waiting.reject(new Error("Closed"));
      }
      pending.clear();
      port.onmessage = null;
      port.close();
    },
  };
}
