import { useId, useState, useSyncExternalStore } from "react";
import {
  answer,
  pluginFormNow,
  subscribePluginForm,
  type PluginFormField,
  type Request,
} from "./plugin-form-queue";
import { useModalDialog } from "../../engine/controls/useModalDialog";
import { Select } from "../../engine/controls/Select";
import { ColorField, DateField } from "./plugin-form-fields";
import "./plugin-form.css";

/** Each field's starting value. */
function initialValues(fields: PluginFormField[]): Record<string, unknown> {
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
  const current = useSyncExternalStore(subscribePluginForm, pluginFormNow);
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
      className="tx-backdrop"
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
        {request.title !== request.from && (
          <p className="plugin-form-from">{request.from}</p>
        )}
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
                  {field.type === "date" ? (
                    <DateField
                      id={id}
                      value={String(value)}
                      onChange={(next) => set(field.key, next)}
                    />
                  ) : field.type === "color" ? (
                    <ColorField
                      id={id}
                      value={String(value)}
                      onChange={(next) => set(field.key, next)}
                    />
                  ) : field.type === "choice" ? (
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
