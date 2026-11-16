import { plugins as pluginsIpc } from "../../platform/ipc";
import { str, type Params, type PluginScope } from "./broker-scope";

/** The open folder's Git history, read with the user's git (desktop):
 *  checked again in Rust, path by path. */
export function gitHandlers(p: PluginScope) {
  const paths = (value: unknown) => {
    if (!Array.isArray(value) || !value.length)
      throw new Error("paths must be a list of files.");
    return value.map((path, i) => str(path, `paths[${i}]`));
  };
  return {
    "git.status": () => pluginsIpc.gitStatus(p.id, p.root()),
    "git.log": ({ path, limit }: Params) =>
      pluginsIpc.gitLog(
        p.id,
        p.root(),
        str(path, "path"),
        typeof limit === "number" ? Math.max(1, Math.floor(limit)) : null,
      ),
    "git.show": ({ hash, path }: Params) =>
      pluginsIpc.gitShow(p.id, p.root(), str(hash, "hash"), str(path, "path")),
    "git.commit": ({ message, paths: files }: Params) =>
      pluginsIpc.gitCommit(
        p.id,
        p.root(),
        str(message, "message"),
        paths(files),
      ),
  };
}
