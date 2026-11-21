import { showConfirm } from "../../engine/controls/app-dialog";
import { currentStrings } from "../../i18n/current";
import { fill } from "../../i18n/fill";
import { plugins as pluginsIpc } from "../../platform/ipc";
import { errorText } from "../../utils/error-text";
import { str, type Params, type PluginScope } from "./broker-scope";

/** How a call says its repository would run programs of its own that the
 *  writer hasn't agreed to (plugins/git/safety.rs); what they are follows. */
const UNTRUSTED = "git-untrusted: ";

/** Folders the writer said no for, this session: asked once, not on every
 *  save. */
const declined = new Set<string>();
const asking = new Map<string, Promise<boolean>>();

/** Asks, once per folder, whether Git may run what its repository sets up
 *  (`what`); trusted from then on, on this computer. */
function gitTrusted(root: string, what: string): Promise<boolean> {
  if (declined.has(root)) return Promise.resolve(false);
  const waiting = asking.get(root);
  if (waiting) return waiting;
  const t = currentStrings();
  const answer = showConfirm(fill(t.gitTrustText, { what }), {
    title: t.gitTrustTitle,
    tone: "warning",
    okLabel: t.gitTrustAllow,
    cancelLabel: t.cancel,
    focusCancel: true,
  })
    .then(async (yes) => {
      if (yes) await pluginsIpc.gitTrust(root);
      else declined.add(root);
      return yes;
    })
    .finally(() => asking.delete(root));
  asking.set(root, answer);
  return answer;
}

/** `call`, asked again once the writer trusts the repository; `refused`
 *  when they don't. */
async function trusting<T>(
  root: string,
  call: () => Promise<T>,
  refused: () => T,
): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const said = errorText(error);
    if (!said.startsWith(UNTRUSTED)) throw error;
    if (!(await gitTrusted(root, said.slice(UNTRUSTED.length))))
      return refused();
    return call();
  }
}

/** A call that changes the repository or its remote: refused, saying
 *  why, where the writer doesn't trust the repository. */
function writing<T>(root: string, call: () => Promise<T>): Promise<T> {
  return trusting(root, call, () => {
    throw new Error(currentStrings().gitTrustRefused);
  });
}

/** The open folder's Git history, read with the user's git (desktop):
 *  checked again in Rust, path by path. Where the writer doesn't trust the
 *  repository, reading finds none and a commit says why. */
export function gitHandlers(p: PluginScope) {
  const paths = (value: unknown) => {
    if (!Array.isArray(value) || !value.length)
      throw new Error("paths must be a list of files.");
    return value.map((path, i) => str(path, `paths[${i}]`));
  };
  return {
    "git.status": () => {
      const root = p.root();
      return trusting(
        root,
        () => pluginsIpc.gitStatus(p.id, root),
        () => null,
      );
    },
    "git.log": ({ path, limit }: Params) => {
      const root = p.root();
      const file = str(path, "path");
      const most =
        typeof limit === "number" ? Math.max(1, Math.floor(limit)) : null;
      return trusting(
        root,
        () => pluginsIpc.gitLog(p.id, root, file, most),
        () => [],
      );
    },
    "git.show": ({ hash, path }: Params) => {
      const root = p.root();
      const [commit, file] = [str(hash, "hash"), str(path, "path")];
      return trusting(
        root,
        () => pluginsIpc.gitShow(p.id, root, commit, file),
        () => null,
      );
    },
    "git.commit": ({ message, paths: files }: Params) => {
      const root = p.root();
      const [text, list] = [str(message, "message"), paths(files)];
      return writing(root, () => pluginsIpc.gitCommit(p.id, root, text, list));
    },
    "git.fetch": () => {
      const root = p.root();
      return writing(root, () => pluginsIpc.gitFetch(p.id, root));
    },
    "git.push": () => {
      const root = p.root();
      return writing(root, () => pluginsIpc.gitPush(p.id, root));
    },
    "git.pull": () => {
      const root = p.root();
      return writing(root, () => pluginsIpc.gitPull(p.id, root));
    },
  };
}
