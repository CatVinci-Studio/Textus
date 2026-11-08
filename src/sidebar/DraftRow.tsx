import { useEffect, useRef, useState } from "react";
import type { DirEntryInfo } from "../platform/fs-types";
import { useSettings } from "../prefs/SettingsContext";
import { FolderIcon } from "../ui/icons";
import { fileIconFor } from "../ui/file-icons";
import { useTree } from "./tree-shared";

/** A name nothing in the folder has yet: "Untitled", then "Untitled 2"…
 *  A document's name is checked with the .md the backend adds. */
export function freeName(
  base: string,
  kind: "document" | "folder",
  entries: readonly DirEntryInfo[],
): string {
  const taken = new Set(entries.map((e) => e.name.toLowerCase()));
  const full = (stem: string) =>
    (kind === "document" ? `${stem}.md` : stem).toLowerCase();
  let name = base;
  for (let n = 2; taken.has(full(name)); n++) name = `${base} ${n}`;
  return name;
}

/** The row a new document or folder is named in, in place, as in a file
 *  manager: Enter or leaving it makes it, Escape or an empty name doesn't. */
export function DraftRow({
  kind,
  depth,
  entries,
}: {
  kind: "document" | "folder";
  depth: number;
  entries: readonly DirEntryInfo[];
}) {
  const { t } = useSettings();
  const tree = useTree();
  const doc = kind === "document";
  const [name, setName] = useState(() =>
    freeName(
      doc ? t.treeNewDocumentDefault : t.treeNewFolderDefault,
      kind,
      entries,
    ),
  );
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    tree.finishDraft(value?.trim() ? value.trim() : null);
  };
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const Icon = doc ? fileIconFor(".md") : FolderIcon;
  return (
    <div
      className="tree-row tree-row-draft"
      style={{ paddingLeft: depth * 14 + (doc ? 12 : 0) }}
    >
      <Icon className="tree-icon" />
      <input
        ref={input}
        className="tree-draft-input"
        aria-label={doc ? t.treeNewDocumentPrompt : t.treeNewFolderPrompt}
        value={name}
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // The tree's arrow keys and type-ahead stay out of the name.
          e.stopPropagation();
          if (e.nativeEvent.isComposing) return;
          if (e.key !== "Enter" && e.key !== "Escape") return;
          // Or the key goes on to the button of a notice this opens.
          e.preventDefault();
          finish(e.key === "Enter" ? name : null);
        }}
        onBlur={() => finish(name)}
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
