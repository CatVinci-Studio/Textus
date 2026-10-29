#!/usr/bin/env bash
# Copies a release's installers from GitHub to our own R2 bucket
# (textus-downloads), so the site's download buttons don't depend on GitHub,
# which is slow or unreachable from some networks. The site
# (CatVinci-Studio/levis-homepage) reads manifest.json through its
# functions/download/[[path]].js and falls back to GitHub; the updater,
# Homebrew and Arch keep using the GitHub release. Which file goes under
# which of manifest.json's keys is scripts/mirror-keys.mjs.
#
#   scripts/mirror-downloads.sh v1.0.0
#
# Only the newest KEEP stable versions stay in the bucket; every version is
# still on GitHub.
#
# release.yml runs it after publishing, with CLOUDFLARE_API_TOKEN (R2 edit)
# from the repository secrets. By hand it needs gh logged in and wrangler
# logged in to the "ChengAo Home" account.
set -euo pipefail
tag="${1:?usage: mirror-downloads.sh vX.Y.Z}"
repo=CatVinci-Studio/Textus
bucket=textus-downloads
keep=3
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-49abb4d436c552f6e4497b1782fc9beb}"

work="$(mktemp -d)"
trap 'echo "downloaded files left in $work"' EXIT
gh release download "$tag" --repo "$repo" --dir "$work" \
  --pattern '*_aarch64.dmg' --pattern '*_x64.dmg' --pattern '*-setup.exe' --pattern '*.AppImage' \
  --pattern '*.deb' --pattern '*.rpm'

# One object up, retried: a large upload now and then drops its connection.
put() {
  for attempt in 1 2 3; do
    if npx -y wrangler@4 r2 object put "$bucket/$1" --file "$2" --remote \
      --content-type "$3" >/dev/null; then
      return 0
    fi
    echo "  retrying $1 ($attempt)" >&2
    sleep 5
  done
  return 1
}

# The manifest the site reads: the version and each platform's file, under
# the keys in scripts/mirror-keys.mjs (mac, windows, linux-arm64, ...).
# Written first, uploaded last: the files it names must be there before it.
manifest="$work/manifest.json"
node scripts/mirror-keys.mjs --tag "$tag" --out "$manifest" "$work"/*
paths="$(node -p "Object.values(require('$manifest').files).join('\n')")"
for path in $paths; do
  name="${path##*/}"
  echo "uploading $name"
  put "$path" "$work/$name" application/octet-stream
done
cat "$manifest"
put manifest.json "$manifest" application/json
echo "mirrored $tag"

# Older versions' files, listed through the API: wrangler can't list a
# bucket. Never fails the mirror.
prune() {
  local api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/r2/buckets/$bucket/objects"
  local old key
  old="$(gh release list --repo "$repo" --exclude-pre-releases --limit 100 \
    --json tagName -q '.[].tagName' | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' |
    sort -rV | tail -n +$((keep + 1)))"
  for old_tag in $old; do
    for key in $(curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      "$api?prefix=releases/$old_tag/&per_page=100" |
      node -e 'for (const o of JSON.parse(require("fs").readFileSync(0)).result) console.log(o.key)'); do
      echo "removing $key"
      npx -y wrangler@4 r2 object delete "$bucket/$key" --remote >/dev/null
    done
  done
}
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  prune || echo "pruning older versions failed; the mirror is complete"
else
  echo "no CLOUDFLARE_API_TOKEN: older versions left in place"
fi
