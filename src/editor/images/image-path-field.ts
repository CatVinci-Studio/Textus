import { completionSources } from "../completion/sources";

/**
 * Edit Path: a picture's target in a field over the picture, for one that
 * points at the wrong file or none. Enter writes it; Escape or leaving the
 * field keeps the old one. While typing, the folder's pictures are offered,
 * from the same list `![](` completes from (src/files/path-completion.ts).
 */

/** What the image's view hears when its menu asks to edit the path. */
export const EDIT_IMAGE_PATH_EVENT = "textus-edit-image-path";

export const IMAGE_PATH_FIELD_CLASS = "image-path-field";

/** The id path-completion registers its picture list under. */
const IMAGE_PATHS_SOURCE = "textus.paths.image";

/** The folder's pictures as targets from `docPath`, escaped as a typed
 *  `![](…)` writes them; none outside a folder. */
async function picturePaths(docPath: string | null): Promise<string[]> {
  const source = completionSources().find((s) => s.id === IMAGE_PATHS_SOURCE);
  if (!source) return [];
  const answer = await Promise.resolve(
    source.provide(
      {
        text: "![](",
        match: "(",
        query: "",
        after: "",
        inMath: false,
        path: docPath,
      },
      new AbortController().signal,
    ),
  ).catch(() => null);
  const items = Array.isArray(answer) ? answer : (answer?.items ?? []);
  // Each inserts "(path)": the target alone.
  return items.map((item) => item.insert.replace(/^\(/, "").replace(/\)$/, ""));
}

let fieldCount = 0;

interface PathFieldOptions {
  /** The target as written now. */
  value: string;
  label: string;
  docPath: string | null;
  /** A changed, non-empty target, as typed. */
  apply: (src: string) => void;
  /** The field went: the editor takes the keyboard back. */
  done: () => void;
}

/** Opens the field over `host` (the image's view); one at a time. */
export function openImagePathField(
  host: HTMLElement,
  options: PathFieldOptions,
): void {
  host.querySelector(`.${IMAGE_PATH_FIELD_CLASS}`)?.remove();
  const field = document.createElement("span");
  field.className = IMAGE_PATH_FIELD_CLASS;
  field.contentEditable = "false";
  const input = document.createElement("input");
  input.className = "tx-input";
  input.type = "text";
  input.spellcheck = false;
  input.value = options.value;
  input.setAttribute("aria-label", options.label);
  const list = document.createElement("datalist");
  list.id = `image-path-options-${++fieldCount}`;
  input.setAttribute("list", list.id);
  field.append(input, list);
  host.append(field);

  void picturePaths(options.docPath).then((paths) => {
    for (const path of paths) {
      const option = document.createElement("option");
      option.value = path;
      list.append(option);
    }
  });

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    field.remove();
    options.done();
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault();
      const next = input.value.trim();
      if (next && next !== options.value) options.apply(next);
      close();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  });
  input.addEventListener("blur", close);
  input.focus();
  input.select();
}
