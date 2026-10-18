#!/usr/bin/env bash
# Re-syncs src-tauri/installer/installer.nsi with the tauri-cli version in
# package-lock.json: a three-way merge of upstream's changes between the
# version the file was vendored from and the new one, keeping our
# "; Textus:" blocks. Run it when scripts/check-nsis-template.mjs fails.
#
#   scripts/sync-nsis-template.sh
#
# On a conflict the file is left with conflict markers to resolve by hand.
set -euo pipefail
cd "$(dirname "$0")/.."

file=src-tauri/installer/installer.nsi
old=$(sed -n 's/^; Vendored from tauri-cli v\([^:]*\):$/\1/p' "$file")
new=$(node -p 'require("./package-lock.json").packages["node_modules/@tauri-apps/cli"].version')
if [[ -z "$old" ]]; then
  echo "No 'Vendored from tauri-cli vX.Y.Z:' line in $file" >&2
  exit 1
fi
if [[ "$old" == "$new" ]]; then
  echo "$file is already synced with tauri-cli $new"
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT
upstream=https://raw.githubusercontent.com/tauri-apps/tauri/%40tauri-apps/cli-v
path=crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi
curl -fsSL "$upstream$old/$path" -o "$tmp/old.nsi"
curl -fsSL "$upstream$new/$path" -o "$tmp/new.nsi"

sed -i "s/^; Vendored from tauri-cli v$old:\$/; Vendored from tauri-cli v$new:/" "$file"
if git merge-file -L ours -L "tauri-cli $old" -L "tauri-cli $new" \
  "$file" "$tmp/old.nsi" "$tmp/new.nsi"; then
  echo "Merged tauri-cli $old -> $new into $file. Review the diff, then commit."
else
  echo "Conflicts in $file: resolve the markers, then commit." >&2
  exit 1
fi
sed -i "s#tauri-cli v$old)#tauri-cli v$new)#" docs/dev/windows-installer.md
