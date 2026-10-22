### Platform notes

- Reads only what Textus 1.1 and later keep. Gone with it:
  - The offer to import a Levis installation, at first launch or in **Settings › About**.
  - The conversion of a project's `.levis/` folder, and the Memory tab's **Convert Levis data**.
  - Reading writing instructions, skills and memories from the old `agent/` config folder. They stay on disk; moving them into `textus/` brings them back.
  - Reading chat history from 1.0's single `chat-history.json`, and an OpenAI key from `api_key.json`. Enter the key again.
- A setting saved by an older version that Textus no longer knows now takes its default instead of being converted:
  - Agent mode Ask, Edit or Plan becomes Review.
  - The old provider names are no longer mapped.
  - An image folder such as `${filename}.assets` becomes `assets/`.
  - A tour left half-way in an older guide starts over.
- Checks the types of what the app and its native side send each other against one definition, generated from the native code, so the two can't drift apart.
