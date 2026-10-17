#!/usr/bin/env bash
# Temporary: a fresh-install dev window to preview the first-run tutorial.
set -euo pipefail
cd "$(dirname "$0")/.."
home="$PWD/.tutorial-preview/home"
mkdir -p "$home/data" "$home/config" "$home/cache" "$home/state"
export XDG_DATA_HOME="$home/data" XDG_CONFIG_HOME="$home/config"
export XDG_CACHE_HOME="$home/cache" XDG_STATE_HOME="$home/state"
exec npx tauri dev
