#!/usr/bin/env bash
# Re-syncs src-tauri/installer/installer.nsi with the tauri-cli version in
# package-lock.json: a three-way merge of upstream's changes between the
# version the file was vendored from and the new one, keeping our
# "; Textus:" blocks. Run it when scripts/check-nsis-template.mjs fails.
#
#   scripts/sync-nsis-template.sh
#
# On a conflict the file is left with conflict markers to resolve by hand.
# Works with the BSD tools on macOS too: in-place edits go through node, not
# GNU `sed -i`.
set -euo pipefail
cd "$(dirname "$0")/.."

file=src-tauri/installer/installer.nsi
doc=docs/dev/windows-installer.md

# Replaces the first match of a regex (JavaScript syntax, multiline) in a
# file, and fails if there is none.
#   replace <file> <regex> <replacement>
replace() {
  node -e '
    const fs = require("fs");
    const [file, pattern, replacement] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8");
    const re = new RegExp(pattern, "m");
    if (!re.test(text)) {
      console.error(`No match for /${pattern}/ in ${file}`);
      process.exit(1);
    }
    fs.writeFileSync(file, text.replace(re, replacement));
  ' "$1" "$2" "$3"
}

# The same pattern as scripts/check-nsis-template.mjs: the trailing colon
# is optional.
version_line='^; Vendored from tauri-cli v(\S+?):?$'
old=$(node -e '
  const fs = require("fs");
  const m = fs.readFileSync(process.argv[1], "utf8").match(new RegExp(process.argv[2], "m"));
  if (m) console.log(m[1]);
' "$file" "$version_line")
new=$(node -p 'require("./package-lock.json").packages["node_modules/@tauri-apps/cli"].version')
if [[ -z "$old" ]]; then
  echo "No 'Vendored from tauri-cli vX.Y.Z:' line in $file" >&2
  exit 1
fi
if [[ "$old" == "$new" ]]; then
  echo "$file is already synced with tauri-cli $new"
  exit 0
fi

# Kept, not deleted, so the two upstream templates can be compared while
# resolving a conflict; the system cleans its temp folder.
tmp=$(mktemp -d)
upstream=https://raw.githubusercontent.com/tauri-apps/tauri/%40tauri-apps/cli-v
path=crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
curl -fsSL "$upstream$old/$path" -o "$tmp/old.nsi"
curl -fsSL "$upstream$new/$path" -o "$tmp/new.nsi"
echo "Upstream templates for tauri-cli $old and $new: $tmp/old.nsi, $tmp/new.nsi"

# Both version lines move before the merge, so they are right even when the
# merge stops on a conflict.
replace "$file" "$version_line" "; Vendored from tauri-cli v$new:"
replace "$doc" "tauri-cli v${old//./\\.}\\)" "tauri-cli v$new)"

if git merge-file -L ours -L "tauri-cli $old" -L "tauri-cli $new" \
  "$file" "$tmp/old.nsi" "$tmp/new.nsi"; then
  echo "Merged tauri-cli $old -> $new into $file. Review the diff, then commit."
else
  echo "Conflicts in $file: resolve the markers, then commit." >&2
  exit 1
fi
