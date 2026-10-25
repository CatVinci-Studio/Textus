import { useEffect, useState } from "react";
import type { Strings } from "../../i18n/strings";
import {
  links,
  mcp,
  type McpServerStatus,
  type McpToolInfo,
} from "../../platform/ipc";
import { showConfirm } from "../../ui/app-dialog";
import { errorText } from "../../utils/error-text";
import { useSettings } from "../SettingsContext";
import { ExtensionsTabLayout } from "../pages/ExtensionsTabLayout";
import { SettingsGroup } from "../pages/SettingsGroup";
import {
  MCP_PRESETS,
  formatPairs,
  joinCommandLine,
  parsePairs,
  presetDescription,
  splitCommandLine,
  type McpPreset,
  type McpServer,
} from "../mcp";

/**
 * Settings › Extensions › MCP: the servers Textus AI may use, each a card
 * with its switch and how it is doing (starting, its tools, or why it
 * failed), and a form to add or change one, which can try it first ("⋯"
 * adds one by hand). The servers most people add are in Get more
 * (MarketMcp), which comes back here with one to fill in (`adding`). The
 * servers themselves run in the Rust side (src-tauri mcp/), which this
 * asks for their state.
 */
export function McpSection({
  t,
  onGetMore,
  adding = null,
}: {
  t: Strings;
  onGetMore: () => void;
  adding?: McpServer | null;
}) {
  const { settings, setSettings } = useSettings();
  const servers = settings.mcpServers;
  const [status, setStatus] = useState<McpServerStatus[]>([]);
  const [editing, setEditing] = useState<McpServer | null>(adding);

  // The state of the servers that are on - again while any is starting,
  // or isn't listed yet (the settings it was just saved in are on their
  // way to the backend).
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
          setStatus(list);
          const missing = ids.some((id) => !list.some((s) => s.id === id));
          if (missing) unlisted++;
          if (
            list.some((s) => s.state === "starting") ||
            (missing && unlisted < 10)
          )
            timer = window.setTimeout(poll, missing ? 300 : 1000);
        })
        .catch(() => {});
    void poll();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [enabledKey, enabledIds]);

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
      t.mcpRemoveConfirm.replace("{name}", server.name),
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
      onGetMore={onGetMore}
      actions={[{ label: t.mcpAdd, onSelect: () => setEditing(blankServer()) }]}
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
                void mcp.restart(server.id).then(setStatus, () => {})
              }
            />
          ))
        ) : (
          <p className="plugin-empty">{t.mcpNone}</p>
        )
      }
    />
  );
}

/** Get more's MCP servers: the ones most people add and the user hasn't,
 *  as far as `query` lets; Add fills the form in with one. */
export function MarketMcp({
  t,
  query,
  onAdd,
}: {
  t: Strings;
  query: string;
  onAdd: (server: McpServer) => void;
}) {
  const { settings } = useSettings();
  const lang = settings.language;
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const offered = MCP_PRESETS.filter(
    (p) => !settings.mcpServers.some((s) => s.id === p.id),
  );
  const shown = offered.filter((p) => {
    const text = `${p.name}\n${presetDescription(p, lang)}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
  return (
    <div className="settings-group-body">
      {shown.length ? (
        shown.map((preset) => (
          <PresetCard
            key={preset.id}
            t={t}
            preset={preset}
            lang={lang}
            onAdd={() => onAdd(fromPreset(preset))}
          />
        ))
      ) : (
        <p className="plugin-empty">
          {offered.length
            ? t.pluginsSearchNone.replace("{query}", query.trim())
            : t.marketMcpAllAdded}
        </p>
      )}
    </div>
  );
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

function fromPreset(preset: McpPreset): McpServer {
  return {
    ...blankServer(),
    id: preset.id,
    name: preset.name,
    command: preset.command,
    args: preset.args,
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
    return t.mcpStateFailed.replace("{reason}", status.error ?? "");
  return t.mcpStateReady.replace("{count}", String(status.tools.length));
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
    <div className="settings-row plugin-card mcp-card" data-mcp={server.id}>
      <div className="plugin-card-open">
        <span className="settings-row-label plugin-card-name">
          {server.name || server.id}
        </span>
        <span className="settings-row-hint plugin-card-description mcp-endpoint">
          {server.url || joinCommandLine([server.command, ...server.args])}
        </span>
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
            className="settings-skill-action"
            onClick={onEdit}
          >
            {t.mcpEdit}
          </button>
          {server.enabled && (
            <button
              type="button"
              className="settings-skill-action"
              onClick={onRestart}
            >
              {t.mcpRestart}
            </button>
          )}
          <button
            type="button"
            className="settings-skill-action"
            onClick={onRemove}
          >
            {t.mcpRemove}
          </button>
        </span>
      </div>
      <div className="settings-row-control">
        <input
          type="checkbox"
          aria-label={server.name || server.id}
          checked={server.enabled}
          onChange={(e) => onEnable(e.target.checked)}
        />
      </div>
    </div>
  );
}

function ToolList({ tools }: { tools: McpToolInfo[] }) {
  if (tools.length === 0) return null;
  return (
    <span className="mcp-tools" data-search-ignore>
      {tools.map((tool) => (
        <span key={tool.name} className="mcp-tool" title={tool.description}>
          {tool.name}
        </span>
      ))}
    </span>
  );
}

function PresetCard({
  t,
  preset,
  lang,
  onAdd,
}: {
  t: Strings;
  preset: McpPreset;
  lang: string;
  onAdd: () => void;
}) {
  return (
    <div className="settings-row plugin-card" data-mcp-preset={preset.id}>
      <div className="plugin-card-open">
        <span className="settings-row-label plugin-card-name">
          {preset.name}
        </span>
        <span className="settings-row-hint plugin-card-description">
          {presetDescription(preset, lang)}
        </span>
        <button
          type="button"
          className="plugin-byline mcp-homepage"
          onClick={() => void links.openWebLink(preset.homepage)}
        >
          {joinCommandLine([preset.command, ...preset.args])}
        </button>
      </div>
      <div className="settings-row-control">
        <button type="button" className="plugin-install" onClick={onAdd}>
          {t.mcpPresetAdd}
        </button>
      </div>
    </div>
  );
}

/** Adding or changing a server: by a command or a URL, tried before it is
 *  saved if the user wants. */
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
        t.mcpTried
          .replace("{server}", result.server)
          .replace("{count}", String(result.tools.length))
          .replace("{names}", result.tools.map((x) => x.name).join(", ")),
      );
    } catch (err) {
      setError(errorText(err));
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
  const preset = MCP_PRESETS.find((p) => p.id === server.id);
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
            placeholder={preset?.name ?? ""}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <div className="auth-tabs" role="tablist" aria-label={t.mcpFormKind}>
          {(["command", "url"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={`auth-tab${kind === k ? " auth-tab-active" : ""}`}
              onClick={() => setKind(k)}
            >
              {k === "command" ? t.mcpFormKindCommand : t.mcpFormKindUrl}
            </button>
          ))}
        </div>
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
            className="plugin-install"
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
