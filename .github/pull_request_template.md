<!--
Keep this focused on WHY. The commit bodies carry the detail; CI carries the
proof that it builds.
-->

## What and why

<!-- The problem this solves. If it fixes a bug, what the failure looked like
     from the user's side. -->

## Checked

<!-- `npm run check:all` runs all three. -->

- [ ] `npm run check`
- [ ] `npm run test:e2e`
- [ ] `npm run check:native`

## Exercised by hand

<!-- The e2e flows run the frontend against a stand-in backend; windows,
     dialogs, files and the built app are not covered (see docs/TESTING.md),
     so say what you actually ran. REQUIRED if this touches window management, drafts,
     the updater, or anything else that can lose the user's work. Screenshots
     for anything visible. -->
