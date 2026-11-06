# Release notes in the app

Settings › General › Release Notes lists every version's notes. The English
ones are `docs/releases/X.Y.Z.md`, the text of the GitHub release; this
folder holds their translations, one file per version, named like it:

- `zh/` - Simplified Chinese, for every version whose published notes are
  in English.
- `en/` - English, for the early versions (0.8.7 to 1.0.3) whose published
  notes are in Chinese.
- `zh-Hant/` - Traditional Chinese, for every version: the Simplified text
  converted with OpenCC (`s2twp`), then its words checked against
  `src/i18n/locales/zh-Hant.ts` (設定, 外掛, 唯讀, 在背景執行, 分割).

A translation keeps the published notes' headings and bullets, one for one,
names menus and settings as that language's interface does, and leaves out
the closing line about the installers. `changelog.test.ts` fails on a
published version without its translations, or on one whose bullets don't
match. The publication day goes in `../release-dates.ts`.

Interface languages other than these read the English notes.
