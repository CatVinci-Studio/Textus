import { invoke } from "@tauri-apps/api/core";
import { isDesktopApp } from "./capabilities";
import { AI_OFF, aiRequestsAllowed } from "./ai-gate";
import { commands as aiCommands } from "./bindings/ai";
import { commands as aiAgentCommands } from "./bindings/ai-agent";
import { commands as aiConventionsCommands } from "./bindings/ai-conventions";
import { commands as aiMemoryCommands } from "./bindings/ai-memory";
import { commands as aiProjectCommands } from "./bindings/ai-project";
import { commands as aiSkillsCommands } from "./bindings/ai-skills";
import { commands as appCommands } from "./bindings/app";
import { commands as authCommands } from "./bindings/auth";
import { commands as fileCommands } from "./bindings/files";
import { commands as pluginCommands } from "./bindings/plugins";
import { commands as pluginAccessCommands } from "./bindings/plugin-access";

/**
 * How every backend command is called: errors as IpcError, AI commands
 * refused while AI is off, desktop-only commands answered on mobile.
 */

/** A rejected `invoke()` with the name of the command that failed. */
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

// The commands whose types are generated from Rust.
const commands = {
  ...aiCommands,
  ...aiAgentCommands,
  ...aiConventionsCommands,
  ...aiMemoryCommands,
  ...aiProjectCommands,
  ...aiSkillsCommands,
  ...appCommands,
  ...authCommands,
  ...fileCommands,
  ...pluginCommands,
  ...pluginAccessCommands,
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
 * Calls a generated command, type-checked against the Rust signature.
 * Commands not generated (struct inputs, raw bytes, iOS-only) use `call`.
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

/** A desktop-only generated command: answers `fallback` on iOS. */
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
 * A command that sends something to an AI service, refused here while
 * Textus AI is off: the backstop for an entry point that missed the switch.
 */
export function aiCall<T>(command: string, args?: object): Promise<T> {
  return aiRequestsAllowed()
    ? call<T>(command, args)
    : Promise.reject(new IpcError(command, AI_OFF));
}

/** A desktop-only command: rejects on iOS, where Rust doesn't register it. */
export function desktopAction<T>(command: string, args?: object): Promise<T> {
  return isDesktopApp
    ? call<T>(command, args)
    : Promise.reject(
        new IpcError(command, new Error("not available on this platform")),
      );
}
