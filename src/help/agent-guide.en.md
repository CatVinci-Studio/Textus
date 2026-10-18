# Textus AI Features Guide

Textus has a built-in AI made for writing, Textus AI: completion, grammar checking, and conversations that read and revise your document. This guide covers connecting a service, the AI features, and how to shape Textus AI into your own writing assistant with a project folder, a style profile, a library, writing instructions and skills.

## Connecting a service

1. Open **Settings > Textus AI** and choose the service you want under **Connection > Provider**.
2. Expand **Login & credentials** and sign in to your account or enter an API key, whichever that service supports.
3. For a **Custom Endpoint** (any OpenAI-compatible server: local models, proxies), enter the base URL, a key if it needs one, and the model name, then save.
4. Pick the writing model under **Writing Assistance** and the chat model under **Textus AI Chat**.

Signing in happens in your browser. Whether images, web search and document edits are available depends on the service and model you choose.

The built-in model list only holds each provider's defaults (for Anthropic: Claude Sonnet 5.5 for chat, Claude Haiku 5.5 for completion and grammar). Press **Fetch Models** on the Model List row under **Connection** to load the provider's current list and choose any model from it.

Shortcuts below use macOS notation; on Windows and Linux, read Cmd as Ctrl and Option as Alt. If you have changed a shortcut, **Settings > Shortcuts** has the current one.

## The AI features

### 1. Completion

As you type, a gray continuation appears at the cursor — press <kbd>Tab</kbd> to accept it, or <kbd>Cmd</kbd>+<kbd>→</kbd> to accept just the next word and keep the rest on offer. <kbd>Esc</kbd> dismisses it. There's no minimum amount of text required; it's ready from the very first sentence of a document.

Ask for one explicitly with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> or the context menu (the cursor must be at the end of a paragraph): you get a longer continuation with up to three alternatives — <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd> cycle through them.

Under **Settings > Textus AI > Writing Assistance** you can pick a **completion tone** (match the document / formal / casual / academic / concise). When the document belongs to a project with a style profile or library (see **Make Textus AI yours** below), completion follows them too.

### 2. Grammar check

Possible issues get underlined. Hover over one, or move the caret into it, to see the explanation; **Apply** (or <kbd>Option</kbd>+<kbd>Enter</kbd> with the caret on it) takes the fix, **Ignore** dismisses it. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> checks the current paragraph immediately.

### 3. The AI panel

The full conversation lives in a panel on the right side of the editor. Open or close it with the chat button at the right end of the window bar or <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>.

- **One conversation per document**: each tab has its own conversation, and switching tabs switches the panel with it. **New conversation** in the panel's header starts over (with edits still undecided, it asks first).
- **Modes**: the composer has **Ask**, **Edit** and **Plan**. The panel starts in the mode set under **Settings > Textus AI > Textus AI Chat > Default mode**.
- **@-mentions**: type `@` in the input to pick a text file from the project folder; it is attached to the message.
- **Attach files**: the **+** button on the left of the input attaches a PDF, Word document, PowerPoint deck, spreadsheet, image, or plain text file to that message. Everything except images is extracted to text locally and travels inside the message; images are sent as real images to providers that can see (ones that can't say so up front rather than dropping them silently). A long file is sent only in part, and the chip says "(shortened)" when that happens.
- **Web search**: once enabled in **Settings > Textus AI > Textus AI Chat** (for providers that offer it), Textus AI can search the web on its own when a request needs it.
- **History**: the sidebar's **Chats** tab stores past conversations. Click one to reopen it in the current editor and continue.
- **Errors**: when a request fails, the chat says what kind of problem it is and what to do (check the key, wait a moment, pick another model) above the provider's own message.

**Open in a separate window** in the panel's header moves the conversation into its own window — handy on a second monitor. That window follows you: switch tabs or windows and its document, title and selection follow, and the edits it proposes land in whichever file you are actually editing. There is only ever one per editor window; **📌** in its header keeps it above the editor.

### 4. Quick Ask

Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (or right-click > Ask AI…) to open a small chat bar right below the paragraph you are in. It sits in the document, pushing the text below it down rather than covering it. If text was selected when you opened it, the selection is included. Quick Ask opens in **Edit** mode, because it is usually opened on a passage to change it ("shorten this"); Ask is one click away in the mode picker.

- **The shortcut again**: pressing <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> while the bar is open moves the cursor to its input; pressing it once more from the input closes it. <kbd>Esc</kbd> anywhere in the bar closes it too, and the cursor goes back to the document. With edits still undecided, closing (or starting a new conversation) asks first.
- Quick Ask keeps its own short conversation, separate from the panel's and not saved to History. It opens even while the panel is open. **Continue in the full conversation** (the button in its corner) hands the exchange to the AI panel, where it carries on and is saved. Turn on **Settings > Textus AI > Advanced > Open full conversations in a separate window** to send it to a separate window instead.

### 5. Edits in the document

The chat never writes to your document directly. When you ask a tool-calling provider to change the document, each change is a proposal shown right where it would land: removed text is struck through, new text appears as a green insert. Nothing touches the document until you accept, and <kbd>Cmd</kbd>+<kbd>Z</kbd> undoes an accepted edit in one step.

- **Accept / Reject**: from the floating bar next to the edit, the proposal's card in the panel, or the keyboard — <kbd>Cmd</kbd>+<kbd>Return</kbd> accepts, <kbd>Cmd</kbd>+<kbd>Delete</kbd> with the caret on the edit rejects. Several proposals in one reply preview at once; step between them with ‹› and use Accept all / Reject all.
- **Reasons**: each proposal card says why Textus AI made that change.
- **Only some sentences**: when a proposal rewrites several sentences, its card offers "N sentence changes · choose" — tick the ones you want and press **Accept selected**.
- **At the cursor**: with nothing selected, Textus AI knows where your cursor is, so "write a transition here" inserts exactly there.
- **Comments instead of edits**: ask for a review ("what's weak here?") and Textus AI pins comments to passages without changing them. Each comment card has **Show in document**, which selects the passage it is about.

## Make Textus AI yours

Textus AI learns about you and your work from a few plain Markdown files, not from hidden settings. Each has one job:

| Concept | What it is | Where it lives |
| --- | --- | --- |
| **Project folder** | The folder Textus AI works in and may read | The document's folder, or one you choose |
| **Style profile** | How you write | `.textus/style.md` |
| **Library** | Facts about people, places and terms | `.textus/library/` |
| **Writing instructions** | Standing rules for every conversation | `agent.md` — global, and per project |
| **AI remembered** | What Textus AI keeps from your conversations | `.textus/memory/`, and `memory/` in the global config folder |
| **Skills** | Reusable instructions you call with `/name` | `skills/` — global, and per project |
| **Global config folder** | What applies to every document | The app's settings folder |

"Conversations" below means the AI panel and Quick Ask. Here is a whole project at a glance:

```
my-novel/                ← the project folder
├── chapter-1.md         ← the document you are editing
├── notes/
│   └── timeline.md      ← reference material Textus AI can read
└── .textus/              ← the project's own settings
    ├── style.md         ← style profile
    ├── agent.md         ← writing instructions for this project
    ├── library/
    │   ├── lin-wan.md   ← one entry per character, place or term
    │   └── harbour-city.md
    └── skills/
        └── polish.md    ← one skill per file
```

The project menu creates `.textus/` and its files for you the first time you ask for them; project skills are the only thing you add by hand. Text inside `<!-- -->` comments in any of these files is a note to yourself and is never sent.

### The project folder

**The project folder is the folder Textus AI works in.** By default it is the folder of the document you are editing — or the nearest folder above it that has a `.textus/` folder, so a chapter in `novel/part-1/` belongs to `novel/`: save a document, and its folder becomes the project folder.

- Textus AI can list, read and search the text files in it (Markdown, plain text and similar formats) to find a character's earlier scenes, a term, or your notes. Hidden files and folders, build and dependency folders (such as `node_modules`) and files over 100 KB are left out.
- Typing `@` in the chat input attaches one of its files to your message.
- Its `.textus/` folder holds the project's style profile, library, writing instructions and skills.

The bar under the AI panel's header shows the project folder's name; click it for the **project menu**. When your reference material doesn't live next to the draft, use **Choose project folder…** there (or **Settings > Textus AI > Project Folder**). The folder you choose is used for every document — unsaved drafts included — until you pick **Use the document's folder** again.

> [!TIP]
> Your draft is in `thesis/drafts/` and your interview notes in `thesis/research/`? Choose `thesis/` as the project folder, and Textus AI can read `research/interviews.md` while you work on `drafts/chapter-2.md`.

Everything Textus AI reads must be inside the project folder: `..`, absolute paths and links pointing outside are refused. An unsaved draft has no project folder unless you have chosen one, and a folder that is too broad — your home folder or a whole drive — is refused.

### The style profile — "Learn my style"

**The style profile describes how you write**, so that continuations and edits sound like you: voice and tone, sentence rhythm, word choice, punctuation, things you never do. Textus AI follows it in conversations, and completion follows it as you type, in every document of the project. It is the file `.textus/style.md`.

There are two ways to make one, both in the project menu:

- **Learn my style from samples…** — pick a few files of your own writing (up to eight). Textus AI studies them and drafts a profile — voice and tone, sentences and rhythm, word choice, punctuation, structure, what you never do, and a few short quotes as examples — then opens it in a new tab. Read it, correct it, add to it: it is yours. Learning again keeps the previous profile as `style.previous.md`.
- **Create style profile** — start from an empty outline and write it yourself.

Once there is a profile, the **Style** chip next to the folder name opens it.

```markdown
# Style profile

## Sentences and rhythm
- Short sentences, rarely over 15 words.
- Opens a paragraph with a concrete scene, then the point.

## Never
- No exclamation marks. No "suddenly".
```

Concrete, checkable points work better than adjectives: "short sentences, rarely over 15 words" rather than "concise". Keep it to a page or two; only the first 6,000 characters are used. The **completion tone** in Settings applies as well — leave it on *Match the document* when your style profile already describes your voice.

### The library

**The library holds facts that must stay consistent**: one Markdown file per character, place or term, in `.textus/library/`. **New library entry…** in the project menu asks for a name and opens the new entry; the **Library** chip shows how many there are.

```markdown
---
name: Lin Wan
aliases: [Wan, Ms Lin]
include: detected
---

Protagonist, 32, teaches Chinese at a secondary school in Harbour City.
Left-handed. Never talks about her brother.
```

You don't attach entries yourself. An entry with `include: detected` (the default) goes to Textus AI whenever its name or one of its aliases comes up: in your message or the document during a conversation, in the text around the cursor during completion. `always` sends it with every request; `never` keeps it out. Entries that aren't mentioned cost nothing, so the library can grow as large as your project needs.

### Writing instructions (agent.md)

**Writing instructions are standing rules sent with every conversation**: what the project is, which language to reply in, spellings and terms, things Textus AI should always or never do. They live in files called `agent.md`, at two levels:

- **Global**, for every document: **Settings > Textus AI > Writing Instructions (agent.md) > Edit agent.md**.
- **Project**, for the documents of one project: `.textus/agent.md`, opened with **Edit project writing instructions** in the project menu.

Both open in a tab and start with a short how-to in comments. When both exist, Textus AI gets both — the global instructions first, then the project's — and where they disagree, the project's win.

```markdown
The book is a mystery set in 1930s Shanghai, told by Lin Wan in the first person.
Always reply in English, even though the novel is in Chinese.
Spell it "Harbour City", never "Harbor City".
```

Writing instructions apply to conversations only. Completion doesn't read them; it follows the style profile and the library.

### What Textus AI remembers

**Textus AI remembers what you ask for and how you write**, without you writing a file. When you tell it something that should hold beyond one request — "always use British spelling", "no em dashes", a correction you had to make twice — or a fact about your work, such as who a character is, it keeps it and follows it in later conversations. Each time, a line under its reply says what it remembered and where: **Undo** takes it back, and **Make personal** or **Make project** moves it.

- **This project**: what is about this work, in `.textus/memory/`; facts about people, places and terms go into the library.
- **For all projects**: your general habits, in `memory/` in the global config folder. Without a project folder, everything goes here.

The AI panel's **Memory** tab lists it all under **AI remembered**, with when and in which conversation each was remembered: **Edit** opens it, **Delete** removes it. Your own writing instructions win when the two disagree, and Textus AI never changes your `agent.md` or style profile. When there are too many memories to send, the oldest are left out and the Memory tab says so. **Settings > Textus AI > Remember automatically** turns it off.

### Skills (/name)

**A skill is a reusable set of instructions with a name** — "polish", "outline", "check the citations" — kept in one Markdown file: a name and a one-line description at the top, the full instructions below.

```markdown
---
name: polish
description: Tighten the selected passage without changing its meaning
---

Polish the given text sentence by sentence: cut redundant words,
split overlong sentences, and keep the original meaning and voice.
Output only the polished text.
```

Use a skill in either of two ways:

1. **Call it**: type `/` in the chat input and pick it from the menu, or type its name followed by your request: `/polish take another look at this`.
2. **Just ask** (tool-calling providers only): Textus AI knows every skill's name and description, and when your request matches one, it loads the full instructions and follows them by itself.

Skills live at the same two levels as writing instructions: global skills in the `skills/` folder of the global config folder (**Settings > Textus AI > Skills > Import Skill…** copies a skill file there), project skills in `.textus/skills/` (a hidden folder — in macOS Finder, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> shows it). A project skill with the same name as a global one replaces it.

### Built-in skills

Textus comes with 18 skills for common writing jobs. The `/` menu groups them as **Write** (continue the story, describe a scene or character, polish dialogue, imitate a style), **Revise** (expand, tighten, change tone, remove AI tone, translate and polish), **Check** (proofread, check continuity) and **Formats** (email, notice or official document, meeting minutes, academic polish, social post, headline, summary). Type `/` and pick one, or type its name in any of the app's languages: `/proofread`, `/校对` and `/校正` call the same skill. Textus AI also picks most of them by itself when your request matches one; **Expand**, **Tighten**, **Change tone** and **Summarize** run only when you call them.

**Settings > Textus AI > Built-in skills** lists them all. The switch turns one off: it leaves the `/` menu and Textus AI stops using it. **Customize…** copies the skill into the `skills/` folder of the global config folder and opens the copy, so you can change its instructions; from then on your copy runs instead. **Reset** deletes the copy and brings the built-in version back. A skill of your own with a built-in skill's name replaces the built-in one.

### Writing conventions

**Settings > Textus AI > Writing Assistance > Writing conventions** decides which punctuation, spacing and number rules Textus AI and the grammar check follow. **Automatic** uses the national standard where a language has one (GB/T for Simplified Chinese, JTF for Japanese, for example); elsewhere it follows what your document already does most and points out only inconsistencies. Pick a profile, such as Simplified Chinese **Fiction** or English **UK · GOV.UK**, and documents in that language are held to it.

A project can choose its own: add a `conventions:` line between the two `---` lines at the top of its style profile (`.textus/style.md`). For that project's documents it wins over the setting.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### The global config folder

**The global config folder holds what applies to every document**: your global `agent.md` and your global skills. It belongs to the app, not to any project; **Settings > Textus AI > Global Config Folder > Open Folder** shows it.

```
agent/                ← the global config folder
├── agent.md          ← global writing instructions
└── skills/
    └── outline.md    ← a global skill
```

There is no global style profile or library: those describe one body of work, so they belong to a project.

### Which applies when

| | Conversations | Completion | Grammar check |
| --- | :---: | :---: | :---: |
| Project files (read, search, `@`) | ✓ | | |
| Style profile | ✓ | ✓ | |
| Library entries that come up | ✓ | ✓ | |
| Writing instructions | ✓ | | |
| What Textus AI remembered | ✓ | | |
| Skills | ✓ | | |
| Completion tone (Settings) | | ✓ | |

- **Global, then project.** Writing instructions from both levels are sent, the project's last, and the project's win a conflict. A project skill replaces a global skill of the same name.
- **One project folder at a time.** Only its `.textus/` counts: when you have chosen a project folder, a `.textus/` next to the document is not read.
- **No restart needed.** Edit any of these files and the next request uses the new version (completion within about ten seconds).

### Which file for what?

- How your text should sound → the **style profile**.
- Who is who, what is what → the **library**.
- What Textus AI should know or always do in a conversation → **writing instructions**.
- A task you ask for again and again → a **skill**.
- Notes, research, earlier chapters → ordinary files in the **project folder**; Textus AI reads them when a request needs them.

## A note on privacy

Your document, attached and @-mentioned files, your writing instructions, the style profile, the library entries that come up, and any project files Textus AI reads are sent to the provider you selected as part of each request; **Learn my style** sends the samples you pick. Web search runs on that provider's servers. Turn any feature off in Settings when you don't want that.
