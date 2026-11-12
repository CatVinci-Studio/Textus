import { PathText } from "../../engine/controls/PathText";
import { CatalogRow } from "../pages/CatalogRow";
import { Tooltip } from "../../engine/controls/Tooltip";
import { Segmented } from "../../engine/controls/Segmented";
import { counted } from "../../i18n/current";
import { fill } from "../../i18n/fill";
import { useEffect, useState, type ReactNode } from "react";
import type { Strings } from "../../i18n/strings";
import {
  mcp,
  type McpServerStatus,
  type McpToolInfo,
} from "../../platform/ipc";
import { showConfirm } from "../../engine/controls/app-dialog";
import { useSettings } from "../../prefs/SettingsContext";
import { ExtensionsTabLayout } from "../pages/ExtensionsTabLayout";
import { SettingsGroup } from "../pages/SettingsGroup";
import {
  formatPairs,
  joinCommandLine,
  parsePairs,
  splitCommandLine,
  type McpServer,
} from "../../prefs/mcp";
import { explainError } from "../../utils/error-explain";

/** Settings › Extensions › MCP: the servers Textus AI may use, each a card
 *  with its switch and state, and a form to add, change or try one. The
 *  servers run in Rust; this asks for their state. */
export function McpSection({
  t,
  after,
}: {
  t: Strings;
  /** Shown under the list, not while a server is being edited. */
  after?: ReactNode;
}) {
  const { settings, setSettings } = useSettings();
  const servers = settings.mcpServers;
  const [status, setStatus] = useState<McpServerStatus[]>([]);
  const [editing, setEditing] = useState<McpServer | null>(null);

  // Polled again while any is starting or not listed yet, since just-saved
  // settings are still on their way to the backend.
  const enabled = servers.filter((s) => s.enabled);
  const enabledKey = enabled.map((s) => JSON.stringify(s)).join();
  const enabledIds = enabled.map((s) => s.id).join("\n");
  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    let unlisted = 0;
    const ids = enabledIds ? enabledIds.split("\n") : [];
    const poll = () =>
      mcp
        .status()
        .then((list) => {
          if (stopped) return;
          const missing = ids.filter((id) => !list.some((s) => s.id === id));
          if (missing.length) unlisted++;
          const gaveUp = missing.length > 0 && unlisted >= 10;
          // One that never shows up has failed, not still starting.
          setStatus(
            gaveUp ? [...list, ...failed(missing, t.errorTimeout)] : list,
          );
          if (
            list.some((s) => s.state === "starting") ||
            (missing.length && !gaveUp)
          )
            timer = window.setTimeout(poll, missing.length ? 300 : 1000);
        })
        .catch((err: unknown) => {
          if (!stopped) setStatus(failed(ids, explainError(err, t)));
        });
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabledKey, enabledIds, t]);

  const save = (server: McpServer) => {
    const rest = servers.filter((s) => s.id !== server.id);
    const at = servers.findIndex((s) => s.id === server.id);
    const next = [...rest];
    next.splice(at < 0 ? next.length : at, 0, server);
    setSettings({ mcpServers: next });
    setEditing(null);
  };
  const remove = async (server: McpServer) => {
    const ok = await showConfirm(
      fill(t.mcpRemoveConfirm, { name: server.name }),
      { okLabel: t.mcpRemove, cancelLabel: t.cancel, danger: true },
    );
    if (ok)
      setSettings({ mcpServers: servers.filter((s) => s.id !== server.id) });
  };

  if (editing)
    return (
      <McpForm
        t={t}
        server={editing}
        isNew={!servers.some((s) => s.id === editing.id)}
        onSave={save}
        onCancel={() => setEditing(null)}
      />
    );

  return (
    <ExtensionsTabLayout
      t={t}
      intro={t.extensionsIntroMcp}
      help={t.mcpHelp}
      primary={{ label: t.mcpAdd, onSelect: () => setEditing(blankServer()) }}
      installedTitle={t.mcpServersGroup}
      installed={
        servers.length ? (
          servers.map((server) => (
            <ServerCard
              key={server.id}
              t={t}
              server={server}
              status={status.find((s) => s.id === server.id)}
              onEnable={(on) => save({ ...server, enabled: on })}
              onEdit={() => setEditing(server)}
              onRemove={() => void remove(server)}
              onRestart={() =>
                void mcp
                  .restart(server.id)
                  .then(setStatus, (err: unknown) =>
                    setStatus((list) => [
                      ...list.filter((s) => s.id !== server.id),
                      ...failed([server.id], explainError(err, t)),
                    ]),
                  )
              }
            />
          ))
        ) : (
          <p className="tx-list-note">{t.mcpNone}</p>
        )
      }
      footer={after}
    />
  );
}

/** Servers whose state couldn't be had, shown as failed for a reason. */
function failed(ids: string[], error: string): McpServerStatus[] {
  return ids.map((id) => ({
    id,
    state: "failed",
    server: "",
    tools: [],
    error,
  }));
}

function blankServer(): McpServer {
  return {
    id: `mcp-${Date.now().toString(36)}`,
    name: "",
    enabled: true,
    command: "",
    args: [],
    env: {},
    url: "",
    headers: {},
  };
}

/** A server's state in a line. */
function stateText(
  t: Strings,
  server: McpServer,
  status: McpServerStatus | undefined,
): string {
  if (!server.enabled) return t.mcpStateOff;
  if (!status || status.state === "starting") return t.mcpStateStarting;
  if (status.state === "failed")
    return fill(t.mcpStateFailed, { reason: status.error ?? "" });
  return counted(t.mcpStateReady, status.tools.length);
}

function ServerCard({
  t,
  server,
  status,
  onEnable,
  onEdit,
  onRemove,
  onRestart,
}: {
  t: Strings;
  server: McpServer;
  status: McpServerStatus | undefined;
  onEnable: (on: boolean) => void;
  onEdit: () => void;
  onRemove: () => void;
  onRestart: () => void;
}) {
  const failed = server.enabled && status?.state === "failed";
  return (
    <CatalogRow
      className="mcp-card"
      data-mcp={server.id}
      name={server.name || server.id}
      description={
        <PathText
          path={server.url || joinCommandLine([server.command, ...server.args])}
        />
      }
      descriptionClass="mcp-endpoint"
      extra={
        <>
          <span
            className={`settings-row-hint mcp-state${failed ? " mcp-state-failed" : ""}`}
            role="status"
          >
            {stateText(t, server, status)}
          </span>
          {server.enabled && status?.state === "ready" && (
            <ToolList tools={status.tools} />
          )}
          <span className="mcp-actions">
            <button
              type="button"
              className="text-button settings-inline-button"
              onClick={onEdit}
            >
              {t.mcpEdit}
            </button>
            {server.enabled && (
              <button
                type="button"
                className="text-button settings-inline-button"
                onClick={onRestart}
              >
                {t.mcpRestart}
              </button>
            )}
            <button
              type="button"
              className="text-button settings-inline-button"
              onClick={onRemove}
            >
              {t.mcpRemove}
            </button>
          </span>
        </>
      }
      action={
        <>
          <input
            type="checkbox"
            aria-label={server.name || server.id}
            checked={server.enabled}
            onChange={(e) => onEnable(e.target.checked)}
          />
        </>
      }
    />
  );
}

function ToolList({ tools }: { tools: McpToolInfo[] }) {
  if (tools.length === 0) return null;
  return (
    <span className="mcp-tools" data-search-ignore>
      {tools.map((tool) => (
        <Tooltip key={tool.name} text={tool.description || tool.name}>
          <span className="tx-badge mcp-tool">{tool.name}</span>
        </Tooltip>
      ))}
    </span>
  );
}

/** Try: start a server as the form has it and list its tools, or say why
 *  it didn't start. */
function useMcpTry(t: Strings) {
  const [tried, setTried] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trying, setTrying] = useState(false);
  const tryServer = async (server: McpServer) => {
    setTrying(true);
    setTried(null);
    setError(null);
    try {
      const result = await mcp.try(server);
      setTried(
        fill(counted(t.mcpTried, result.tools.length), {
          server: result.server,
          names: result.tools.map((x) => x.name).join(", "),
        }),
      );
    } catch (err) {
      setError(explainError(err, t));
    } finally {
      setTrying(false);
    }
  };
  return { tried, error, trying, tryServer };
}

function McpForm({
  t,
  server,
  isNew,
  onSave,
  onCancel,
}: {
  t: Strings;
  server: McpServer;
  isNew: boolean;
  onSave: (server: McpServer) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(server.name);
  const [kind, setKind] = useState<"command" | "url">(
    server.url ? "url" : "command",
  );
  const [commandLine, setCommandLine] = useState(
    server.command ? joinCommandLine([server.command, ...server.args]) : "",
  );
  const [env, setEnv] = useState(formatPairs(server.env));
  const [url, setUrl] = useState(server.url);
  const [headers, setHeaders] = useState(formatPairs(server.headers, ": "));
  const { tried, error, trying, tryServer } = useMcpTry(t);

  const built = (): McpServer => {
    const [command = "", ...args] =
      kind === "command" ? splitCommandLine(commandLine) : [];
    return {
      ...server,
      name: name.trim() || command || url,
      command,
      args,
      env: kind === "command" ? parsePairs(env) : {},
      url: kind === "url" ? url.trim() : "",
      headers: kind === "url" ? parsePairs(headers, ":") : {},
    };
  };
  const ready = kind === "command" ? !!commandLine.trim() : !!url.trim();

  return (
    <SettingsGroup title={isNew ? t.mcpAddTitle : t.mcpEditTitle}>
      <div className="mcp-form">
        <label className="settings-field-label">
          {t.mcpFormName}
          <input
            aria-label={t.mcpFormName}
            className="settings-text-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <Segmented
          className="settings-segmented"
          label={t.mcpFormKind}
          options={[
            { id: "command", label: t.mcpFormKindCommand },
            { id: "url", label: t.mcpFormKindUrl },
          ]}
          value={kind}
          onChange={setKind}
        />
        {kind === "command" ? (
          <>
            <label className="settings-field-label">
              {t.mcpFormCommand}
              <input
                aria-label={t.mcpFormCommand}
                className="settings-text-input mcp-mono"
                value={commandLine}
                spellCheck={false}
                autoCapitalize="off"
                placeholder="npx -y @upstash/context7-mcp"
                onChange={(e) => setCommandLine(e.target.value)}
              />
              <span className="settings-row-hint">{t.mcpFormCommandHint}</span>
            </label>
            <label className="settings-field-label">
              {t.mcpFormEnv}
              <textarea
                aria-label={t.mcpFormEnv}
                className="settings-text-input mcp-mono"
                rows={3}
                value={env}
                spellCheck={false}
                placeholder="API_KEY=…"
                onChange={(e) => setEnv(e.target.value)}
              />
              <span className="settings-row-hint">{t.mcpFormEnvHint}</span>
            </label>
          </>
        ) : (
          <>
            <label className="settings-field-label">
              {t.mcpFormUrl}
              <input
                aria-label={t.mcpFormUrl}
                className="settings-text-input mcp-mono"
                value={url}
                spellCheck={false}
                autoCapitalize="off"
                placeholder="https://example.com/mcp"
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="settings-field-label">
              {t.mcpFormHeaders}
              <textarea
                aria-label={t.mcpFormHeaders}
                className="settings-text-input mcp-mono"
                rows={3}
                value={headers}
                spellCheck={false}
                placeholder="Authorization: Bearer …"
                onChange={(e) => setHeaders(e.target.value)}
              />
              <span className="settings-row-hint">{t.mcpFormHeadersHint}</span>
            </label>
          </>
        )}
        {tried && (
          <p className="settings-row-hint mcp-tried" role="status">
            {tried}
          </p>
        )}
        {error && (
          <div className="settings-error" role="alert">
            {error}
          </div>
        )}
        <div className="mcp-form-actions">
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={!ready || trying}
            onClick={() => void tryServer(built())}
          >
            {trying ? t.mcpFormTrying : t.mcpFormTry}
          </button>
          <span className="mcp-form-spacer" />
          <button
            type="button"
            className="text-button settings-inline-button"
            onClick={onCancel}
          >
            {t.cancel}
          </button>
          <button
            type="button"
            className="text-button settings-inline-button"
            disabled={!ready}
            onClick={() => onSave(built())}
          >
            {t.mcpFormSave}
          </button>
        </div>
      </div>
    </SettingsGroup>
  );
}
