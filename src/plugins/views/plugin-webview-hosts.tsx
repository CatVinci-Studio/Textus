import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { disposeWebview, resolveWebview } from "../manager";
import type { CodeBlockSeen } from "../manager";
import {
  PLUGIN_MISSING,
  PLUGIN_OFF,
  pluginMayRun,
  pluginRecord,
  pluginsSnapshot,
  subscribePlugins,
} from "../store/plugin-records";
import { PluginProblem } from "./PluginProblem";
import { PluginWebview } from "./PluginWebview";
import {
  createWebview,
  type WebviewKind,
  type WebviewRecord,
} from "./webviews";

// Where a plugin's page is shown: a panel, its settings, a tab. Each makes
// its webview as it mounts and closes it as it unmounts.

/** How long before asking again a plugin that hadn't set its page up. */
const RETRY_MS = 600;

/** A webview made when this mounts, given to the plugin to fill, and closed
 *  when this unmounts. */
export function useResolvedWebview(
  plugin: string,
  kind: WebviewKind,
  key: string,
  target: {
    view?: string;
    viewType?: string;
    state?: unknown;
    target?: unknown;
    codeBlock?: CodeBlockSeen;
  },
  resource?: string,
): {
  record: WebviewRecord | null;
  error: string | null;
  retry: () => void;
} {
  const [record, setRecord] = useState<WebviewRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { view, viewType } = target;
  // What the view was opened with counts only when it is made.
  const initialState = useRef(target.state);
  const initialTarget = useRef(target.target);
  const initialBlock = useRef(target.codeBlock);
  // Turned off, the page shows so; turned on again, it is made anew.
  // Before the plugins have loaded, it isn't known: tried as before.
  // Once they have, an uninstalled plugin's page is off too.
  const runs = useSyncExternalStore(
    subscribePlugins,
    () => !pluginsSnapshot().loaded || pluginMayRun(pluginRecord(plugin)),
  );
  useEffect(() => {
    if (!runs) {
      setRecord(null);
      setError(pluginRecord(plugin) ? PLUGIN_OFF : PLUGIN_MISSING);
      return;
    }
    const made = createWebview(plugin, kind, key, resource);
    // An answer for a page already let go (remounted, moved) is not this
    // one's: its "No webview" must not cover the page that replaced it.
    let current = true;
    setRecord(made);
    setError(null);
    resolveWebview(made, {
      view,
      viewType,
      state: initialState.current,
      target: initialTarget.current,
      codeBlock: initialBlock.current,
    }).catch((err) => {
      if (!current) return;
      const message = String((err as Error)?.message ?? err);
      // Asked before the plugin had set its page up: once more, quietly.
      if (attempt === 0 && /No webview provider/.test(message))
        window.setTimeout(() => setAttempt(1), RETRY_MS);
      else setError(message);
    });
    return () => {
      current = false;
      disposeWebview(made.id);
    };
  }, [plugin, kind, key, view, viewType, resource, attempt, runs]);
  return { record, error, retry: () => setAttempt((n) => n + 1) };
}

function WebviewOrProblem({
  record,
  error,
  retry,
  className,
}: {
  record: WebviewRecord | null;
  error: string | null;
  retry?: () => void;
  className?: string;
}) {
  if (error) return <PluginProblem error={error} retry={retry} />;
  if (!record) return null;
  return <PluginWebview id={record.id} className={className} />;
}

/** A sidebar tab's panel, a view in a tab of its own, or a floating view. */
export function PluginWebviewPanel({
  plugin,
  view,
  kind,
}: {
  plugin: string;
  view: string;
  kind: "sidebar" | "view" | "floating";
}) {
  const { record, error, retry } = useResolvedWebview(
    plugin,
    kind,
    `${plugin}:${view}`,
    { view },
  );
  return (
    <WebviewOrProblem
      record={record}
      error={error}
      retry={retry}
      className="plugin-webview-panel"
    />
  );
}

/** A plugin's own settings page, under its settings. */
export function PluginSettingsWebview({ plugin }: { plugin: string }) {
  const { record, error } = useResolvedWebview(
    plugin,
    "settings",
    `${plugin}:settings`,
    {},
  );
  if (error) return <PluginProblem error={error} />;
  if (!record) return null;
  // As tall as the page: Settings scrolls, not a box inside it.
  return (
    <PluginWebview
      id={record.id}
      className="plugin-webview-settings"
      fitHeight={Infinity}
    />
  );
}

/** A tab showing a plugin's view or custom editor. */
export function PluginTabPane({
  tabId,
  plugin,
  view,
  kind,
  resource,
  state,
  target,
}: {
  tabId: string;
  plugin: string;
  view: string;
  kind: "view" | "editor";
  resource?: string;
  state?: unknown;
  target?: unknown;
}) {
  const { record, error, retry } = useResolvedWebview(
    plugin,
    kind,
    `tab:${tabId}`,
    kind === "editor" ? { viewType: view, target } : { view, state },
    resource,
  );
  return (
    <div className="plugin-tab-pane">
      <WebviewOrProblem
        record={record}
        error={error}
        retry={retry}
        className="plugin-webview-tab"
      />
    </div>
  );
}
