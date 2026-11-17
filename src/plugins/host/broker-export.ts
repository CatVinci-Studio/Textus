import { addPluginFormat } from "../../registry/plugin-export-formats";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/** Each plugin's export formats, by `<plugin id>#<format id>`. */
const formats = new Map<string, () => void>();

/** A file extension as the save dialog takes it: letters and digits. */
function extensionOf(value: unknown): string {
  const ext = str(value, "extension").replace(/^\./, "");
  if (!/^[a-z0-9]{1,10}$/i.test(ext))
    throw new Error("extension is letters and digits, like docx.");
  return ext.toLowerCase();
}

/** Takes a stopped plugin's formats out of File › Export. */
export function stopPluginExport(plugin: string): void {
  for (const [key, remove] of formats)
    if (key.startsWith(`${plugin}#`)) {
      remove();
      formats.delete(key);
    }
}

/** `textus.export.registerFormat`: a format in File › Export that the
 *  plugin's code writes. */
export function exportFormatHandlers(p: PluginScope) {
  return {
    "export.registerFormat": ({ id, label, extension }: Params) => {
      const own = str(id, "id");
      const key = `${p.id}#${own}`;
      const ext = extensionOf(extension);
      formats.get(key)?.();
      formats.set(
        key,
        addPluginFormat({
          key,
          plugin: p.id,
          label: optionalStr(label) ?? ext.toUpperCase(),
          extension: ext,
          run: async (input) => {
            const out = await p.request<unknown>("$export", {
              id: own,
              ...input,
            });
            if (typeof out === "string" || out instanceof Uint8Array)
              return out;
            if (out instanceof ArrayBuffer) return new Uint8Array(out);
            throw new Error(`${p.name()} made no file.`);
          },
        }),
      );
    },
    "export.unregisterFormat": ({ id }: Params) => {
      const key = `${p.id}#${str(id, "id")}`;
      formats.get(key)?.();
      formats.delete(key);
    },
  };
}
