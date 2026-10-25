import { plugins as pluginsIpc } from "../platform/ipc";
import {
  backlinksIn,
  documentOf,
  folderIndex,
  resolveIn,
  tagsIn,
  tasksIn,
} from "./metadata-cache";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/**
 * A plugin's questions about the open folder's documents
 * (textus.metadata), answered from the index (metadata-cache.ts). They
 * need files.read, which `p.root()` checks.
 */
export function metadataHandlers(p: PluginScope) {
  const index = () => folderIndex(p.id, p.root());
  return {
    "metadata.get": async ({ path }: Params) => {
      const root = p.root();
      const target = str(path, "path");
      const meta = await pluginsIpc.metadataGet(p.id, root, target);
      if (!meta) return null;
      const { documents } = await index();
      return documentOf(
        meta,
        documents.map((d) => d.path),
      );
    },
    "metadata.all": async () => (await index()).documents,
    "metadata.backlinks": async ({ path }: Params) =>
      backlinksIn(await index(), str(path, "path")),
    "metadata.resolveLink": async ({ link, from }: Params) => {
      const { documents } = await index();
      const target = str(link, "link");
      return resolveIn(
        documents.map((d) => d.path),
        target.replace(/^\[\[|\]\]$/g, ""),
        str(from, "from"),
        target.startsWith("[["),
      );
    },
    "metadata.tags": async () => tagsIn(await index()),
    "metadata.tasks": async ({ done, path, tag }: Params) =>
      tasksIn(await index(), {
        done: typeof done === "boolean" ? done : undefined,
        path: optionalStr(path),
        tag: optionalStr(tag),
      }),
    "metadata.search": async ({ query, limit }: Params) => {
      const found = await pluginsIpc.fsSearch(
        p.id,
        p.root(),
        str(query, "query"),
        typeof limit === "number" ? limit : null,
      );
      return {
        truncated: found.truncated,
        hits: found.hits.map((h) => ({
          path: h.path,
          rel: h.rel,
          line: h.line,
          text: h.text,
        })),
      };
    },
  };
}
