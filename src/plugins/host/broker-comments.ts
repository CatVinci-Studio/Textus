import { inOpenFolder } from "../may-open";
import { ownNotes, plugins as pluginsIpc } from "../../platform/ipc";
import { absoluteIn } from "../../utils/path";
import {
  newNoteId,
  notesChanged,
  openNotes,
} from "../../ai/margin/notes-by-path";
import { parseOwnNotes, type StoredOwnNote } from "../../ai/margin/own-notes";
import { str, type Params, type PluginScope } from "./broker-scope";

/**
 * The notes in a document's margin - the writer's own and plugins' - for a
 * plugin with `comments`. A document open in an editor has them changed
 * there; a closed one in the file they are kept in. Reading them reads the
 * document's words, so files.read and the file's folder are needed too.
 */

/** A note as a plugin is told of it. */
interface PluginComment {
  id: string;
  /** The words it is on. */
  text: string;
  comment: string;
  /** The plugin that left it, by name; null for the writer's own. */
  author: string | null;
}

const told = (n: StoredOwnNote): PluginComment => ({
  id: n.id,
  text: n.anchor,
  comment: n.comment,
  author: n.author ?? null,
});

/** The longest note a plugin may leave. */
const LONGEST = 4000;

export function commentHandlers(p: PluginScope) {
  /** `path` in full, if it is a file the plugin may read. */
  const fileOf = (path: unknown) => {
    const root = p.root();
    const full = absoluteIn(root, str(path, "path"));
    if (!inOpenFolder(root, full))
      throw new Error(`${String(path)} isn't in the open folder.`);
    return { root, full };
  };
  const kept = async (full: string) =>
    parseOwnNotes(await ownNotes.read(full, "notes"));
  const keep = async (full: string, notes: StoredOwnNote[]) => {
    await ownNotes.write(full, "notes", JSON.stringify(notes));
    notesChanged(full);
  };
  const held = (full: string) => {
    const notes = openNotes(full);
    return notes?.ready() ? notes : null;
  };

  return {
    "comments.list": async ({ path }: Params) => {
      const { full } = fileOf(path);
      return (held(full)?.list() ?? (await kept(full))).map(told);
    },
    "comments.add": async ({ path, text, comment }: Params) => {
      const { root, full } = fileOf(path);
      const anchor = str(text, "text");
      const words = str(comment, "comment").trim().slice(0, LONGEST);
      if (!anchor.trim() || anchor.includes("\n"))
        throw new Error("A comment is on words of one paragraph.");
      if (!words) throw new Error("A comment needs words.");
      const author = p.name();
      const open = held(full);
      if (open) {
        const id = open.add({ anchor, comment: words, author });
        if (!id) throw new Error(`"${anchor}" isn't in ${String(path)}.`);
        return id;
      }
      const bytes = await pluginsIpc.fsRead(p.id, root, full);
      if (!new TextDecoder().decode(bytes).includes(anchor))
        throw new Error(`"${anchor}" isn't in ${String(path)}.`);
      const id = newNoteId("plugin");
      await keep(full, [
        ...(await kept(full)),
        { id, comment: words, anchor, before: "", author },
      ]);
      return id;
    },
    "comments.resolve": async ({ path, id }: Params) => {
      const { full } = fileOf(path);
      const note = str(id, "id");
      const open = held(full);
      if (open) return open.remove(note);
      const notes = await kept(full);
      const left = notes.filter((n) => n.id !== note);
      if (left.length === notes.length) return false;
      await keep(full, left);
      return true;
    },
  };
}
