import { showConfirm } from "../../engine/controls/app-dialog";
import { fill } from "../../i18n/fill";
import { isDesktopApp } from "../../platform/capabilities";
import { ssh } from "../../platform/ipc-ssh";
import { toBase64 } from "../store/files";
import { str, type Params, type PluginScope } from "./broker-scope";

/** What Rust refuses a link with until the user answers. */
const NOT_ALLOWED = "plugin-ssh-not-allowed";

/** Takes a stopped plugin's links down. */
export function stopPluginSsh(plugin: string): void {
  if (isDesktopApp) void ssh.close(plugin, null).catch(() => {});
}

const sessionOf = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error("session is a number connect gave.");
  return value;
};

/** `textus.ssh`: a folder on a server through the user's own ssh; each host
 *  asked of the user once per plugin. */
export function sshHandlers(p: PluginScope) {
  const desktop = () => {
    if (!isDesktopApp) throw new Error("SSH is on the desktop only.");
  };
  /** ssh's reason in the user's words. */
  const said = (error: unknown, host: string): Error => {
    const text = String(error);
    const t = p.t();
    if (text.startsWith("ssh-unknown-host"))
      return new Error(fill(t.pluginSshUnknownHost, { host }));
    if (text.startsWith("ssh-needs-login"))
      return new Error(fill(t.pluginSshNeedsLogin, { host }));
    return error instanceof Error ? error : new Error(text);
  };
  return {
    "ssh.hosts": () => {
      desktop();
      return ssh.hosts(p.id);
    },
    "ssh.connect": async ({ host }: Params) => {
      desktop();
      const name = str(host, "host");
      try {
        return await ssh.connect(p.id, name);
      } catch (error) {
        if (String(error) !== NOT_ALLOWED) throw said(error, name);
      }
      const t = p.t();
      const ok = await showConfirm(
        fill(t.pluginSshAsk, { plugin: p.name(), host: name }),
        { title: p.name(), okLabel: t.pluginAiAllow, cancelLabel: t.cancel },
      );
      if (!ok) throw new Error("The user didn't allow it.");
      await ssh.allow(p.id, name);
      return ssh.connect(p.id, name).catch((error) => {
        throw said(error, name);
      });
    },
    "ssh.home": ({ session }: Params) => ssh.home(p.id, sessionOf(session)),
    "ssh.list": ({ session, path }: Params) =>
      ssh.list(p.id, sessionOf(session), str(path, "path")),
    "ssh.read": ({ session, path }: Params) =>
      ssh.read(p.id, sessionOf(session), str(path, "path")),
    "ssh.write": ({ session, path, data }: Params) =>
      data instanceof Uint8Array
        ? ssh.write(
            p.id,
            sessionOf(session),
            str(path, "path"),
            toBase64(data),
            true,
          )
        : ssh.write(
            p.id,
            sessionOf(session),
            str(path, "path"),
            str(data, "data"),
            false,
          ),
    "ssh.create": ({ session, path, folder }: Params) =>
      ssh.create(p.id, sessionOf(session), str(path, "path"), folder === true),
    "ssh.rename": ({ session, from, to }: Params) =>
      ssh.rename(p.id, sessionOf(session), str(from, "from"), str(to, "to")),
    "ssh.delete": ({ session, path }: Params) =>
      ssh.remove(p.id, sessionOf(session), str(path, "path")),
    "ssh.close": ({ session }: Params) => ssh.close(p.id, sessionOf(session)),
  };
}
