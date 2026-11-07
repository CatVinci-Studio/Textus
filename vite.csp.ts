import tauriConfig from "./src-tauri/tauri.conf.json";

type Directives = Record<string, string[]>;

/** The window's Content Security Policy, as tauri.conf.json has it. */
const windowCsp: Directives = tauriConfig.app.security.csp;

/** A policy as the header and the `<meta>` write it. */
function cspString(directives: Directives): string {
  return Object.entries(directives)
    .map(([name, sources]) => [name, ...sources].join(" "))
    .join("; ");
}

/**
 * The window's policy for the Vite dev server. A desktop `tauri dev` loads
 * the dev server's page as it is, without the policy Tauri adds to the
 * built app's pages, so the server sends it - and the e2e flows run under it
 * too. Plus the dev server's own HMR socket.
 */
export function devServerCsp(): string {
  return cspString({
    ...windowCsp,
    "connect-src": [...windowCsp["connect-src"], "ws://localhost:*"],
  });
}
