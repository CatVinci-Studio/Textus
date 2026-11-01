# Roles and access

Who can do what in the [CatVinci-Studio](https://github.com/CatVinci-Studio)
organization's Textus repositories, and how each kind of person takes part.
GitHub's settings are the source of truth; this page says what they are set
to and why. If they disagree, the settings win and this page is out of date.

## Roles

| Role            | Who                                                                  | GitHub role                                                             |
| --------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Owner**       | The organization's owners: @ChengAoShen (studio founder) and @jzzzzh | Organization owner; Admin on every repository                           |
| **Maintainer**  | The `textus-maintainers` team                                        | Maintain on Textus, textus-plugins, textus-themes, textus-plugin-sample |
| **Member**      | Everyone else in the organization                                    | Read on every repository (the organization's default)                   |
| **Contributor** | Anyone on GitHub                                                     | None: works from a fork                                                 |

The organization requires two-factor authentication, and members can't create
repositories.

### Owner

- Merges to `main` and `stable` without a second review (CI still has to
  pass: nobody bypasses it).
- Pushes release tags (`v*`, `ios-v*`). Only these tags can run jobs in the
  **release** environment, which holds the signing, notarizing, upload and
  deploy secrets ([releasing.md](releasing.md#secrets)). Pushing a tag is
  releasing.
- Changes repository settings, rulesets, environments, secrets and team
  membership.
- Is a code owner ([`.github/CODEOWNERS`](../../.github/CODEOWNERS)): CI,
  release tooling, app identity, permissions, signing and packaging need an
  owner's review.
- Holds the accounts outside GitHub: Apple Developer and App Store Connect,
  Cloudflare (DNS, R2, Pages, Workers), Homebrew and winget submissions
  ([infrastructure.md](infrastructure.md)). Only @ChengAoShen holds these.

### Maintainer

- Pushes branches to the repository instead of a fork.
- Reviews, labels, assigns and closes issues and pull requests.
- Merges a pull request into `main` or `stable` once CI passes and **someone
  else** with write access has approved it, after the last push, with every
  review thread resolved. A change to a code-owned path needs an owner's
  approval.
- In textus-plugins, merges to `main` without a review; merging publishes the
  plugins (see that repository's README), so ask an owner first for anything
  users will notice.
- In textus-themes, answers theme submissions with `/approve <id>` and
  `/remove <id>` on the gallery issue (any login with write access counts).
- Can't push release tags, change settings or see secrets.

### Member

- Reads every repository, including the private ones (textus-website).
- Takes part like a contributor: forks, opens issues and pull requests, and
  reviews. A member's approval is welcome but doesn't count towards the
  required review; a maintainer's or owner's does.

### Contributor

- Opens issues and discussions, and pull requests from a fork, all against
  `main` ([CONTRIBUTING.md](../../CONTRIBUTING.md#branches-and-pull-requests)).
- A fork's pull request that changes `.github/` or the test setup fails the
  `ci-config` check on purpose; a maintainer takes it from there.
- Themes are shared as a comment on the gallery issue
  ([textus-themes](https://github.com/CatVinci-Studio/textus-themes)); plugins
  from another repository are listed through a pull request to
  textus-plugins' `community/`
  ([LISTING.md](https://github.com/CatVinci-Studio/textus-plugins/blob/main/LISTING.md)).

## Branch rules

| Repository     | Branch              | Rules                                                                                                                       |
| -------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Textus         | `main`, `stable`    | Pull request only; `check`, `e2e`, `native`, `ci-config` must pass; one approval (owners bypass); no force push or deletion |
| Textus         | tags `v*`, `ios-v*` | Only owners create, move or delete them                                                                                     |
| textus-plugins | `main`              | Pull request only, no review required; no force push or deletion                                                            |
| textus-themes  | `main`              | No force push or deletion; the gallery's bot commits submissions directly                                                   |
| textus-website | `main`              | Private; owners push, members read                                                                                          |

Every repository merges by squash only: the pull request's title and
description become the commit, so write them as one. Merged branches are
deleted automatically.

## Changing someone's role

An owner changes it in **Organization › People** (owner or member) or
**Organization › Teams › textus-maintainers** (maintainer), then updates this
page in the same week. Adding an owner also means adding them to
`.github/CODEOWNERS` and deciding which outside accounts they need.
