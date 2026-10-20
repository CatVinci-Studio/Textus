# Faster local builds

Two things make working in many checkouts at once - git worktrees, one per
branch or per AI agent - slower than it needs to be: every worktree builds
the Rust crates from scratch into its own `src-tauri/target`, and
`npm run check` runs every unit test whatever you changed. Both have an
opt-in shortcut. Neither changes CI or the release build.

Measured on Linux (16 cores, other builds running, so a quiet machine is
faster), in a fresh copy of `main` on 2026-10-20:

| Step                                           | Time    |
| ---------------------------------------------- | ------- |
| `npm ci` (packages already in the npm cache)   | 2 s     |
| `npm run check`                                | 68-77 s |
| of which `npm test`                            | 30 s    |
| `cargo build`, first in a worktree             | 66 s    |
| `cargo build` after touching `lib.rs`          | 3 s     |
| `npm run check:native`, after that build       | 69 s    |
| `npm run check:native` after touching `lib.rs` | 11 s    |

A worktree's `src-tauri/target` grows to 9-11 GB once `check:native` has
run in it.

## One build directory for every worktree

Cargo's `build-dir` setting puts the intermediate files of a build - the
compiled dependencies, which are most of the time and space - in one place,
while the finished binaries stay in each worktree's `src-tauri/target`, where
`npm run tauri dev` and `scripts/smoke-linux.sh` look for them. Set it once,
in your shell's profile:

```sh
export CARGO_BUILD_BUILD_DIR="$HOME/.cache/textus-cargo"   # macOS, Linux
```

```powershell
setx CARGO_BUILD_BUILD_DIR "$env:LOCALAPPDATA\textus-cargo"  # Windows
```

Measured as above: the first `cargo build` in a second worktree took 12 s
instead of 52 s, and added 0.6 GB to the shared directory instead of 3.4 GB
of its own. Each worktree still keeps about 2.4 GB of finished binaries.

- Cargo locks the directory while it builds, so two worktrees building at
  the same moment take turns; the second waits with "Blocking waiting for
  file lock". Most builds after the first are short, so this costs less
  than building everything twice.
- Leave `CARGO_TARGET_DIR` alone. Sharing the whole target directory saves
  the same build time, but every worktree then writes its binaries over the
  others', and `tauri dev` in one worktree may run another's build.
- Keep it in your own environment, not in a committed
  `.cargo/config.toml`: CI and the release workflow build with Cargo's
  defaults, and CI's Rust cache saves `src-tauri/target`.
- `sccache` adds nothing here: it can't share the crates of this
  repository between worktrees (their paths differ), and the shared build
  directory already shares the dependencies.
- To start over, delete the directory; the next build fills it again.

## `npm run check:quick`

```sh
npm run check:quick                  # against origin/main
node scripts/check-quick.mjs --base origin/release/1.2.x
```

Runs the whole typecheck, then ESLint, Prettier and the unit tests for only
the files your branch changed since it left `origin/main`, committed or
not. The tests are the ones `vitest related` finds: changed test files and
the tests that import a changed file. The save round trip, which takes half
of `npm test`, runs only when the change can reach saving (the same rule as
CI, `reachesSaving` in `scripts/ci-changes.mjs`).

A change to one component took 13 s, one to a locale file 16 s (59 test
files import it), against about 70 s for `npm run check`; a change to the
editor or to `docs/` runs the round trip and took 52 s.

It's for the loop while you work. Run `npm run check` (or
`npm run check:all`) before you open a pull request: it also catches a test
that breaks without importing what you changed, and runs the README,
installer and updater checks.
