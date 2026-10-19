#!/bin/zsh
# Starts `npm run tauri dev` detached from the terminal it is run in: in its
# own session, adopted by launchd (a double fork). Closing the terminal tab
# no longer takes the app down with it - in dev the app quits when the
# `tauri dev` that launched it goes (main.rs's relaunch watchdog), which a
# closed tab caused and read as a crash. Everything it prints goes to
# ~/Library/Logs/textus-dev.log, so a real crash leaves its reason there.
cd "${0:A:h}/.." || exit 1
export PATH="$HOME/.cargo/bin:$PATH" RUST_BACKTRACE=1
log="$HOME/Library/Logs/textus-dev.log"
exec python3 -c '
import os, sys
if os.fork():
    sys.exit(0)
os.setsid()
if os.fork():
    sys.exit(0)
out = os.open(sys.argv[1], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
os.dup2(out, 1)
os.dup2(out, 2)
os.dup2(os.open("/dev/null", os.O_RDONLY), 0)
os.execvp("npm", ["npm", "run", "tauri", "dev"])
' "$log"
