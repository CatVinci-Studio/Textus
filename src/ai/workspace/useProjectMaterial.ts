import { useCallback, useEffect, useMemo, useState } from "react";
import { ai, type ProjectEntry } from "../../platform/ipc";
import { looksLikePlanFile } from "./auto-writer";

/** One auto-writing run, started by a send in Create mode with "分节写作"
 *  on or project material picked. */
export interface AutoWriteRequest {
  /** Changes per start, so the same request can be sent twice. */
  id: string;
  /** The project folder the material comes from; null without material. */
  folder: string | null;
  material: string[];
  pictures: string[];
  /** The user's message: topic, readers, length, tone. */
  extra: string;
  images: boolean;
}

/** What auto-writing can work from: the project folder (the chosen one,
 *  else the document's own), its files, and the ones ticked - text and
 *  documents are material, pictures are offered to the sections. Nothing
 *  is ticked until the user opens the picker (`suggest`): a ticked file
 *  turns a send in Create mode into auto-writing, so it must never be
 *  ticked behind their back. */

export function useProjectMaterial(
  docPath: string | null,
  root: string | null,
  /** The Agent is on screen: the folder is (re)read then, so files added
   *  since are there - and never for a document nobody opens Agent on. */
  active: boolean,
) {
  const [folder, setFolder] = useState<string | null>(null);
  const [entries, setEntries] = useState<ProjectEntry[] | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [suggested, setSuggested] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void Promise.all([
      ai.projectFolder(docPath, root).catch(() => null),
      ai.listProjectEntries(docPath, root).catch(() => []),
    ]).then(([dir, list]) => {
      if (!live) return;
      setFolder(dir);
      setEntries(dir ? (list ?? []) : []);
      // Ticks that no longer name a file in this folder go.
      const paths = new Set((list ?? []).map((e) => e.path));
      setChosen((prev) => new Set([...prev].filter((p) => paths.has(p))));
    });
    return () => {
      live = false;
    };
  }, [docPath, root, reload, active]);
  // Another folder is another project: start from nothing again.
  useEffect(() => {
    setChosen(new Set());
    setSuggested(false);
  }, [folder]);
  const kindOf = useCallback(
    (path: string) => entries?.find((e) => e.path === path)?.kind ?? "other",
    [entries],
  );
  const material = useMemo(
    () =>
      [...chosen].filter(
        (p) => kindOf(p) === "text" || kindOf(p) === "document",
      ),
    [chosen, kindOf],
  );
  const pictures = useMemo(
    () => [...chosen].filter((p) => kindOf(p) === "image"),
    [chosen, kindOf],
  );
  /** First opening of the picker: the plan-like documents and the pictures
   *  start ticked, as a suggestion the user can see. */
  const suggest = useCallback(() => {
    if (suggested || !entries) return;
    setSuggested(true);
    setChosen(
      new Set(
        entries
          .filter(
            (e) =>
              e.kind === "image" ||
              (e.kind !== "other" && looksLikePlanFile(e.path)),
          )
          .slice(0, 60)
          .map((e) => e.path),
      ),
    );
  }, [suggested, entries]);
  const toggle = useCallback((paths: string[], on: boolean) => {
    setChosen((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (on) next.add(path);
        else next.delete(path);
      }
      return next;
    });
  }, []);
  return {
    folder,
    entries,
    chosen,
    material,
    pictures,
    suggest,
    toggle,
    clear: () => setChosen(new Set()),
    refresh: () => setReload((n) => n + 1),
  };
}

export type ProjectMaterial = ReturnType<typeof useProjectMaterial>;
