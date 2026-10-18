# Infrastructure

Everything outside this repository that keeps Textus running: the other
repositories, the automation, the website and downloads, and the secrets the
workflows use. If you're a maintainer taking something over, start here. No
secret values are in this file - only what each one is for and how to replace
it.

## Repositories

All under the [CatVinci-Studio](https://github.com/CatVinci-Studio) organization.

| Repository                                                                | What it is                                                                                        |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Textus](https://github.com/CatVinci-Studio/Textus)                       | The app. `main` is the working branch; `dev` is a locked snapshot; `archive/levis` is Levis 0.9.8 |
| [textus-themes](https://github.com/CatVinci-Studio/textus-themes)         | The theme gallery: themes shared through issue #1, reviewed with `/approve`                       |
| [homebrew-tap](https://github.com/CatVinci-Studio/homebrew-tap)           | The `catvinci-studio/tap/textus` cask, updated by the release workflow                            |
| [arch-repo](https://github.com/CatVinci-Studio/arch-repo)                 | The signed `[catvinci]` pacman repository that serves `textus-bin`                                |
| [levis-homepage](https://github.com/CatVinci-Studio/levis-homepage)       | textus.catvinci.com (the old name stuck)                                                          |
| [catvinci-homepage](https://github.com/CatVinci-Studio/catvinci-homepage) | catvinci.com                                                                                      |

## Automation

In this repository (`.github/workflows/`):

| Workflow                   | Runs                                                  | Does                                                                               |
| -------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ci.yml`                   | every pull request, pushes to `main` and `release/**` | `check`, `e2e`, `native` on three platforms, the iOS simulator build               |
| `release.yml`              | a `vX.Y.Z` tag, or by hand to rebuild one             | builds, signs and publishes the desktop release ([releasing.md](releasing.md))     |
| `arch-package.yml`         | from `release.yml`                                    | builds and tests the `textus-bin` package                                          |
| `mirror-downloads.yml`     | after a stable release, or by hand                    | copies the installers to the website's download bucket                             |
| `update-beta-manifest.yml` | after every release, rc included, or by hand          | points the beta update channel's `textus-beta.json` at the newest release          |
| `update-homebrew-tap.yml`  | after a stable release, or by hand                    | points the Homebrew cask at the new DMGs                                           |
| `update-arch-repo.yml`     | after a stable release, or by hand                    | asks `arch-repo` to serve the new `textus-bin`                                     |
| `ios-release.yml`          | an `ios-vX.Y.Z` tag                                   | builds the iOS app and uploads it to TestFlight ([ios-release.md](ios-release.md)) |
| `sync-models.yml`          | Mondays 03:00 UTC                                     | refreshes the AI providers' model lists and opens a pull request if they changed   |
| `audit.yml`                | Mondays 04:00 UTC                                     | checks npm and Rust dependencies for advisories; opens an issue if it finds any    |

Dependabot (`.github/dependabot.yml`) opens one grouped pull request a week
for npm and Rust updates and one a month for GitHub Actions.

Elsewhere:

- `textus-themes` runs **Publish themes** on every comment in the gallery
  issue, and **Test** on pushes.
- `arch-repo` runs **Sync**, which signs the package and updates the
  repository database.
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
  and `/join`.
- **catvinci.com** - project `catvinci-homepage`. A Worker handles the Join
  us form, and another forwards mail for studio@catvinci.com.

DNS for catvinci.com is managed in Cloudflare, by the owner only. Moving a
custom domain between projects has to be done in the dashboard: doing it
through the API leaves the DNS record behind and takes the site down.

## Secrets

Stored in **Settings › Secrets and variables › Actions** of this repository.
Losing or letting one expire stops a release, so each line says how to
replace it.

| Secret                                                      | Used by                        | Where it comes from, and how to replace it                                                                                            |
| ----------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `TAURI_SIGNING_PRIVATE_KEY` and `…_PASSWORD`                | release (updater signatures)   | Generated once with `tauri signer`. **Cannot be replaced**: installed apps only trust updates signed with it. Keep an offline backup. |
| `APPLE_CERTIFICATE`, `…_PASSWORD`, `APPLE_SIGNING_IDENTITY` | release (macOS signing)        | A Developer ID Application certificate exported as `.p12`. Check its expiry in **Apple Developer › Certificates**; renew before then. |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`               | release (notarization)         | The Apple ID, an app-specific password from account.apple.com, and the team ID. Replace the password if it's revoked.                 |
| `APPLE_API_ISSUER`, `APPLE_API_KEY_ID`, `APPLE_API_KEY_P8`  | iOS release                    | An App Store Connect API key (Admin). Doesn't expire; revoke and create a new one if it leaks.                                        |
| `TAP_DEPLOY_KEY`                                            | Homebrew update                | Private half of a write deploy key on `homebrew-tap`.                                                                                 |
| `ARCH_REPO_DEPLOY_KEY`                                      | Arch update                    | Private half of a write deploy key on `arch-repo`.                                                                                    |
| `CLOUDFLARE_API_TOKEN`                                      | download mirror, beta manifest | A Cloudflare API token with R2 edit on the account. Roll it in **My Profile › API Tokens** if it's ever exposed.                      |

`arch-repo` keeps its own package-signing key in its secrets; see its README.

## Routine checks

- Weekly: merge or close Dependabot's pull requests; read any issue the audit
  opened.
- Before each release: make sure the Apple certificate isn't about to expire.
- Every few months: delete merged branches and old pull requests, and look at
  the R2 bucket's size (each release adds about 150 MB).
