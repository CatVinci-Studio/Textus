import { useEffect, useId, useState } from "react";
import { useModalDialog } from "../ui/useModalDialog";
import { Select } from "../ui/Select";
import "./plugin-form.css";

/**
 * textus.ui.form: a few fields in one dialog - a new board's name and its
 * lists, a citation's style - drawn as Textus draws its own, so a plugin
 * needs no webview to ask for them. Shown by the PluginFormHost App mounts;
 * requests queue, as app-dialog's do.
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
  | {
      key: string;
      type: "choice";
      label: string;
      value?: string;
      options: { value: string; label: string }[];
    };

export interface PluginFormRequest {
  title: string;
  okLabel: string;
  cancelLabel: string;
  fields: PluginFormField[];
}

interface Request extends PluginFormRequest {
  id: number;
  resolve: (values: Record<string, unknown> | null) => void;
}

let nextId = 1;
let queue: Request[] = [];
const listeners = new Set<(queue: Request[]) => void>();

function publish() {
  for (const listener of listeners) listener(queue);
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
      ["text", "multiline", "number", "boolean", "choice"].includes(f.type),
  );
  return new Promise((resolve) => {
    queue = [...queue, { ...request, fields, id: nextId++, resolve }];
    publish();
  });
}

function answer(request: Request, values: Record<string, unknown> | null) {
  queue = queue.filter((r) => r.id !== request.id);
  publish();
  request.resolve(values);
}

/** Each field's starting value. */
export function initialValues(
  fields: PluginFormField[],
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "boolean") values[f.key] = f.value === true;
    else if (f.type === "number")
      values[f.key] = typeof f.value === "number" ? f.value : 0;
    else if (f.type === "choice")
      values[f.key] = f.value ?? f.options[0]?.value ?? "";
    else values[f.key] = typeof f.value === "string" ? f.value : "";
  }
  return values;
}

export function PluginFormHost() {
  const [pending, setPending] = useState<Request[]>(queue);
  useEffect(() => {
    listeners.add(setPending);
    return () => {
      listeners.delete(setPending);
    };
  }, []);
  const current = pending[0];
  if (!current) return null;
  return <PluginForm key={current.id} request={current} />;
}

function PluginForm({ request }: { request: Request }) {
  const [values, setValues] = useState(() => initialValues(request.fields));
  const dialog = useModalDialog(
    () => answer(request, null),
    true,
    ".plugin-form-field :is(input, textarea, button)",
  );
  const base = useId();
  const set = (key: string, value: unknown) =>
    setValues((v) => ({ ...v, [key]: value }));
  return (
    <div
      className="close-prompt-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) answer(request, null);
      }}
    >
      <form
        className="close-prompt app-dialog plugin-form"
        {...(dialog as object)}
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onSubmit={(e) => {
          e.preventDefault();
          answer(request, values);
        }}
      >
        <h2 className="app-dialog-title app-dialog-info">{request.title}</h2>
        {request.fields.map((field, i) => {
          const id = `${base}-${i}`;
          const value = values[field.key];
          return (
            <div
              key={field.key}
              className={`plugin-form-field plugin-form-${field.type}`}
            >
              {field.type === "boolean" ? (
                <label htmlFor={id} className="plugin-form-check">
                  <input
                    id={id}
                    type="checkbox"
                    checked={value === true}
                    onChange={(e) => set(field.key, e.target.checked)}
                  />
                  {field.label}
                </label>
              ) : (
                <>
                  <label htmlFor={id}>{field.label}</label>
                  {field.type === "choice" ? (
                    <Select
                      className="settings-select"
                      aria-label={field.label}
                      value={String(value)}
                      onChange={(e) => set(field.key, e.target.value)}
                    >
                      {field.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : field.type === "multiline" ? (
                    <textarea
                      id={id}
                      className="settings-text-input"
                      rows={4}
                      value={String(value)}
                      placeholder={field.placeholder}
                      onChange={(e) => set(field.key, e.target.value)}
                    />
                  ) : (
                    <input
                      id={id}
                      className="settings-text-input"
                      type={field.type === "number" ? "number" : "text"}
                      value={String(value)}
                      placeholder={
                        field.type === "text" ? field.placeholder : undefined
                      }
                      onChange={(e) =>
                        set(
                          field.key,
                          field.type === "number"
                            ? Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </>
              )}
            </div>
          );
        })}
        <div className="close-prompt-buttons">
          <div className="close-prompt-spacer" />
          <button type="button" onClick={() => answer(request, null)}>
            {request.cancelLabel}
          </button>
          <button type="submit" className="close-prompt-primary">
            {request.okLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
