# The `textus` command

`textus` is the app's own binary, run by a small script that
`src-tauri/src/commands/cli.rs` installs (macOS `/usr/local/bin/textus`,
Windows `bin\textus.cmd`, the Linux AppImage `~/.local/bin/textus`; the .deb
and .rpm ship the binary as `/usr/bin/textus`). The script sets
`TEXTUS_CLI=1` so the binary knows a terminal started it.

## How a command line is read

`main()` calls `cli::entry()` (`src-tauri/src/cli/mod.rs`) before anything
else:

- No arguments, paths, flags or `textus://` links: the app, as before. From
  the script, the binary hands them on and returns at once (`open -a` on
  macOS, a detached process elsewhere, `cli/handoff.rs`); started by the
  system, it goes on to `run()`.
- A command from the table in `cli/table.rs`, `--help`/`-h`,
  `--version`/`-V`, or a bare word that names no file here: a command. It
  runs and the process exits before Tauri starts - no window, webview or
  plugin is loaded.

A command wins over a file of the same name; `./list` opens the file.

## Where a command runs

- **In the binary** (`cli/local.rs`): `help`, `version`, `list`, `read`,
  `search`, `new`, `move`. They use the AI project tools' walk, search and
  extraction (`ai/project/`, `extract/`), so `textus list` lists what the
  agent can read.
- **In the running app**: `commands`, `plugin`, `theme`, `skill`, `export`,
  and plugins' AI tools as `textus <plugin> <tool>`. The app starts a
  listener in setup (`cli/app.rs`): a Unix socket in the app's data folder
  (macOS) or `$XDG_RUNTIME_DIR` (Linux), owner-only and checked against the
  peer's uid, or a named pipe `\\.\pipe\textus-cli-<user>` on Windows. The
  command sends one JSON line and reads `{"out":…}`, `{"err":…}` and a final
  `{"exit":…}` (`cli/ipc.rs`). If no app answers, the command starts it and
  waits up to 30 seconds; plugin tools never start it.
- Skills and plugin tools are answered in Rust: the tools come from the same
  table the agent's tools do (`plugins/ai_tools.rs`), so a plugin's
  `contributes.aiTools` are terminal commands too. The rest go to a window
  (`src/app/cli-requests.ts`), which answers with `cli_respond`.
- `export` opens the document and runs the menu's export; its save dialog
  takes the terminal's target instead of asking
  (`commands/export.rs`), and the command waits for the file.

## Adding a command

Add a row to `COMMANDS` in `cli/table.rs` (help lists it from there), then
its arm in `cli::run`, or its handler in `src/app/cli-requests.ts` for one
the app answers. Output is plain text; a command that returns data takes
`--json`. Errors go to stderr with exit code 1, usage mistakes with 2.
