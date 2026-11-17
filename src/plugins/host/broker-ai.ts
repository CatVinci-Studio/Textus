import { showConfirm } from "../../engine/controls/app-dialog";
import { fill } from "../../i18n/fill";
import { hasTextusAi } from "../../platform/capabilities";
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

/** `textus.ai.complete` and `textus.ai.available`: the user's writing
 *  model, asked once per plugin and within its monthly tokens. */
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
  return {
    "ai.available": async () =>
      hasTextusAi && (await pluginsIpc.aiStatus(p.id)).on,
    "ai.complete": async ({ system, messages }: Params) => {
      if (!hasTextusAi) throw new Error("Textus AI isn't available here.");
      const prompt = promptOf(messages);
      const instructions = optionalStr(system) ?? "";
      const run = () =>
        pluginsIpc.aiComplete(p.id, instructions, str(prompt, "messages"));
      try {
        return await run();
      } catch (error) {
        const refusal = String(error);
        if (refusal !== NOT_ALLOWED && refusal !== OVER_LIMIT) throw error;
        const { limit } = await pluginsIpc.aiStatus(p.id);
        if (!(await ask(refusal === OVER_LIMIT, limit)))
          throw new Error("The user didn't allow it.", { cause: error });
        return run();
      }
    },
  };
}
