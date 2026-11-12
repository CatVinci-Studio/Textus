/**
 * textus.ui.form: a few fields in one dialog, drawn as Textus draws its own, so
 * a plugin needs no webview to ask for them. Requests queue here; the
 * dialog (plugin-form.tsx) loads with the first.
 */
export type PluginFormField =
  | {
      key: string;
      type: "text" | "multiline";
      label: string;
      value?: string;
      placeholder?: string;
    }
  | { key: string; type: "number"; label: string; value?: number }
  | { key: string; type: "boolean"; label: string; value?: boolean }
  | { key: string; type: "date" | "color"; label: string; value?: string }
  | {
      key: string;
      type: "choice";
      label: string;
      value?: string;
      options: { value: string; label: string }[];
    };

interface PluginFormRequest {
  /** The plugin asking: always shown, whatever title it gives. */
  from: string;
  title: string;
  okLabel: string;
  cancelLabel: string;
  fields: PluginFormField[];
}

export interface Request extends PluginFormRequest {
  id: number;
  resolve: (values: Record<string, unknown> | null) => void;
}

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<() => void>();

function publish() {
  for (const listener of listeners) listener();
}

export function subscribePluginForm(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The request showing now, if any. */
export function pluginFormNow(): Request | undefined {
  return queue[0];
}

/** The fields' values by key, or null when cancelled. A field the plugin
 *  got wrong (no key, an unknown type) is left out. */
export function showPluginForm(
  request: PluginFormRequest,
): Promise<Record<string, unknown> | null> {
  const fields = request.fields.filter(
    (f) =>
      f &&
      typeof f.key === "string" &&
      typeof f.label === "string" &&
      [
        "text",
        "multiline",
        "number",
        "boolean",
        "choice",
        "date",
        "color",
      ].includes(f.type) &&
      // A choice needs its options: without them it can't be drawn.
      (f.type !== "choice" ||
        (Array.isArray(f.options) &&
          f.options.length > 0 &&
          f.options.every((o) => o && typeof o.value === "string"))),
  );
  return new Promise((resolve) => {
    queue = [...queue, { ...request, fields, id: nextId++, resolve }];
    publish();
  });
}

export function answer(
  request: Request,
  values: Record<string, unknown> | null,
) {
  queue = queue.filter((r) => r.id !== request.id);
  publish();
  request.resolve(values);
}
