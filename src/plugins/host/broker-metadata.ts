import { plugins as pluginsIpc } from "../../platform/ipc";
import {
  backlinksIn,
  documentOf,
  folderIndex,
  resolveTarget,
  targetLine,
  tagsIn,
  tasksIn,
} from "../workspace/metadata-cache";
import { linkToTarget, type LinkToOptions } from "../../links/link-resolve";
import { linkStyleAt } from "../../links/link-style";
import {
  optionalStr,
  str,
  type Params,
  type PluginScope,
} from "./broker-scope";

/**
 * A plugin's questions about the open folder's documents, answered from the
 * index. They need files.read, which `p.root()` checks.
 */
export function metadataHandlers(p: PluginScope) {
  const index = () => folderIndex(p.id, p.root());
  return {
    "metadata.get": async ({ path }: Params) => {
      const root = p.root();
      const target = str(path, "path");
      const meta = await pluginsIpc.metadataGet(p.id, root, target);
      if (!meta) return null;
      return documentOf(meta, (await index()).paths);
    },
    "metadata.all": async () => (await index()).documents,
    "metadata.backlinks": async ({ path }: Params) =>
      backlinksIn(await index(), str(path, "path")),
    "metadata.resolveLink": async ({ link, from }: Params) => {
      const target = resolveTarget(
        (await index()).paths,
        str(link, "link"),
        str(from, "from"),
      );
      return target?.exists ? target.path : null;
    },
    "metadata.resolveNote": async ({ link, from }: Params) => {
      const folder = await index();
      const target = resolveTarget(
        folder.paths,
        str(link, "link"),
        str(from, "from"),
      );
      return target && { ...target, line: targetLine(folder, target) };
    },
    "metadata.linkTo": async ({ to, from, options }: Params) => {
      const source = str(from, "from");
      const o = (options ?? {}) as Record<string, unknown>;
      const text = (key: string) =>
        typeof o[key] === "string" && o[key] ? (o[key] as string) : undefined;
      const [folder, style] = await Promise.all([index(), linkStyleAt(source)]);
      const wanted: LinkToOptions = {
        heading: text("heading"),
        block: text("block")?.replace(/^\^/, ""),
        alias: text("alias"),
        embed: o.embed === true,
      };
      return linkToTarget(
        folder.paths,
        str(to, "to"),
        source,
        o.style === "wiki" || o.style === "markdown"
          ? { ...style, wiki: o.style === "wiki" }
          : style,
        wanted,
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
