import { showConfirm } from "../../engine/controls/app-dialog";
import { fill } from "../../i18n/fill";
import { hasTextusAi } from "../../platform/capabilities";
import { addInlineSource } from "../../ai/writing/inline-sources";
import { plugins as pluginsIpc } from "../../platform/ipc";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/** What Rust refuses a call with until the user answers. */
const NOT_ALLOWED = "plugin-ai-not-allowed";
const OVER_LIMIT = "plugin-ai-limit";

interface Message {
  role: "user" | "assistant";
  content: string;
}

/** A conversation as one prompt: the model is asked for the next turn. */
export function promptOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value) || !value.length)
    throw new Error("messages is a list of { role, content }.");
  const turns = value.map((m: Partial<Message>) => {
    if (
      (m?.role !== "user" && m?.role !== "assistant") ||
      typeof m.content !== "string"
    )
      throw new Error("messages is a list of { role, content }.");
    return m as Message;
  });
  if (turns.length === 1) return turns[0].content;
  return turns
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .concat("Assistant:")
    .join("\n\n");
}

/** A plugin's answer waits this long before the suggestion is dropped. */
const INLINE_WAIT_MS = 5000;

/** Each plugin's inline sources, by `<plugin id>#<its id>`. */
const inline = new Map<string, () => void>();

/** Takes away a stopped plugin's inline sources. */
export function stopPluginAi(plugin: string): void {
  for (const [key, remove] of inline)
    if (key.startsWith(`${plugin}#`)) {
      remove();
      inline.delete(key);
    }
}

/** `textus.ai.complete`, `textus.ai.stream` and `textus.ai.available`:
 *  the user's writing model, asked once per plugin and within its monthly
 *  tokens. */
export function aiModelHandlers(p: PluginScope) {
  const ask = async (more: boolean, limit: number) => {
    const t = p.t();
    const words = fill(more ? t.pluginAiLimit : t.pluginAiAsk, {
      plugin: p.name(),
      limit: limit.toLocaleString(),
    });
    const ok = await showConfirm(words, {
      title: p.name(),
      okLabel: t.pluginAiAllow,
      cancelLabel: t.cancel,
    });
    if (ok) await pluginsIpc.aiAllow(p.id, more);
    return ok;
  };
  /** `run` with the request's instructions and prompt, the user asked
   *  first where Rust refuses until they answer. */
  const gated = async (
    system: unknown,
    messages: unknown,
    run: (instructions: string, prompt: string) => Promise<string>,
  ): Promise<string> => {
    if (!hasTextusAi) throw new Error("Textus AI isn't available here.");
    const prompt = str(promptOf(messages), "messages");
    const instructions = optionalStr(system) ?? "";
    let refusal: string;
    try {
      return await run(instructions, prompt);
    } catch (error) {
      refusal = String(error);
      if (refusal !== NOT_ALLOWED && refusal !== OVER_LIMIT) throw error;
    }
    const { limit } = await pluginsIpc.aiStatus(p.id);
    if (!(await ask(refusal === OVER_LIMIT, limit)))
      throw new Error("The user didn't allow it.");
    return run(instructions, prompt);
  };
  return {
    "ai.registerInlineCompletion": ({ id, label }: Params) => {
      const own = str(id, "id");
      const key = `${p.id}#${own}`;
      inline.get(key)?.();
      inline.set(
        key,
        addInlineSource({
          key,
          plugin: p.id,
          label: optionalStr(label) ?? p.name(),
          provide: (request) =>
            Promise.race([
              p
                .request<unknown>("$inlineCompletion", { id: own, ...request })
                .then((text) => (typeof text === "string" ? text : null)),
              new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), INLINE_WAIT_MS),
              ),
            ]),
        }),
      );
    },
    "ai.unregisterInlineCompletion": ({ id }: Params) => {
      const key = `${p.id}#${str(id, "id")}`;
      inline.get(key)?.();
      inline.delete(key);
    },
    "ai.available": async () =>
      hasTextusAi && (await pluginsIpc.aiStatus(p.id)).on,
    "ai.complete": ({ system, messages, cancelId }: Params) =>
      gated(system, messages, (instructions, prompt) =>
        pluginsIpc.aiComplete(
          p.id,
          instructions,
          prompt,
          optionalStr(cancelId) ?? null,
        ),
      ),
    "ai.stream": ({ system, messages, stream, cancelId }: Params) => {
      const id = str(stream, "stream");
      return gated(system, messages, (instructions, prompt) =>
        pluginsIpc.aiStream(
          p.id,
          instructions,
          prompt,
          (text) => {
            void p.request("$aiStreamText", { stream: id, text });
          },
          optionalStr(cancelId) ?? null,
        ),
      );
    },
  };
}
