// Themes and Custom CSS written before 1.3 name Textus's variables by their
// old names; they are read with today's.

const RENAMED: [string, string][] = [
  ["--chrome-text", "--ui-text"],
  ["--chrome-muted", "--ui-muted"],
  ["--chrome-accent", "--ui-accent"],
  ["--chrome-primary", "--ui-accent-fill"],
  ["--chrome-subtle", "--ui-subtle"],
  ["--border-color", "--ui-border"],
  ["--sidebar-bg", "--ui-subtle"],
  ["--sidebar-text", "--ui-text"],
  ["--sidebar-hover", "--ui-hover"],
  ["--sidebar-active-text", "--ui-selected-text"],
  ["--sidebar-active", "--ui-selected"],
  ["--danger-fill", "--ui-danger-fill"],
  ["--danger", "--ui-danger"],
  ["--success-color", "--ui-success"],
  ["--warning-color", "--ui-warning"],
  ["--on-fill", "--ui-on-fill"],
  ["--overlay-bg", "--ui-overlay"],
  ["--viewer-bg", "--ui-overlay-strong"],
  ["--find-match-active-bg", "--ui-find-match-active"],
  ["--find-match-bg", "--ui-find-match"],
  ["--bg", "--ui-bg"],
];

const NAME_END = "(?![\\w-])";

/** The CSS with every pre-1.3 Textus variable under its current name. */
export function withCurrentVariables(css: string): string {
  let out = css
    // The document's: --editor-*, --md-* and --token-* are --doc-*.
    .replace(/--editor-(?=[a-z])/g, "--doc-")
    .replace(/--md-(gap|radius|alert)/g, "--doc-$1")
    .replace(/--token-([a-z]+)(?![\w-])/g, "--doc-token-$1");
  for (const [old, current] of RENAMED)
    out = out.replace(new RegExp(old + NAME_END, "g"), current);
  return out;
}
