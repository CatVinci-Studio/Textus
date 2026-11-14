# Code style

The rules the code keeps, each with what checks it. `npm run check` runs
every script named here; a rule marked _review_ has no script, and a
maintainer looks for it in the pull request. Formatting is Prettier,
rustfmt and `.editorconfig`, so it is never worth discussing.

## Where code goes

[architecture.md](architecture.md) maps the folders and the layers they sit
in. A folder never imports from a layer above it, and Tauri is reached only
through `src/platform/` (ESLint). [recipes.md](recipes.md) walks through
the common additions (a setting, a menu item, a backend command, a string,
a plugin API call, an e2e test); [reuse.md](reuse.md) lists the one place
for each common need. Interface rules (spacing, type sizes, buttons,
menus, motion) are in
[design-language.md](../design/design-language.md).

## Code shape

| Rule                                          | Checked by                            |
| --------------------------------------------- | ------------------------------------- |
| At most 500 lines a file                      | `check-code-shape.mjs`                |
| At most 8 hooks a component                   | `check-code-shape.mjs`                |
| No provider id compared outside its adapter   | `check-code-shape.mjs`                |
| No import cycles                              | `check-cycles.mjs`                    |
| No copied run of code instead of a shared one | `check-duplicates.mjs`                |
| No unused file, export or dependency          | `knip`                                |
| Pure logic inside, side effects outside       | _review_                              |
| Dead code goes                                | _review_, `knip` for the obvious part |

**500 lines a file.** A file past it is doing more than one job, so split
it along its jobs, never by line count: interpreting data apart from
drawing it, state apart from the actions on it, a toolbar apart from what
it controls. Moving types or unrelated hooks out only to get under the
limit doesn't count. Tests, the dev shim (`src/dev/`), `live_eval/`, the
translation tables, the icon table and the generated bindings are exempt.
Rust tests sit inline in `#[cfg(test)] mod tests`, or in a `tests.rs`
beside the module once they would push it past the limit; inline tests
count towards the module's lines. The script's exception lists are empty
and stay so.

**8 hooks a component.** A component reads its feature's state and draws
it. Past 8 hooks it is doing several things: each concern becomes a hook
named for it (`useFloatingList`, `useComposerInput`, `useRowDrag`), in the
component's file or beside it.

**Pure logic inside, side effects outside.** Deciding what happens - what
the tags in a reply become, where a margin card stands, what a stored
setting means - is a pure function of its inputs, in a module of its own,
with unit tests. Reading the DOM, calling the backend, timers and
listeners stay at the edge, in a hook or command that calls the pure part.

**Data, not ifs.** What one AI provider does differently - a parameter, a
name, a model list, a sign-in - is written in the catalog
(`src-tauri/src/ai/catalog.rs`), `aicompat`'s `capabilities.rs` or a table
beside the code that reads it. More generally, a new `if` in shared code
to serve one caller usually means the fix is at the wrong depth: deepen
the mechanism instead.

**One owner per piece of state.** Tabs, islands and focus each live in one
model; a second copy kept in sync by hand is a bug waiting to happen
(_review_).

## Interface code

| Rule                                                                      | Checked by                                    |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| Colours, shadows, radii from tokens; spacing on the 4-point grid          | `check-design-values.mjs`                     |
| Text sizes from the type scale (`--text-*`)                               | `check-text-sizes.mjs`                        |
| Sizes set from script follow the interface size                           | `check-sizes.mjs`                             |
| The window frame is laid out by the engine, never read back from the page | `check-layout-reads.mjs`                      |
| Text fields are rounded rectangles, not capsules                          | `check-field-shapes.mjs`                      |
| Nothing new in the startup chunk                                          | the build (`vite.startup-budget.ts`, 1.25 MB) |
| Every control has a name; keyboard works                                  | `e2e/a11y.spec.ts`, _review_                  |

## Comments and names

**Comments explain why, not what.** One or two lines that record a
constraint, a rejected alternative, or a bug a future edit would bring
back. Don't restate the code, and don't cite issues, plans or past
versions: the commit history has those. Match the density of the file
you are editing.

**Cross-language contracts point at each other.** A shape that exists in
both Rust and TypeScript (`ChatAttachment`, `AgentTurn`, `StreamEvent`,
`ProviderCatalogEntry`, the chat-window protocol) carries a comment on
each side naming the other.

**Names.** Files `kebab-case.ts`, React components `PascalCase.tsx`, tests
`name.test.ts` beside the file they test, e2e specs `name.spec.ts`, Rust
modules `snake_case.rs`, scripts `verb-noun.mjs`. A test is named as the
claim it makes (`falls back to the default model`), not the function it
calls.

## Writing

**Interface text** is in ten languages (`src/i18n/locales/`: en, zh,
zh-Hant, ja, ko, es, fr, de, ru, pt); `npm run check` fails if a string is
missing from one. Put a new key beside its feature's keys, not at the end
of the file. If you only know some of the languages, put English in the
others and say so in the pull request; we'll translate.
[recipes.md](recipes.md#add-a-ui-string) has the steps,
[translating.md](translating.md) a whole new language.

**Documentation and release notes** are in English, plain words and short
sentences, what happens and then why. No marketing ("seamless",
"powerful"), no filler ("This document describes…").

- One `#` heading per file; headings in sentence case.
- UI paths in bold with › between steps: **Settings › Theme**; on-screen
  words in bold exactly as shown: **Copy link**.
- Code, file names, commands and settings keys in backticks. Shortcuts as
  `Ctrl/⌘ + Shift + E`. Versions as `1.0.4`, dates as `2026-10-17`.
- Relative links inside this repository, full URLs otherwise.

**Release notes.** A pull request adds its note as a file of its own in
[docs/releases/next/](../releases/next/README.md), named after the change
(`pdf-page-numbers.md`), with the section heading and one bullet:

```md
### Fixed

- Keeps the caret where it was when you switch tabs. (#123)
```

Sections are New, Improved, Fixed, Platform notes; one change per bullet,
starting with a verb, saying what the user notices, the issue or pull
request at the end. The release collects the fragments into
`docs/releases/X.Y.Z.md` ([releasing.md](releasing.md)), so pull requests
never edit the same lines.

**The README** (`README.md` and nine translations) is for users. The
translations keep the English file's headings, code blocks and links
(`check-readmes.mjs`).
