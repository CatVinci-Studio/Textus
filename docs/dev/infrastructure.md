# Infrastructure

Everything outside this repository that keeps Textus running: the other
repositories, the automation, the website and downloads, and the secrets the
workflows use. If you're a maintainer taking something over, start here;
who can do what is in [roles.md](roles.md). No
secret values are in this file - only what each one is for and how to replace
it.

## Repositories

All under the [CatVinci-Studio](https://github.com/CatVinci-Studio) organization.

| Repository                                                                      | What it is                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [Textus](https://github.com/CatVinci-Studio/Textus)                             | The app. `main` is the next version, `stable` the released one; older versions are tags (Levis 0.9.8 is `v0.9.8`) |
| [textus-plugins](https://github.com/CatVinci-Studio/textus-plugins)             | The official plugins and the market's catalog; merging to `main` publishes them                                   |
| [textus-plugin-sample](https://github.com/CatVinci-Studio/textus-plugin-sample) | A plugin to copy when starting one                                                                                |
| [textus-themes](https://github.com/CatVinci-Studio/textus-themes)               | The theme gallery: themes shared through issue #1, reviewed with `/approve`                                       |
| [homebrew-tap](https://github.com/CatVinci-Studio/homebrew-tap)                 | Retired: its `tap_migrations.json` moves old tap installs to Homebrew's official `textus` cask                    |
| [arch-repo](https://github.com/CatVinci-Studio/arch-repo)                       | The signed `[catvinci]` pacman repository that serves `textus-bin`                                                |
| [textus-website](https://github.com/CatVinci-Studio/textus-website)             | textus.catvinci.com                                                                                               |
| [catvinci-homepage](https://github.com/CatVinci-Studio/catvinci-homepage)       | catvinci.com                                                                                                      |

## Automation

In this repository (`.github/workflows/`):

| Workflow                   | Runs                                              | Does                                                                               |
| -------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ci.yml`                   | every pull request, pushes to `main` and `stable` | `check`, `e2e`, `native` on three platforms, the iOS simulator build               |
| `release.yml`              | a `vX.Y.Z` tag, or by hand to rebuild one         | builds, signs and publishes the desktop release ([releasing.md](releasing.md))     |
| `arch-package.yml`         | from `release.yml`                                | builds and tests the `textus-bin` package                                          |
| `mirror-downloads.yml`     | after a stable release, or by hand                | copies the installers to the website's download bucket                             |
| `update-beta-manifest.yml` | after every release, rc included, or by hand      | points the beta update channel's `textus-beta.json` at the newest release          |
| `update-arch-repo.yml`     | after a stable release, or by hand                | asks `arch-repo` to serve the new `textus-bin`                                     |
| `deploy-playground.yml`    | `release.yml`, after the newest stable release    | deploys textus.catvinci.com/playground/ at that tag ([below](#playground))         |
| `ios-release.yml`          | an `ios-vX.Y.Z` tag                               | builds the iOS app and uploads it to TestFlight ([ios-release.md](ios-release.md)) |
| `sync-models.yml`          | Mondays 03:00 UTC                                 | refreshes the AI providers' model lists and opens a pull request if they changed   |
| `audit.yml`                | Mondays 04:00 UTC                                 | checks npm and Rust dependencies for advisories; opens an issue if it finds any    |

Dependabot (`.github/dependabot.yml`) opens one grouped pull request a week
for npm and Rust updates and one a month for GitHub Actions.

Elsewhere:

- `textus-themes` runs **Publish themes** on every comment in the gallery
  issue, and **Test** on pushes.
- `arch-repo` runs **Sync**, which signs the package and updates the
  repository database.
- Homebrew's bot bumps the official `textus` cask
  (`Casks/t/textus.rb` in `Homebrew/homebrew-cask`) after each stable
  release; nothing here pushes to it.
- Two webhooks on this repository post to the studio's Discord server: new
  releases to `#textus-releases`; issues, pull requests and stars to
  `#textus-github`.

## Website and downloads

Both sites are Cloudflare Pages projects that deploy on every push to their
repository's `main`:

- **textus.catvinci.com** - project `textus-homepage`. Its Functions also
  serve `/download/` from the R2 bucket `textus-downloads` (filled by
  `mirror-downloads.yml`, and `textus-beta.json` by `update-beta-manifest.yml`),
  and the short links `/discord`, `/qq`, `/wechat`
  and `/join`. The bucket's `manifest.json` names the newest stable
  release's installers under the keys the download page uses: `mac`,
  `mac-intel`, `windows`, `linux`, `deb`, `rpm`, and from 1.1.0
  `windows-arm64`, `linux-arm64`, `deb-arm64`, `rpm-arm64`
  (`scripts/mirror-keys.mjs`; the files are listed in
  [releasing.md](releasing.md#installers)). Keep existing keys as they are:
  the site reads them.
- **catvinci.com** - project `catvinci-homepage`. A Worker handles the Join
  us form, and another forwards mail for studio@catvinci.com.

### Playground

**textus.catvinci.com/playground/** is not part of the website's Pages
project: it is the Cloudflare Worker `textus-playground`, static assets only,
on the route `textus.catvinci.com/playground*` (zone catvinci.com). Its
configuration is `wrangler.playground.jsonc`; `npm run build:playground`
writes the page into `dist-playground/playground/`, and the Worker serves
`dist-playground/` as the site root, so the files keep their `/playground/`
paths. `deploy-playground.yml` builds it at a release tag and deploys it,
then checks that the live page names the script it just built.
`release.yml` calls it after publishing the newest stable release, so the
playground follows the latest stable version, not `main`. Run it by hand
with a tag to redeploy one.

The route isn't in the configuration: the deploy token can't change routes,
and a deploy without one leaves it as it is. Change it in the dashboard,
under **Workers & Pages › textus-playground › Settings › Domains & Routes**.

The workflow deploys with `CLOUDFLARE_PLAYGROUND_TOKEN`, an API token with
**Workers › Editor** on the account and no zone rights: it can upload the
Worker's versions and assets, not touch routes or DNS. To roll it, create a
new token with the same permission in **My Profile › API Tokens**, put it in
the secret, run the workflow by hand, then delete the old token.

DNS for catvinci.com is managed in Cloudflare, by the owner only. Moving a
custom domain between projects has to be done in the dashboard: doing it
through the API leaves the DNS record behind and takes the site down.

## Secrets

Stored in the repository's **release** environment (**Settings ›
Environments › release**), which only `v*` and `ios-v*` tags - pushed by
owners ([roles.md](roles.md)) - can run jobs in. Losing or letting one expire
stops a release, so each line says how to replace it.

| Secret                                                      | Used by                        | Where it comes from, and how to replace it                                                                                            |
| ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY` and `…_PASSWORD`                | release (updater signatures)   | Generated once with `tauri signer`. **Cannot be replaced**: installed apps only trust updates signed with it. Keep an offline backup. |
| `APPLE_CERTIFICATE`, `…_PASSWORD`, `APPLE_SIGNING_IDENTITY` | release (macOS signing)        | A Developer ID Application certificate exported as `.p12`. Check its expiry in **Apple Developer › Certificates**; renew before then. |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`               | release (notarization)         | The Apple ID, an app-specific password from account.apple.com, and the team ID. Replace the password if it's revoked.                 |
| `APPLE_API_ISSUER`, `APPLE_API_KEY_ID`, `APPLE_API_KEY_P8`  | iOS release                    | An App Store Connect API key (Admin). Doesn't expire; revoke and create a new one if it leaks.                                        |
| `ARCH_REPO_DEPLOY_KEY`                                      | Arch update                    | Private half of a write deploy key on `arch-repo`.                                                                                    |
| `CLOUDFLARE_API_TOKEN`                                      | download mirror, beta manifest | A Cloudflare API token with R2 edit on the account. Roll it in **My Profile › API Tokens** if it's ever exposed.                      |
| `CLOUDFLARE_PLAYGROUND_TOKEN`                               | playground deploy              | A Cloudflare API token with Workers edit on the account, no zone rights. Rolling it: [Playground](#playground).                       |

`arch-repo` keeps its own package-signing key in its secrets; see its README.

## Routine checks

- Weekly: merge or close Dependabot's pull requests; read any issue the audit
  opened.
- Before each release: make sure the Apple certificate isn't about to expire.
- Every few months: delete merged branches and old pull requests, and look at
  the R2 bucket's size (each release adds about 250 MB: the two AppImages
  are most of it).
