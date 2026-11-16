/** Hidden names never open to a plugin, wherever they are: keys, tokens,
 *  what runs, other plugins' storage. One rule with the Rust side's
 *  (plugins/access/paths.rs). */
const NEVER =
  /^(?:\.git|\.git-credentials|\.ssh|\.aws|\.gnupg|\.docker|\.kube|\.config|\.textus|\.env.*|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.htpasswd|\.vault-token|\.terraformrc|.*_history|\.?mcp\.json|credentials.*|.*\.(?:pem|key|p12|pfx))$/i;

/** Whether a plugin may ask for `hidden:<path>`: a file under a hidden
 *  folder or a hidden file of the open folder, named from its top, none
 *  of whose parts is a secret's. */
export function isHiddenFilePath(path: string): boolean {
  const parts = path.split("/");
  return (
    path.length <= 200 &&
    /^[A-Za-z0-9_. /-]+$/.test(path) &&
    parts[0].startsWith(".") &&
    parts.every((p) => p && p !== "." && p !== "..") &&
    !parts.some((p) => NEVER.test(p))
  );
}
