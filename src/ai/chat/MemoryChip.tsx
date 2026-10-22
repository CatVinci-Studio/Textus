import { useState } from "react";
import { ai, type MemoryScope } from "../../platform/ipc";
import { useSettings } from "../../settings/SettingsContext";
import { errorText } from "../../utils/error-text";

/** What was remembered - `Remembering` in src-tauri/src/ai/memory.rs.
 *  `previous`: the file before an update or a forget, for Undo to put
 *  back; `forgot`: taken back, `text` being what it said. */
export interface RememberResult {
  remembered: string;
  scope: MemoryScope;
  created: boolean;
  text: string;
  previous: string | null;
  forgot: boolean;
}

/** What the memory pass (or, before 1.2.0-rc.6, the remember tool) kept; null when it
 *  didn't (a duplicate, a refusal - plain words for the model). */
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
 * where, with Undo (deletes a new memory, or puts back what an update
 * replaced) and, for a memory, a move to the other scope. What it does is
 * kept here for the session; after a reload the chip starts from the saved
 * tool result again, and the Memory tab covers the rest.
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
  return (
    <div className="agent-memory-chip" role="status">
      <span className="agent-memory-chip-text">
        {(result.forgot ? labels.memoryForgot : labels.memorySaved)
          .replace("{text}", result.text)
          .replace("{scope}", scopeLabel)}
      </span>
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
