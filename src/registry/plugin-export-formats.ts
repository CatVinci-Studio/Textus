import { useSyncExternalStore } from "react";
import { createSubscribers } from "../utils/store";

/** What a plugin's export format is given: the document as Markdown, and as
 *  the standalone HTML page File › Export › HTML writes. */
interface PluginExportInput {
  markdown: string;
  html: string;
  path: string | null;
}

/** A format a plugin adds to File › Export. */
interface PluginFormat {
  /** `<plugin id>#<format id>`. */
  key: string;
  plugin: string;
  label: string;
  /** Its files' extension, without the dot. */
  extension: string;
  run(input: PluginExportInput): Promise<string | Uint8Array>;
}

let formats: readonly PluginFormat[] = [];
const listeners = createSubscribers();

function changed(next: readonly PluginFormat[]) {
  formats = next;
  listeners.publish();
}

/** A format in File › Export, until the returned function takes it away. */
export function addPluginFormat(format: PluginFormat): () => void {
  changed([...formats.filter((f) => f.key !== format.key), format]);
  return () => {
    if (formats.includes(format)) changed(formats.filter((f) => f !== format));
  };
}

export function pluginFormats(): readonly PluginFormat[] {
  return formats;
}

export function pluginFormat(key: string): PluginFormat | undefined {
  return formats.find((f) => f.key === key);
}

export function usePluginFormats(): readonly PluginFormat[] {
  return useSyncExternalStore(listeners.subscribe, () => formats);
}
