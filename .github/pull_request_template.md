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

## Window and layout

<!-- REQUIRED if this touches the window bar or title bar, traffic lights,
     dragging, full screen, the sidebar or AI panel's layout or motion, or
     keyboard shortcuts. The e2e flows can't see these. Delete otherwise. -->

- [ ] Ran the built app on macOS, windowed and full screen
- [ ] Ran it on Windows / Linux (say which), or it doesn't change there
- Recording:

## Exercised by hand

<!-- The e2e flows run the frontend against a stand-in backend; windows,
     dialogs, files and the built app are not covered (see docs/dev/testing.md),
     so say what you actually ran. REQUIRED if this touches window management, drafts,
     the updater, or anything else that can lose the user's work. Screenshots
     for anything visible. -->
