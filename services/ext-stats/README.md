# textus-ext-stats

How often plugins, themes and skills are installed, for the market to show.
Served at `https://textus.catvinci.com/api/ext/`.

- `GET download?kind=&id=&version=&event=` - the app downloads a package
  through this: it adds one to today's total and redirects (302) to the
  package. `kind` is `plugin`, `theme` or `skill`; `event` is `install`
  (the first time on this device), `reinstall` or `update`. A theme may name its
  stylesheet with `file` (default `theme.css`). The package's address is
  built from the catalogs' own patterns (a plugin's release, a skill on the
  `catalog` release, a theme's stylesheet in textus-themes), never taken from
  the request. The app still checks what it downloaded.
- `GET stats` - per kind and id: `installs` (first installs, ever),
  `installs30`, `updates30` and `updates30ByVersion`. Cached
  for an hour; the plugin and theme catalogs read it once a day.

Only a request whose `User-Agent` starts with `Textus` counts; anyone else is
still redirected. Nothing about the sender is kept: no address, no
identifier, no row per request - only daily totals by
`(day, kind, id, version, event)` in D1 (`DB`). When it can't be reached,
the app downloads straight from GitHub.

The tests run with the app's unit tests (`npx vitest run services`), over
SQLite with the migration.

## Setting up

From this folder, with `CLOUDFLARE_ACCOUNT_ID` set:

1. `npx wrangler@4 d1 create textus-ext-stats`, and put the `database_id` it
   prints in `wrangler.toml` in place of the placeholder.
2. `npx wrangler@4 d1 migrations apply textus-ext-stats --remote`.
3. `npx wrangler@4 deploy` (the route `textus.catvinci.com/api/ext/*`).

To try it locally: `npx wrangler@4 d1 migrations apply textus-ext-stats
--local`, then `npx wrangler@4 dev` and
`curl -A Textus/1.3.0 -i 'http://localhost:8787/api/ext/download?kind=skill&id=tighten&version=1.0.0&event=install'`.
