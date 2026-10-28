import { useState } from "react";
import { ai, type MemoryScope } from "../../platform/ipc";
import { useSettings } from "../../prefs/SettingsContext";
import { errorText } from "../../utils/error-text";
import { useAgentPanel } from "./panel/agent-panel";
import { focusMemory } from "./panel/memory-focus";

/** What was remembered. `previous`: the file before an update or a forget,
 *  for Undo to put back; `forgot`: taken back, `text` being what it said. */
export interface RememberResult {
  remembered: string;
  scope: MemoryScope;
  created: boolean;
  text: string;
  previous: string | null;
  /** A library entry's name (a fact). */
  name: string | null;
  forgot: boolean;
}

/** What the memory pass (or, in old chats, the remember tool) kept; null when
 *  it didn't (a duplicate, a refusal - plain words for the model). */
export function parseRememberResult(output: string): RememberResult | null {
  try {
    const parsed = JSON.parse(output);
    if (
      typeof parsed?.remembered !== "string" ||
      (parsed.scope !== "project" && parsed.scope !== "personal") ||
      typeof parsed.text !== "string"
    )
      return null;
    return {
      remembered: parsed.remembered,
      scope: parsed.scope,
      created: parsed.created === true,
      text: parsed.text,
      previous: typeof parsed.previous === "string" ? parsed.previous : null,
      name: typeof parsed.name === "string" ? parsed.name : null,
      forgot: parsed.forgot === true,
    };
  } catch {
    return null;
  }
}

export interface MemoryChipLabels {
  /** "Remembered: {text} ({scope})". */
  memorySaved: string;
  memoryScopeProject: string;
  memoryScopePersonal: string;
  memoryUndo: string;
  memoryMakePersonal: string;
  memoryMakeProject: string;
  memoryUndone: string;
  /** "Forgot: {text} ({scope})" - a memory taken back. */
  memoryForgot: string;
  /** Undo of a forget: it is remembered again. */
  memoryRestored: string;
  memoryActionFailed: string;
}

/**
 * A remember call under the reply that made it: what was remembered and
 * where, with Undo and, for a memory, a move to the other scope. Its state
 * lasts the session; after a reload it starts from the saved result.
 */
export function MemoryChip({
  result,
  docPath,
  labels,
}: {
  result: RememberResult;
  /** The document the conversation is in, whose project a project memory
   *  belongs to. */
  docPath: string | null;
  labels: MemoryChipLabels;
}) {
  const { settings } = useSettings();
  const panel = useAgentPanel();
  const workspaceRoot = settings.agentWorkspaceRoot || null;
  const [current, setCurrent] = useState({
    id: result.remembered,
    scope: result.scope,
  });
  const [state, setState] = useState<"saved" | "busy" | "undone" | "failed">(
    "saved",
  );
  // Facts are library entries, which only a project has; what was
  // forgotten has nowhere to move.
  const movable = current.id.split("/")[1] === "memory" && !result.forgot;

  async function act(work: () => Promise<void>) {
    setState("busy");
    try {
      await work();
    } catch (err) {
      // Already gone (deleted in the Memory tab): nothing left to undo.
      setState(errorText(err) === "GONE" ? "undone" : "failed");
    }
  }
  const undo = () =>
    act(async () => {
      await ai.memoryUndo(
        docPath,
        workspaceRoot,
        current.id,
        result.created ? null : result.previous,
      );
      setState("undone");
    });
  const move = () =>
    act(async () => {
      const scope = current.scope === "project" ? "personal" : "project";
      const id = await ai.memoryMove(docPath, workspaceRoot, current.id, scope);
      setCurrent({ id, scope });
      setState("saved");
    });

  if (state === "undone")
    return (
      <div className="agent-memory-chip agent-memory-chip-undone" role="status">
        {result.forgot ? labels.memoryRestored : labels.memoryUndone}
      </div>
    );
  const scopeLabel =
    current.scope === "project"
      ? labels.memoryScopeProject
      : labels.memoryScopePersonal;
  // A fact is its entry's body: the name says whom it is about.
  const what = result.name ? `${result.name} · ${result.text}` : result.text;
  // "Remembered: {text} ({scope})" in pieces, so a long memory is cut
  // short while where it is kept stays in view.
  const template = result.forgot ? labels.memoryForgot : labels.memorySaved;
  const [before, after = ""] = template.split("{text}");
  const scope = after.replace("{scope}", scopeLabel);
  const line = before + what + scope;
  return (
    <div
      className={`agent-memory-chip${result.forgot ? " is-forgot" : ""}`}
      role="status"
    >
      {/* The whole memory, in the Memory tab: cut short here. A memory
          taken back is no longer there to show. */}
      <button
        type="button"
        className="agent-memory-chip-line"
        title={line}
        disabled={result.forgot}
        onClick={() => {
          panel.setTab("memory");
          focusMemory(current.id);
        }}
      >
        <span className="agent-memory-chip-text">
          {before}
          {what}
        </span>
        <span className="agent-memory-chip-scope">{scope}</span>
      </button>
      <span className="agent-memory-chip-actions">
        <button type="button" disabled={state === "busy"} onClick={undo}>
          {labels.memoryUndo}
        </button>
        {movable && (
          <button type="button" disabled={state === "busy"} onClick={move}>
            {current.scope === "project"
              ? labels.memoryMakePersonal
              : labels.memoryMakeProject}
          </button>
        )}
      </span>
      {state === "failed" && (
        <span className="agent-memory-chip-error">
          {labels.memoryActionFailed}
        </span>
      )}
    </div>
  );
}
