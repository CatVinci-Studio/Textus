import type { ToolCallFields } from "./acp-client";
import { isRecord } from "../../utils/is-record";

/** What a step is, as heard so far: a permission request may name only
 *  its id. */
export interface StepFacts {
  title?: string;
  kind?: string;
  /** The command it runs, or the file, address or search it reaches. */
  detail?: string;
}

/** The input fields that say what a step does, best first. */
const DETAIL_KEYS = ["command", "cmd", "file_path", "path", "url", "query"];

/** What a step does, from its input or the first place it touches. */
function detailOf(fields: ToolCallFields): string | undefined {
  const input = fields.rawInput;
  if (isRecord(input))
    for (const key of DETAIL_KEYS) {
      const value = input[key];
      if (typeof value === "string" && value.trim()) return value;
      if (Array.isArray(value) && value.every((v) => typeof v === "string"))
        return value.join(" ");
    }
  return fields.locations?.[0]?.path;
}

/** `known` with what `fields` adds; later news wins. */
export function stepFacts(
  known: StepFacts | undefined,
  fields: ToolCallFields,
): StepFacts {
  return {
    title: fields.title || known?.title,
    kind: fields.kind || known?.kind,
    detail: detailOf(fields) ?? known?.detail,
  };
}
