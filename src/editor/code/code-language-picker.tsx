import { createRoot, type Root } from "react-dom/client";
import { Select } from "../../ui/Select";

/** What the picker shows and does; given again whenever it changes. */
export interface LanguagePickerProps {
  /** The fence's language, "" for none. */
  value: string;
  /** The menu's languages, "" first for plain text. */
  languages: readonly string[];
  label: string;
  onChange: (language: string) => void;
}

/**
 * A code block's language picker: the app's own Select inside the block's
 * view (code-block-language-view.ts), which is plain DOM. A native select's
 * list is the platform's menu, unlike every other menu in the app.
 */
export function mountLanguagePicker(container: HTMLElement) {
  let root: Root | null = createRoot(container);
  return {
    render({ value, languages, label, onChange }: LanguagePickerProps) {
      // A fence's own spelling (`js`, `sh`, `mermaid`) outside the list
      // gets an option of its own: shown as plain text, the block would
      // be mislabelled, and picking from the menu rewrote its fence.
      const options = languages.includes(value)
        ? languages
        : [...languages, value];
      root?.render(
        <Select
          className="code-block-language-select"
          aria-label={label}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map((lang) => (
            <option key={lang} value={lang}>
              {lang === "" ? "plain text" : lang}
            </option>
          ))}
        </Select>,
      );
    },
    destroy() {
      const done = root;
      root = null;
      // Not while ProseMirror is redrawing, which may be inside a React
      // render of its own.
      queueMicrotask(() => done?.unmount());
    },
  };
}
