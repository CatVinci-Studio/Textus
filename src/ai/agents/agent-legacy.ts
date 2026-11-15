/**
 * Agents that offer their mode and model the older ACP way - `modes` and
 * `models` in session/new, set with session/set_mode and set_model (Gemini
 * CLI) - read as config options, so the same menus and remembered choices
 * serve them.
 */

import { isRecord } from "../../utils/is-record";

interface Connection {
  request<T>(method: string, params: unknown): Promise<T>;
}

/** A session, as setting an option needs it. */
interface Setting {
  connection: Connection;
  sessionId: string;
  older?: boolean;
}

/** What session/new answered. */
export interface Opened {
  sessionId: string;
  configOptions?: unknown;
  modes?: unknown;
  models?: unknown;
}

const LISTS = [
  { id: "mode", list: "availableModes", key: "id", current: "currentModeId" },
  {
    id: "model",
    list: "availableModels",
    key: "modelId",
    current: "currentModelId",
  },
] as const;

/** `opened`'s options: its config options, else its modes and models as
 *  two of them; `older` when they came the older way. */
export function optionsOf(opened: Opened): { raw: unknown; older: boolean } {
  if (opened.configOptions !== undefined)
    return { raw: opened.configOptions, older: false };
  const raw = LISTS.flatMap(({ id, list, key, current }) => {
    const given = id === "mode" ? opened.modes : opened.models;
    if (!isRecord(given) || !Array.isArray(given[list])) return [];
    return [
      {
        id,
        name: id === "mode" ? "Mode" : "Model",
        category: id,
        type: "select",
        currentValue: given[current],
        options: (given[list] as unknown[]).filter(isRecord).map((c) => ({
          value: c[key],
          name: c.name,
          description: c.description,
        })),
      },
    ];
  });
  return { raw, older: raw.length > 0 };
}

/** Sets option `configId` of `session` the way its agent takes it. */
export function setOption(
  { connection, sessionId, older }: Setting,
  configId: string,
  value: string,
): Promise<{ configOptions?: unknown } | null> {
  if (older && configId === "mode")
    return connection.request("session/set_mode", { sessionId, modeId: value });
  if (older && configId === "model")
    return connection.request("session/set_model", {
      sessionId,
      modelId: value,
    });
  return connection.request("session/set_config_option", {
    sessionId,
    configId,
    value,
  });
}
