// Plugin and skill versions as semver orders them, and whether a Textus
// version meets a plugin's engine range.

function versionParts(version: string): [number, number, number, string] {
  const [core, pre = ""] = version.split("-", 2);
  const [major = 0, minor = 0, patch = 0] = core.split(".").map(Number);
  return [major, minor, patch, pre];
}

/** -1, 0 or 1, as semver orders them: a pre-release before its release. */
export function compareVersions(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < 3; i++)
    if (x[i] !== y[i]) return (x[i] as number) < (y[i] as number) ? -1 : 1;
  if (x[3] === y[3]) return 0;
  if (!x[3]) return 1;
  if (!y[3]) return -1;
  return comparePre(x[3], y[3]);
}

/** Pre-release tags, part by part: numbers as numbers (rc.12 after rc.2),
 *  a number before a word, fewer parts first. */
function comparePre(a: string, b: string): number {
  const x = a.split(".");
  const y = b.split(".");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1;
    if (y[i] === undefined) return 1;
    if (x[i] === y[i]) continue;
    const [m, n] = [x[i], y[i]].map((part) =>
      /^\d+$/.test(part) ? Number(part) : null,
    );
    if (m !== null && n !== null) return m < n ? -1 : 1;
    if (m !== null) return -1;
    if (n !== null) return 1;
    return x[i] < y[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether Textus `version` satisfies `range`: `^1.3.0`, `>=1.3.0`, `1.3.x`, or
 * exact. Textus pre-releases count as their release unless the range names a
 * pre-release itself; then they are told apart.
 */
export function engineSatisfied(range: string, version: string): boolean {
  const r = range.trim();
  if (r === "*") return true;
  const base = r.replace(/^(>=|\^)/, "").trim();
  const release = base.includes("-") ? version : version.split("-")[0];
  if (r.startsWith(">=")) return compareVersions(release, base) >= 0;
  if (r.startsWith("^")) {
    const [major] = versionParts(base);
    return (
      compareVersions(release, base) >= 0 && versionParts(release)[0] === major
    );
  }
  const wild = /^(\d+)\.(\d+)\.x$/.exec(r);
  if (wild) {
    const [major, minor] = versionParts(release);
    return major === Number(wild[1]) && minor === Number(wild[2]);
  }
  return compareVersions(release, r) === 0;
}
