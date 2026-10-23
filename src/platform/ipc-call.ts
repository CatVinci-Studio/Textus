import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "./capabilities";
import { AI_OFF, aiRequestsAllowed } from "./ai-gate";
import { commands as aiCommands } from "./bindings/ai";
import { commands as aiAgentCommands } from "./bindings/ai-agent";
import { commands as aiConventionsCommands } from "./bindings/ai-conventions";
import { commands as aiMemoryCommands } from "./bindings/ai-memory";
import { commands as aiProjectCommands } from "./bindings/ai-project";
import { commands as appCommands } from "./bindings/app";
import { commands as authCommands } from "./bindings/auth";
import { commands as fileCommands } from "./bindings/files";
import { commands as pluginCommands } from "./bindings/plugins";

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

// The commands whose types are generated from Rust (src-tauri/src/bindings.rs).
const commands = {
  ...aiCommands,
  ...aiAgentCommands,
  ...aiConventionsCommands,
  ...aiMemoryCommands,
  ...aiProjectCommands,
  ...appCommands,
  ...authCommands,
  ...fileCommands,
  ...pluginCommands,
};
type Commands = typeof commands;
/** A backend command with generated types: its name, as Rust registers it. */
export type Command = keyof Commands;
type Args<K extends Command> = Parameters<Commands[K]>;
// A command answering `Result<(), _>` is generated as answering `null`,
// one answering `()` as `void`; both are nothing to the caller.
type Answer<K extends Command> = [Awaited<ReturnType<Commands[K]>>] extends [
  null,
]
  ? void
  : Awaited<ReturnType<Commands[K]>>;

/**
 * Calls a generated command: tsc checks its name, its arguments (in the
 * Rust function's order) and its answer against the Rust signature. The
 * commands not generated - those reading their inputs as one struct, the
 * agent message, raw bytes, iOS-only - still go through `call`.
 */
export async function command<K extends Command>(
  name: K,
  ...args: Args<K>
): Promise<Answer<K>> {
  const run = commands[name] as (...args: Args<K>) => Promise<Answer<K>>;
  try {
    return await run(...args);
  } catch (err) {
    throw new IpcError(name, err);
  }
}

/** `aiCall` for a generated command. */
export function aiCommand<K extends Command>(
  name: K,
  ...args: Args<K>
): Promise<Answer<K>> {
  return aiRequestsAllowed()
    ? command(name, ...args)
    : Promise.reject(new IpcError(name, AI_OFF));
}

/** `desktopQuery` for a generated command. */
export function desktopQueryCommand<K extends Command, F>(
  name: K,
  fallback: F,
  ...args: Args<K>
): Promise<Answer<K> | F> {
  return isDesktopApp ? command(name, ...args) : Promise.resolve(fallback);
}

/** `desktopAction` for a generated command. */
export function desktopActionCommand<K extends Command>(
  name: K,
  ...args: Args<K>
): Promise<Answer<K>> {
  return isDesktopApp
    ? command(name, ...args)
    : Promise.reject(
        new IpcError(name, new Error("not available on this platform")),
      );
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
