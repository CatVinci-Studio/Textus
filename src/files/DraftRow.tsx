import { useState, type CSSProperties } from "react";
import { type DirEntryInfo } from "../platform/bindings/files";
import { useSettings } from "../prefs/SettingsContext";
import { FileIcon, FolderEntryIcon } from "../engine/controls/file-icons";
import { useTree } from "./tree-shared";
import { NameField } from "./NameField";

/** A name nothing in the folder has yet: "Untitled", then "Untitled 2"…
 *  A document's name is checked with the .md the backend adds. */
function freeName(
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
 *  manager (NameField). */
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
  const [name] = useState(() =>
    freeName(
      doc ? t.treeNewDocumentDefault : t.treeNewFolderDefault,
      kind,
      entries,
    ),
  );
  return (
    <div
      className={`tree-row tree-row-draft${doc ? " tree-row-file" : ""}`}
      style={{ "--depth": depth } as CSSProperties}
    >
      {doc ? (
        <FileIcon name=".md" className="tree-icon" />
      ) : (
        <FolderEntryIcon name={name} className="tree-icon" />
      )}
      <NameField
        initial={name}
        isDir
        fresh
        label={doc ? t.treeNewDocumentPrompt : t.treeNewFolderPrompt}
        commit={(typed, byKey) => tree.finishDraft(typed, byKey)}
        cancel={(byKey) => void tree.finishDraft(null, byKey)}
      />
    </div>
  );
}
