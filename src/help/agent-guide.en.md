# Textus AI Features Guide

Textus has a built-in AI made for writing, Textus AI: completion, grammar checking, and conversations that read and revise your document. This guide covers connecting a service, the AI features, and how to shape Textus AI into your own writing assistant with a folder, a style profile, a library, writing instructions and skills.

## Connecting a service

Everything about the AI is in **Settings › Textus AI**, four pages: **Models**, **Writing assist**, **Agent** and **External tools**.

1. On **Models**, pick the service in the **Providers** list. Sign in to your account (**Account**) or paste a key (**API Key**), whichever that service supports. A dot in the list marks each service you have set up.
2. For a **Custom Endpoint** (any OpenAI-compatible server: local models, proxies), enter the base URL, a key if it needs one, and the model name, then save.
3. Under **Model choice** at the top of the same page, choose the **Chat provider** and **Chat model**, and for completion and grammar the **Writing provider** (**Same as chat** by default) and **Assist model**.

Signing in happens in your browser. Whether images, web search and document edits are available depends on the service and model you choose.

The built-in model list only holds each provider's defaults (for Anthropic: Claude Sonnet 5.5 for chat, Claude Haiku 5.5 for completion and grammar). Under a provider's **Models**, press **Fetch Models** to load its current list and choose any model from it.

For **Doubao (Volcengine)**, create the API key in the [Volcengine Ark console](https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey) and, in the same console, enable the models you want to use: Ark turns down a request for a model your account hasn't enabled.

Shortcuts below use macOS notation; on Windows and Linux, read Cmd as Ctrl and Option as Alt. If you have changed a shortcut, **Settings › Shortcuts** has the current one.

## Everyday use

The five ways you'll use most, starting with talking to it.

### Conversations

Conversations open as **tabs**. Click the **Textus AI** button (the sparkles) at the right end of the window bar, press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>L</kbd>, or choose **View › AI Panel**: the AI opens in an island of its own on the right. Its tabs are tabs like any other: drag one beside a document, into another island, or out into a window of its own.

- **Per folder**: conversations belong to the folder you work in, not to one document. Each open conversation is a tab; the one in front is the one you are talking to, about the document in front. A closed conversation stays in History.
- **New conversation**: right-click the empty paper of an AI tab and choose **New conversation** (with edits still undecided, it asks first). **Memory** is in the same menu.
- **History**: the clock at the top right of an AI tab lists past conversations, grouped by folder, with **Search conversations** at the top to find the ones where some words were said. Click one to reopen it. When you refer to an earlier conversation, Textus AI searches them too. **Settings › Privacy & Data** can stop saving conversations.
- **Mode and model**: one button among the input's controls says both, "General · model". **General** works on the document: it drafts new text (a continuation, a new paragraph or section) and changes the text that is there (a rewrite, a translation, a cut). With text selected, a change to it replaces it and more text goes after it. **Review** answers, discusses and leaves comments without changing anything. **Research** takes a topic, researches it and writes it up as a piece (see **Research** below). The list also holds every model of the services you have set up, and the **Agents** you have added (see **External agents**). A new conversation starts in Review; after that, the composer keeps the mode you last picked.
- **@-mentions**: type `@` in the input to pick a text file from the folder; it is attached to the message.
- **Attach files**: the **+** button on the left of the input attaches one or more files to that message: a PDF, Word document, PowerPoint deck, spreadsheet, EPUB e-book, RTF or HTML file, any text or code file, a zip archive, or a picture (PNG, JPEG, GIF, WebP, BMP, TIFF, and on a Mac HEIC and AVIF). Each file is copied into the conversation's own temporary folder, never into your folders, where Textus AI can read it again whole. Documents are extracted to text locally and travel inside the message; a long one is sent only in part, the chip says "(shortened)", and Textus AI reads the rest when it needs it. A zip archive is unpacked there and its files listed. Pictures are converted to a format every service reads, made smaller when they are very large, and sent as real images to providers that can see (ones that can't say so up front rather than dropping them silently).
- **Web search**: the magnifier button next to the input lets Textus AI search the web when a request needs it — see **Web search** below.
- **Deep thinking**: the button beside web search (the light bulb) asks the model to think its answer through before it replies — slower and more expensive, for hard questions and bigger rewrites. It stays on, across documents, until you press it again. While the model thinks, the tab shows "Thinking · 8 seconds"; afterwards "Thought for 12 seconds", which you can click to read the reasoning where the provider shares it. The button only appears for models that can think harder; Quick Ask always asks for a quick answer.
- **Errors**: when a request fails, Textus says in your language what kind of problem it is and what to do (check the key, top up a balance that has run out, wait a moment, pick another model) above the provider's own message - in the chat, and for completion and grammar checking too.
- **Long documents**: asked to translate or rewrite a long document chapter by chapter, Textus AI hands each chapter to a helper of its own, with a shared list of how recurring names and terms are written, so the whole document changes at once.

### Changes to your documents

**Settings › Textus AI › Writing assist › How Textus AI changes files** decides how Textus AI's changes reach your text:

- **As revisions to review** (the default): each change is a revision shown where it would land, and nothing is final until you accept it.
- **Written straight in**: changes are written as they arrive. They stay marked, so you can see what changed, and each reply can be undone.

A Research piece is written straight in either way. <kbd>Cmd</kbd>+<kbd>Z</kbd> undoes an accepted change in one step.

**How revisions look**: **Show revisions** (Writing assist, or the eye button on the review bar) has three views:
- **Result only, originals in the margin** (the default);
- **Original in the text, changes in the margin**;
- **All in the text**: removed text struck through, new text in green.

New text is always drawn in the text. Without room for a margin (narrow window, sidebar and AI open), the margin views wait and the text shows all.

- **The review bar**: one bar at the bottom of the document collects everything waiting there, changes and notes alike. Step through them with ‹ › (or <kbd>F7</kbd> / <kbd>Shift</kbd>+<kbd>F7</kbd>), **Accept** or **Reject** each, or **Accept all** / **Reject all**. Each changed sentence also has ✓ / ✕ in the text; take only some and the bar says "Accept 2 of 5". From the keyboard: <kbd>Cmd</kbd>+<kbd>Return</kbd> accepts, <kbd>Cmd</kbd>+<kbd>Delete</kbd> with the caret on a change rejects it.
- **Reasons**: each proposal card in the conversation says why Textus AI made that change.
- **At the cursor**: with nothing selected, Textus AI knows where your cursor is, so "write a transition here" inserts exactly there.
- **Comments instead of edits**: ask for a review ("what's weak here?") and Textus AI pins comments to passages without changing them. Each comment card has **Show in document**, which selects the passage it is about.
- **Your own notes**: select some words, right-click and choose **Add Note**: your note goes into the margin beside Textus AI's, marked Me. Notes are kept beside Textus's own data, not in your Markdown.
- **Track My Changes** (View menu): while it is on, your own edits show as changes too - what you deleted struck through, what you added marked - each with a card in the margin, marked Me, to accept or reject. The file keeps the original, with only the changes you accepted; the ones still to decide are kept beside it in the `.textus` folder, as Textus AI's are, and come back when the document opens again - share the folder and they go along.

**Other files of the folder**: Textus AI can change files you don't have open.

- **As revisions to review**: a change to such a file waits in it as revisions. They go into the text when you open it, to accept or reject as above. The file tree and the file's tab mark it, "3 to review".
- **A new file it makes** waits to be kept: **Keep** it, or **Discard** it (it goes to the Trash).
- **Written straight in**: the change is written at once, and the text before it is kept so it can be undone.
- **The reply's card** lists the files it touched, with **Undo**, **Apply**, **Keep** and **Discard**. A file you edited in the meantime keeps its change apart, marked "Changed since"; **Dismiss** lets it go.

### Completion

As you type, a gray continuation appears at the cursor — press <kbd>Tab</kbd> to accept it, or <kbd>Cmd</kbd>+<kbd>→</kbd> to accept just the next word and keep the rest on offer. <kbd>Esc</kbd> dismisses it. There's no minimum amount of text required; it's ready from the very first sentence of a document.

Ask for one explicitly with <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd> or the context menu (the cursor must be at the end of a paragraph): you get a longer continuation with up to three alternatives — <kbd>Option</kbd>+<kbd>[</kbd> / <kbd>Option</kbd>+<kbd>]</kbd> cycle through them.

Under **Settings › Textus AI › Writing assist › Continue & Check** you can turn completion on or off and pick a **Completion tone** (match the document / formal / casual / academic / concise). When the document belongs to a folder with a style profile or library (see **Make Textus AI yours** below), completion follows them too.

### Grammar check

Possible issues get underlined. Hover over one, or move the caret into it, to see the explanation; **Apply** (or <kbd>Option</kbd>+<kbd>Enter</kbd> with the caret on it) takes the fix, **Ignore** dismisses it. <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> checks the current paragraph immediately. **Check level** (Writing assist › Continue & Check) sets how much it flags.

### Quick Ask

Press <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> (or right-click > **Ask AI…**) to open a small chat bar right below the paragraph you are in. It sits in the document, pushing the text below it down rather than covering it. If text was selected when you opened it, the selection is included. Quick Ask opens in **General** mode, because it is usually opened on a passage to change it ("shorten this"); Review is one click away in the mode picker.

- **The shortcut again**: pressing <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> while the bar is open moves the cursor to its input; pressing it once more from the input closes it. <kbd>Esc</kbd> anywhere in the bar closes it too, and the cursor goes back to the document. With edits still undecided, closing (or starting a new conversation) asks first.
- Quick Ask keeps its own short conversation, apart from the AI tabs' and not saved to History. **Continue in the full conversation** (the button in its corner) hands the exchange to an AI tab, where it carries on and is saved.

## Make Textus AI yours

Textus AI learns about you and your work from a few plain Markdown files, not from hidden settings. Each has one job:

| Concept | What it is | Where it lives |
| --- | --- | --- |
| **Folder** | The folder Textus AI works in and may read | The folder you open in the sidebar, or one you choose |
| **Style profile** | How you write | `.textus/style.md` |
| **Library** | Facts about people, places and terms | `.textus/library/` |
| **Writing instructions** | Standing rules for every conversation | `agent.md` — global, and per folder |
| **Memory** | What Textus AI keeps from your conversations | `memory/` in the global config folder, and `projects/<folder>/memory/` beside it for each folder |
| **Skills** | Reusable instructions you call with `/name` | `skills/` — global, and per folder |
| **Global config folder** | What applies to every document | The app's settings folder |

"Conversations" below means the AI tabs and Quick Ask. Here is a whole folder at a glance:

```
my-novel/                ← the folder
├── chapter-1.md         ← the document you are editing
├── notes/
│   └── timeline.md      ← reference material Textus AI can read
└── .textus/              ← the folder's own settings
    ├── style.md         ← style profile
    ├── agent.md         ← writing instructions for this folder
    ├── library/
    │   ├── lin-wan.md   ← one entry per character, place or term
    │   └── harbour-city.md
    └── skills/
        └── polish.md    ← one skill per file
```

The folder menu creates `.textus/` and its files for you the first time you ask for them; folder skills are the only thing you add by hand. Text inside `<!-- -->` comments in any of these files is a note to yourself and is never sent.

### The folder

**The folder is the folder Textus AI works in.** It is the folder you open in the sidebar (**File > Open Folder…**), or one you choose — or else the nearest folder above the document that has a `.textus/` folder, so a chapter in `novel/part-1/` belongs to `novel/`. A document you open on its own has no folder: Textus AI then reads only the document and the files you attach, so a file in Downloads or on the Desktop never opens that whole folder to it.

- Textus AI can list, find by name, read and search the files in it to find a character's earlier scenes, a term, or your notes: text files (Markdown, plain text and similar formats) up to 16 MB — a long one it reads a part at a time — and the text of PDF, Word, PowerPoint, spreadsheet, EPUB and RTF files. With a provider that can see images, it can also look at the PNG, JPEG, GIF and WebP images in it, up to 6 MB each. Hidden files and folders, what a `.gitignore` or `.ignore` file leaves out (as in the sidebar's file search), build and dependency folders (such as `node_modules`) and scanned PDFs without a text layer are left out.
- Typing `@` in the chat input attaches one of its files to your message.
- Its `.textus/` folder holds the folder's style profile, library, writing instructions and skills.

Right-click the empty paper of an AI tab and choose **Memory**: its top row shows the folder's name; click it for the **folder menu**. When your reference material doesn't live next to the draft, use **Choose folder…** there (or **Settings › Textus AI › Agent › Folder**). The folder you choose is used for every document — unsaved drafts included — until you pick **Use no folder**.

> [!TIP]
> Your draft is in `thesis/drafts/` and your interview notes in `thesis/research/`? Choose `thesis/` as the folder, and Textus AI can read `research/interviews.md` while you work on `drafts/chapter-2.md`.

Everything Textus AI reads must be inside the folder: `..`, absolute paths and links pointing outside are refused. Without a folder open or chosen there is no folder, and a folder that is too broad — your home folder or a whole drive — is refused. What Textus AI makes while it works (research notes, drafts in progress) goes to Textus's own folders or the system's temporary folder, not into yours.

### The style profile — "Learn my style"

**The style profile describes how you write**, so that continuations and edits sound like you: voice and tone, sentence rhythm, word choice, punctuation, things you never do. Textus AI follows it in conversations, and completion follows it as you type, in every document of the folder. It is the file `.textus/style.md`.

There are two ways to make one, both in the folder menu:

- **Learn my style from samples…** — pick a few files of your own writing (up to eight). Textus AI studies them and drafts a profile — voice and tone, sentences and rhythm, word choice, punctuation, structure, what you never do, and a few short quotes as examples — then opens it in a new tab. Read it, correct it, add to it: it is yours. Learning again keeps the previous profile as `style.previous.md`.
- **Create style profile** — start from an empty outline and write it yourself.

Once there is a profile, **Open style profile** in the folder menu (and the style row in Memory) opens it.

```markdown
# Style profile

## Sentences and rhythm
- Short sentences, rarely over 15 words.
- Opens a paragraph with a concrete scene, then the point.

## Never
- No exclamation marks. No "suddenly".
```

Concrete, checkable points work better than adjectives: "short sentences, rarely over 15 words" rather than "concise". Keep it to a page or two; only the first 6,000 characters are used. The **Completion tone** in Settings applies as well — leave it on *Match the document* when your style profile already describes your voice.

### The library

**The library holds facts that must stay consistent**: one Markdown file per character, place or term, in `.textus/library/`. **New library entry…** in the folder menu asks for a name and opens the new entry; Memory lists them all.

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

**Writing instructions are standing rules sent with every conversation**: what the folder is, which language to reply in, spellings and terms, things Textus AI should always or never do. They live in files called `agent.md`, at two levels:

- **Global**, for every document: **Settings › Textus AI › Agent › Writing Instructions (agent.md) › Edit agent.md**.
- **Folder**, for the documents of one folder: `.textus/agent.md`, opened with **Edit the folder's writing instructions** in the folder menu.

Both open in a tab and start with a short how-to in comments. When both exist, Textus AI gets both — the global instructions first, then the folder's — and where they disagree, the folder's win.

```markdown
The book is a mystery set in 1930s Shanghai, told by Lin Wan in the first person.
Always reply in English, even though the novel is in Chinese.
Spell it "Harbour City", never "Harbor City".
```

Writing instructions apply to conversations only. Completion doesn't read them; it follows the style profile and the library.

### What Textus AI remembers

**Textus AI remembers what you ask for and how you write**, without you writing a file. When you tell it something that should hold beyond one request — "always use British spelling", "no em dashes", a correction you had to make twice — or a fact about your work, such as who a character is, it keeps it and follows it in later conversations. Each time, a line under its reply says what it remembered and where: **Undo** takes it back, and **Make global** or **Only for this folder** moves it.

- **This folder**: what is about this work, in `projects/<folder>/memory/` in the global config folder (Textus keeps it there, not in your folder); facts about people, places and terms go into the library.
- **For all folders**: your general habits, in `memory/` in the global config folder. Without a folder, everything goes here.

**Memory** (right-click an AI tab's paper › Memory) lists it all, with when and in which conversation each was remembered: **Edit** opens it, **Delete** removes it. Now and then Textus AI tidies its memory, merging memories that say the same thing and dropping a rule a newer one overturned; what it dropped is under **Recently forgotten**, to bring back. Your own writing instructions win when the two disagree, and Textus AI never changes your `agent.md` or style profile. When there are too many memories to send, the oldest are left out and Memory says so. The **Memory** switch (Settings › Textus AI › Agent) turns it off.

**It also learns from your revision choices.** When you turn down the same kind of change several times — 「」 made “”, one word swapped for another, sentences split, an Oxford comma added — Textus AI offers, once the review is done, to remember it as a requirement: **Remember** saves it under **Memory**, **Not now** waits for more, and **Never ask for this** stops asking about that kind. It asks at most once a day, and only your click saves anything, also with memory turned off. What it counts is a short note of the kinds of change you accepted or rejected, kept on this computer beside your memories and never sent.

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

When what you asked for was a procedure of your own - steps you'll want again - Textus AI offers under its reply to keep it as a skill, for every document or for this folder only. Nothing is saved unless you choose to.

Skills live at the same two levels as writing instructions: global skills in the `skills/` folder of the global config folder (**Import Skill…** at the top of Skills on **Settings › Textus AI › Agent** copies a skill file there), folder skills in `.textus/skills/` (a hidden folder — in macOS Finder, <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> shows it). A folder skill with the same name as a global one replaces it.

### Built-in skills

Textus comes with four skills. **Proofread**, in Review, checks spelling, grammar, punctuation and numbers against the standards of the text's language. **Design a theme**, **Make a plugin** and **Make a skill** make an editor theme, a small plugin or a skill of your own from what you describe, in a tab of their own: **Make your theme** is in Appearance's theme store, **Make your plugin** in the Plugins panel's **⋯** menu. More skills - expand, tighten, translate, summarize, check continuity, email, meeting minutes and others - are under **Available** at the end of Skills on **Settings › Textus AI › Agent**. Type `/` and pick one, or type its name in any of the app's languages: `/proofread`, `/校对` and `/校正` call the same skill. Textus AI also picks a skill by itself when your request matches one. **Design a theme** puts the theme's CSS in the reply: **Use this theme** under it installs it, or save it as a .css file and add it with **Add a theme from a CSS file** on **Settings › Appearance**.

The built-in skills head Skills on **Settings › Textus AI › Agent**, always on. **Customize…** copies one into the `skills/` folder of the global config folder and opens the copy, so you can change its instructions; from then on your copy runs instead. **Reset** deletes the copy and brings the built-in version back. Below them are the skills you added. Each says the modes it works in - click that to change them - and its switch turns it off for now, its modes kept for when you turn it back on. A skill of your own with a built-in skill's name replaces the built-in one.

### Writing conventions

**Writing conventions** (Settings › Textus AI › Writing assist › Continue & Check) decides which punctuation, spacing and number rules Textus AI and the grammar check follow. **Automatic** uses the national standard where a language has one (GB/T for Simplified Chinese, JTF for Japanese, for example); elsewhere it follows what your document already does most and points out only inconsistencies. Pick a profile, such as Simplified Chinese **Fiction** or English **UK · GOV.UK**, and documents in that language are held to it.

A folder can choose its own: add a `conventions:` line between the two `---` lines at the top of its style profile (`.textus/style.md`). For that folder's documents it wins over the setting.

```markdown
---
conventions: zh-Hans-CN/fiction, en-GB/govuk
---
```

### The global config folder

**The global config folder holds what applies to every document**: your global `agent.md` and your global skills. It belongs to the app, not to any folder; **Settings › Textus AI › Agent › Global config folder › Show** shows it.

```
agent/                ← the global config folder
├── agent.md          ← global writing instructions
└── skills/
    └── outline.md    ← a global skill
```

There is no global style profile or library: those describe one body of work, so they belong to a folder.

### Which applies when

| | Conversations | Completion | Grammar check |
| --- | :---: | :---: | :---: |
| Files in the folder (read, search, `@`) | ✓ | | |
| Style profile | ✓ | ✓ | |
| Library entries that come up | ✓ | ✓ | |
| Writing instructions | ✓ | | |
| What Textus AI remembered | ✓ | | |
| Skills | ✓ | | |
| Completion tone (Settings) | | ✓ | |

- **Global, then folder.** Writing instructions from both levels are sent, the folder's last, and the folder's win a conflict. A folder skill replaces a global skill of the same name.
- **One folder at a time.** Only its `.textus/` counts: when you have chosen a folder, a `.textus/` next to the document is not read.
- **No restart needed.** Edit any of these files and the next request uses the new version (completion within about ten seconds).

### Which file for what?

- How your text should sound → the **style profile**.
- Who is who, what is what → the **library**.
- What Textus AI should know or always do in a conversation → **writing instructions**.
- A task you ask for again and again → a **skill**.
- Notes, research, earlier chapters → ordinary files in the **folder**; Textus AI reads them when a request needs them.

## More

### Research

Pick **Research** in the mode button and send a topic instead of a request: Textus AI researches it — the web, your folder, the papers you attach — makes an outline, and writes the piece into the document. Type `/` to choose the kind of piece (an essay, a report, a literature review and others), or leave it on **Choose for me**. **Research with sub-agents** (Writing assist) lets it hand parts of the research to helpers working at once; **Check citations** has each cited sentence checked against its sources before the piece is done. A piece is written straight into the document, whatever **How Textus AI changes files** says.

### Web search

Turn on the **Web search** button next to the input, and Textus AI looks things up when a request needs facts that are current or that it isn't sure of. It can also read a page whose address you paste.

- **Who searches**: models that search by themselves — OpenAI, Claude, Grok, OpenRouter, Groq, Qwen and Zhipu GLM — use their own search. For any other model (DeepSeek, Gemini, Mistral, Kimi, local models, custom endpoints), Textus does the searching, on the **Search service** chosen in **Settings › Textus AI › Writing assist › Web and proxy**: **Automatic** uses a DeepSeek, Zhipu or Kimi key you already saved for chat; or pick Bocha, Tavily, Brave Search or Exa and paste its key, or SearXNG and enter the address of your own server. The row says where your searches go. With nothing to search with, the button shows a red dot.
- **Sources**: the reply cites what it found as [1], [2], and lists those pages under it; click one to open it in your browser. The numbers stay the same for the whole conversation.
- **Sources as footnotes**: when a proposal draws on the web, its card has **Add sources as footnotes**. Ticked, accepting it adds Markdown footnotes for its sources at the end of the document; unticked, the text goes in without them. The card remembers your last choice.
- **Pages are read, not obeyed**: what a page says never instructs Textus AI, and it still only proposes edits. Textus reads pages from the public web only, never from your computer or local network.

### Pictures

Textus AI can make pictures for your document. **Image service** (Settings › Textus AI › Models › Model choice) follows your chat provider by default: signed in with ChatGPT, pictures come out of your plan's own allowance (marked experimental - it is not a published API); with another provider that makes pictures, its own, with the same key. A provider that makes none offers no pictures until you choose a service - OpenAI, Google Gemini, Doubao (Volcengine), Alibaba Qwen, Zhipu GLM, SiliconFlow, or any OpenAI-compatible endpoint - and then its model.

- Ask in General mode ("add a picture of the harbour after the first paragraph"), or right-click a paragraph and choose **Illustrate this paragraph**.
- Writing and pictures come together: the text appears as it is written, and each picture shows as a softly moving frame in its place until it is ready. You can accept it before it is finished; it is saved when it arrives.
- Nothing is saved until you accept: then the picture is stored the way **Settings › Editing › Images** says for a pasted image and inserted as a Markdown image. Reject leaves nothing behind.
- To have a proposed picture drawn again, point at it and choose **Redraw…**, then say what should change; only that picture is redrawn. Pictures in one piece keep the same people and look: someone who comes back is described in the same words, and where the image model takes a picture to work from, a new picture of them starts from an earlier one.
- To change a picture, right-click it and choose **Change this picture with Textus AI…**, then say how. The new one is proposed in its place; once you accept it, you are asked whether the old file should go to the Trash - it stays unless you say so.
- Say how many pictures you want and Textus AI makes that many, up to **Pictures per request** (Models › Model choice; two unless you change it). If the service turns a description down, the picture's place shows the reason it gave.

### External agents

Coding agents such as Claude Code or Codex can work in Textus through plugins. Once one is added, it has a button beside the Textus AI button in the window bar, and it is in the **Agents** group of the mode button: pick it, and your messages go to it instead of to a model. Before it changes a file, it asks you, in the conversation. **Settings › Textus AI › External tools** lists them under **ACP Agent** (**Get agents…** opens the Plugins panel), and above them the **MCP servers** whose tools Textus AI may use.

## Turning Textus AI off

Right-click the **Textus AI** button at the right end of the window bar to pause Textus AI for an hour or to turn it off. While it is off, the sparkles are struck through, and a click on it offers to turn Textus AI back on; a pause ends by itself after the hour. The command palette (**Turn Textus AI on or off**) and a shortcut you can set under **Settings › Shortcuts** do too; on an iPhone it is in the menu.

While it is off, nothing is sent to any AI service, from the moment Textus opens: no completion, no grammar check, no conversation, nothing remembered. The AI tabs, Quick Ask and the AI items of the right-click menu go away, and a reply still being written stops. Edits already proposed in the document stay, for you to accept or reject. Each feature keeps its own setting, and they all apply again once Textus AI is back on.

## A note on privacy

Your document, attached and @-mentioned files, your writing instructions, the style profile, the library entries that come up, and any files in the folder Textus AI reads are sent to the provider you selected as part of each request; **Learn my style** sends the samples you pick. With web search on, searches go to your provider, or to the search service shown in Settings, and the pages Textus AI reads are fetched from this computer. Turn any feature off in Settings when you don't want that.
