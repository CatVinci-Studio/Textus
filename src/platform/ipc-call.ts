import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "./capabilities";
import { AI_OFF, aiRequestsAllowed } from "./ai-gate";

/**
 * How every backend command is called: errors as IpcError, AI commands
 * refused while AI is off, desktop-only commands answered on mobile
 * (ipc.ts).
 */

/** Wraps a rejected `invoke()` with the command name that failed, so a
 *  caught error can be logged/displayed without losing which call it was. */
export class IpcError extends Error {
  readonly command: string;
  readonly cause: unknown;
  constructor(command: string, cause: unknown) {
    super(
      `${command}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "IpcError";
    this.command = command;
    this.cause = cause;
  }
}

export async function call<T>(command: string, args?: object): Promise<T> {
  try {
    return await invoke<T>(
      command,
      args as Record<string, unknown> | undefined,
    );
  } catch (err) {
    throw new IpcError(command, err);
  }
}

/**
 * A command that sends something to an AI service - a completion, a
 * grammar check, a conversation, a model list. While Textus AI is off it
 * is refused here, before it reaches Rust (which refuses it too). Every
 * entry point already checks the switch (settings/textus-ai.ts); this is
 * the backstop that keeps a missed one from making a request.
 */
export function aiCall<T>(command: string, args?: object): Promise<T> {
  return aiRequestsAllowed()
    ? call<T>(command, args)
    : Promise.reject(new IpcError(command, AI_OFF));
}

/**
 * Commands that exist on desktop only - registered under `#[cfg(desktop)]`
 * in src-tauri/src/lib.rs, so on iOS there is nothing to call.
 *
 * Call sites already avoid these on iOS through src/platform/capabilities.ts;
 * this is the backstop that keeps a missed call site from reaching Rust.
 * `desktopQuery` answers with what the command would report when there is
 * nothing to report (no pending tab, no chat window, no windows) - safe for
 * reads and fire-and-forget bookkeeping. `desktopAction` rejects, for calls
 * whose caller needs to know nothing happened.
 */
export function desktopQuery<T>(
  command: string,
  fallback: T,
  args?: object,
): Promise<T> {
  return isDesktopApp ? call<T>(command, args) : Promise.resolve(fallback);
}

export function desktopAction<T>(command: string, args?: object): Promise<T> {
  return isDesktopApp
    ? call<T>(command, args)
    : Promise.reject(
        new IpcError(command, new Error("not available on this platform")),
      );
}

// ---------------------------------------------------------------------------
// fs (src-tauri/src/commands/fs.rs)
// ---------------------------------------------------------------------------
