#!/usr/bin/env bash
# Points the beta update channel at a published release: copies that
# release's textus-latest.json to textus-beta.json in our R2 bucket
# (textus-downloads), which the app's beta channel reads through
# textus.catvinci.com/download/textus-beta.json (src-tauri/src/commands/update.rs).
# GitHub can't serve it: releases/latest skips pre-releases.
#
#   scripts/update-beta-manifest.sh v1.0.5-rc.1
#
# Runs for every published tag, release candidates and stable releases
# alike, so beta users always get the newest of the two. It only moves
# forward (scripts/updater-manifest.mjs beta): rebuilding an older tag
# leaves the manifest alone. Its download URLs are the GitHub release's
# assets; release candidates are not mirrored to the bucket.
#
# release.yml runs it after publishing, through update-beta-manifest.yml,
# with CLOUDFLARE_API_TOKEN (R2 edit) from the repository secrets. By hand
# it needs gh logged in and wrangler logged in to the "ChengAo Home" account.
set -euo pipefail
tag="${1:?usage: update-beta-manifest.sh vX.Y.Z[-rc.N]}"
repo=CatVinci-Studio/Textus
bucket=textus-downloads
name=textus-beta.json
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-49abb4d436c552f6e4497b1782fc9beb}"

work="$(mktemp -d)"
trap 'echo "working files left in $work"' EXIT
gh release download "$tag" --repo "$repo" --dir "$work" --pattern textus-latest.json

# What beta users read now. A missing object is a first run; any other
# failure stops here rather than risk moving the channel backwards.
current=()
if npx -y wrangler@4 r2 object get "$bucket/$name" --remote \
  --file "$work/current.json" >"$work/get.log" 2>&1; then
  current=(--current "$work/current.json")
  echo "beta manifest now: $(node -p "require('$work/current.json').version")"
elif grep -q "The specified key does not exist" "$work/get.log"; then
  echo "no beta manifest yet"
else
  cat "$work/get.log" >&2
  echo "::error::could not read $bucket/$name" >&2
  exit 1
fi

decision="$(node scripts/updater-manifest.mjs beta --version "${tag#v}" \
  --manifest "$work/textus-latest.json" "${current[@]}")"
if [ "$decision" != advance ]; then
  echo "kept the beta manifest: $tag is older"
  exit 0
fi

for attempt in 1 2 3; do
  if npx -y wrangler@4 r2 object put "$bucket/$name" --file "$work/textus-latest.json" \
    --remote --content-type application/json >/dev/null; then
    echo "beta manifest now $tag"
    exit 0
  fi
  echo "  retrying ($attempt)" >&2
  sleep 5
done
exit 1
