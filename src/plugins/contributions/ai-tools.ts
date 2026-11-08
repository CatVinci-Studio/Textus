import type * as Generated from "../../platform/bindings/plugins";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { listenToThisWindow } from "../../platform/events";
import {
  pluginsSnapshot,
  pluginText,
  subscribePlugins,
} from "../store/plugin-records";
import { appVersion } from "../../platform/app-info";

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
export function offered() {
  const { allOn, records } = pluginsSnapshot();
  if (!allOn) return [];
  return records.flatMap((r) =>
    r.status === "on" && r.manifest && r.granted.includes("ai.tools")
      ? r.manifest.contributes.aiTools.map((tool) => ({
          plugin: r.id,
          name: tool.name,
          // A `%key%` description is the plugin's translation of it.
          description: pluginText(r, tool.description),
          parameters: tool.parameters as Generated.Value,
        }))
      : [],
  );
}

/** The app's own tools that run in the window, called as a plugin's are
 *  (Rust's create tools): by name. */
const APP_TOOLS_OWNER = "textus";
async function appTool(name: string, args: unknown): Promise<string> {
  if (name === "check_plugin") {
    const [{ checkWrittenPlugin }, version] = await Promise.all([
      import("../store/check-written-plugin"),
      appVersion(),
    ]);
    return checkWrittenPlugin(
      (args as { files?: unknown } | null)?.files,
      version,
    );
  }
  throw new Error(`No tool ${name}.`);
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
      const answer =
        plugin === APP_TOOLS_OWNER
          ? appTool(name, event.payload.arguments)
          : run(plugin, name, event.payload.arguments);
      void answer.then(
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
