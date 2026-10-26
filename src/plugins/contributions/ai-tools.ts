import type * as Generated from "../../platform/bindings/plugins";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { listenToThisWindow } from "../../utils/tauri-events";
import { pluginsSnapshot, subscribePlugins } from "../store/plugin-records";

/**
 * Tools plugins give Textus AI: the window tells Rust the tools of its on
 * plugins granted `ai.tools`, started or not; a call comes back as an event,
 * runs in the plugin and is answered.
 */

interface ToolCallEvent {
  callId: string;
  plugin: string;
  name: string;
  arguments: unknown;
}

/** The tools offered now, from the plugins' records. */
function offered() {
  const { allOn, records } = pluginsSnapshot();
  if (!allOn) return [];
  return records.flatMap((r) =>
    r.status === "on" && r.manifest && r.granted.includes("ai.tools")
      ? r.manifest.contributes.aiTools.map((tool) => ({
          plugin: r.id,
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters as Generated.Value,
        }))
      : [],
  );
}

/** Keeps Rust told and answers calls, until the returned function. `run`
 *  runs a plugin's tool. */
export function watchPluginAiTools(
  run: (plugin: string, name: string, args: unknown) => Promise<unknown>,
): () => void {
  let sent = "";
  const sync = () => {
    const tools = offered();
    const key = JSON.stringify(tools);
    if (key === sent) return;
    sent = key;
    void pluginsIpc.aiToolsSet(tools).catch(() => {});
  };
  sync();
  const stopPlugins = subscribePlugins(sync);
  const stopCalls = listenToThisWindow<ToolCallEvent>(
    "plugin-ai-tool-call",
    (event) => {
      const { callId, plugin, name } = event.payload;
      void run(plugin, name, event.payload.arguments).then(
        (out) =>
          pluginsIpc.aiToolResult(
            callId,
            typeof out === "string" ? out : JSON.stringify(out ?? null),
            null,
          ),
        (err) =>
          pluginsIpc.aiToolResult(
            callId,
            null,
            String((err as Error)?.message ?? err),
          ),
      );
    },
  );
  return () => {
    stopPlugins();
    void stopCalls.then((stop) => stop());
    void pluginsIpc.aiToolsSet([]).catch(() => {});
  };
}
