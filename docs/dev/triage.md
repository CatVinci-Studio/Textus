# Triage

Twice a week, fifteen minutes each.

- Give every new issue one `area:` label and one state: `needs repro`,
  `needs info` or `accepted`. Split an issue that mixes several things.
- A small, well-understood job becomes a `good first issue` or
  `help wanted`, written in the shape below. A feature that fits a plugin
  moves to textus-plugins as a `plugin idea`.
- Close `needs info` after 30 days without an answer, politely, by hand.
- Answer outside pull requests within 3 days. We often merge one into our
  own branch and finish it there rather than send it back.
- Each minor release: update [ROADMAP.md](../../ROADMAP.md) and thank
  outside contributors by name in the release notes.

## A newcomer issue

Check it against the current app and plugins first: the files exist, the
feature isn't already a plugin. Then write:

- **What** to change, and **why** it matters to someone using Textus;
- **Files** to look at;
- **Done when**: what is true afterwards;
- **How to test** it (`npm run check`, a screenshot, a command);
- **Out of scope**: what not to touch;
- **Size**: S (an hour or two) or M (an afternoon);
- **Questions**: here or on [Discord](https://textus.md/discord); comment
  `/take` to claim it.
