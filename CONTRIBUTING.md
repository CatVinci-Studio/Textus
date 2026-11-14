# Contributing to Textus

Thanks for wanting to help. Textus is made by a few people at CatVinci
Studio, and every fix or idea from outside makes a real difference. Write
to us in English or Chinese ([中文版](CONTRIBUTING.zh-CN.md)).

## Where to start

- **Issues ready for you:** [good first issue](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22good+first+issue%22+no%3Aassignee)
  and [help wanted](https://github.com/CatVinci-Studio/Textus/issues?q=is%3Aopen+label%3A%22help+wanted%22+no%3Aassignee),
  unclaimed ones first. Comment `/take` to claim one (one at a time); the
  bot assigns it to you. Open a draft pull request within 7 days; after 14
  quiet days it is released for someone else. `/untake` lets it go.
- **Translations:** [docs/dev/translating.md](docs/dev/translating.md).
- **A new feature?** Check whether it can be a plugin first: most new
  features, and anything that talks to an outside service, belong in
  [textus-plugins](https://github.com/CatVinci-Studio/textus-plugins), not
  in the app. The [roadmap](ROADMAP.md) lists what stays out of the core.
- **A bug fix:** send the pull request straight away. **A feature for the
  app:** open an issue first, so we can agree on it before you build it.

Small fixes (a typo, a broken link) need no issue and no claim.

## Getting set up

You need [Node.js](https://nodejs.org) 22+ (`.nvmrc`), [Rust](https://rustup.rs)
via rustup (`src-tauri/rust-toolchain.toml` picks the toolchain), and the
platform's build tools: Xcode Command Line Tools on macOS; the "Desktop
development with C++" workload on Windows; on Debian/Ubuntu
`sudo apt install libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf`.

```sh
git clone https://github.com/CatVinci-Studio/Textus.git
cd Textus
npm install
npm run tauri dev   # the full app, frontend hot-reloaded
npm run dev         # the frontend alone at http://localhost:1420, backend stubbed
```

The official plugins are served from a
[textus-plugins](https://github.com/CatVinci-Studio/textus-plugins)
checkout named `textus-plugins` beside this repository (or at
`TEXTUS_PLUGINS_DIR`); run `npm ci` in it once. [docs/README.md](docs/README.md)
lists every developer document, and
[architecture.md](docs/dev/architecture.md) maps the folders.

## Before you push

```sh
npm run check
```

That is all a pull request needs: types, lint, unit tests, formats and the
code-shape rules. CI runs the same on every pull request, plus the Rust
checks on Linux when `src-tauri/` changed. The e2e flows and the native
builds on all platforms run before each release; maintainers take care of
them. [docs/dev/code-style.md](docs/dev/code-style.md) has the rules and
what checks each; [testing.md](docs/dev/testing.md) says where a new test
goes.

## Pull requests

- Send it to `main`, from a branch named after what it does
  (`fix/pdf-margins`). We squash-merge, so the title is one plain sentence
  saying what changed and the description says why. `Closes #123` links
  the issue.
- Add a release note as a file of its own in
  [docs/releases/next/](docs/releases/next/README.md), unless users won't
  notice the change.
- Show anything visible with a screenshot or a short recording. If it
  touches the window bar, traffic lights, dragging, full screen or
  shortcuts, say so: we check it on a real Mac before release.
- Written with an AI assistant? Welcome - but read and understand every
  line, and say what you tested. AI assistants read [AGENTS.md](AGENTS.md).
- Leave CI and the test setup alone; a fork's change to `.github/` fails
  the `ci-config` check on purpose, and a maintainer takes it from there.

We reply to issues within a week and to pull requests within 3 days. If
we haven't, nudge us on the pull request: it slipped past us. Often we
merge a pull request into our own branch and finish small fixes there
ourselves, rather than sending it back.

## Stuck?

Ask. Open a draft pull request with what you have, or an issue, or find us
on [Discord](https://textus.md/discord) (English) or in the QQ and WeChat
groups listed in the README (Chinese). A half-finished pull request with a
question beats a finished one that went the wrong way.
