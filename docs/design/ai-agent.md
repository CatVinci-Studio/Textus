# The AI agent: one request, start to end

How a message in the AI panel becomes a reply and proposals, and the rules
that hold for every model. The pieces: the provider layer (`aicompat`),
the agent loop (`ai/agent/`), the tools (`ai/tools/`, edits among them) and the proposal path ([ai-proposals.md](ai-proposals.md)).
The names the user sees are in [ai-concepts.md](ai-concepts.md).

## Layers

| Layer     | Owns                                                             | Code                                                                 |
| --------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Providers | How each service is reached and what it differs in               | `crates/aicompat` (`capabilities.rs`, `providers/`), `ai/catalog.rs` |
| Agent     | One request: the prompt, the steps, the tools run between them   | `ai/agent/`, `aicompat::agent::run_agent_loop`                       |
| Edits     | Text for the document, as `propose_edit` calls                   | `ai/tools/edits.rs`, `ai/agent/settle.rs`                            |
| Tools     | Reading, searching, comments, memory, skills, pictures (and MCP) | `ai/tools/`, `ai/images.rs`, `ai/web/`                               |
| Proposals | A proposed change from its first character to Accept or Reject   | `src/ai/revision/` ([ai-proposals.md](ai-proposals.md))              |

Pure logic sits inside each layer; side effects - the network, files, the
editor, the frontend channel - only at its edge (`agent/mod.rs`'s step and
`forward`, the tools' runners, the editor plugins).

## One request

| State      | What happens                                                                 | What the user sees                          |
| ---------- | ---------------------------------------------------------------------------- | ------------------------------------------- |
| Sent       | The message, the document (each block after its `[#id]`) and the mode go out | the message, a thinking row                 |
| Thinking   | The model reasons; its text comes as thinking where the provider sends it    | thinking, or "Thinking · n seconds"         |
| Replying   | The reply's text and its calls stream; an edit's text as its arguments come  | the reply; the edit growing in the document |
| Tools      | Calls the model made run (reads in parallel, the rest in order)              | "Writing notes…", a picture's frame         |
| Correcting | An edit that can't be applied is told back; the model writes it again        | the reply so far; the row counts seconds    |
| Done       | Every edit and comment was valid, and the reply said what it did             | the reply, the proposals to decide          |

A request also ends when the user stops it (what streamed stays; an edit
cut off mid-call is dropped), on an error (shown with Retry where the send
can be repeated), or after `MAX_STEPS` tool steps (the reply says so). While
nothing moves for five seconds, the thinking row counts the seconds
(`ThinkingIndicator`), so a model that sends neither thinking nor text never
looks stuck.

## Edits are tool calls

Every model hands in document text the same way: a `propose_edit` call
naming the block by its id (`block`, and `last_block` for a run), with the
new Markdown as `text` and `anchor` for a few words inside a block. Its
description is in `tools/offered.rs`; the rules around it in
`agent/prompt.rs`.

1.2.0-rc.6 tried the other way - edits written in the reply as
`<textus-edit>` tags, since a tool call's arguments don't stream on every
provider (ChatGPT's parallel calls, MiniMax M3 send them whole). Measured
in the app, with its tools offered beside the edits, DeepSeek wrote no edit
in five runs of six: it reached for a tool to hand the edit in and took
`add_comment` or `read_document` instead. MiniMax wrote a whole translation
in 12 seconds as a tool call and took two to three minutes as tags. The
tags were taken out again. Arguments that come whole are a display matter,
to be handled in the frontend: thinking shown while it waits, the text
typed in once it comes, as for a streamed one.

A step's calls run in order, with its edits moved before its comments
(`settle_step`): a comment settles a request only once it has proposed a
change (`tools::settles`), so "translated it" with a comment and no edit
asks the model on instead of ending.

## Providers and models

One row per provider in `capabilities.rs` and one entry per service in
`catalog.rs` hold every difference; code never asks which vendor it is
talking to.

- **Wire format**: OpenAI Responses, Anthropic Messages, OpenAI-compatible
  Chat Completions (most providers), Gemini.
- **Thinking**: the format a provider takes it in, and per model
  (`data/model-capabilities.json`, refreshed from models.dev) whether it
  switches, has effort levels or a budget.
- **Thinking levels**: the user has three - Fast (Quick Ask and the writing
  helpers), Auto (the lightbulb off) and Deep (on). Auto sends nothing,
  except where a provider's default thinks far longer than writing needs
  (`auto_effort`: Doubao at `minimal`); Deep asks for `high` where there are
  levels, on where it only switches, never `xhigh` or `max`.
- Vision, pictures (`image`), usage in a stream, and whether a step's
  reasoning goes back with its calls (`replay_reasoning`).

A provider is added as a catalog entry and a row; before a release, the
edit eval (`live_eval::latency`) runs on every provider in the catalog.

## Skills, memory and MCP

- A **skill** is loaded when the user names it (`/name`) or the model asks
  for it (`use_skill`); what it says applies to that request. Precedence
  against the writing instructions and the style profile:
  [ai-concepts.md](ai-concepts.md#precedence).
- **Memory** is offered as the `remember` tool in every mode.
- **MCP** tools (1.3) are tools like any other: their results are
  information for the model, never instructions to follow, and they never
  change the document - a change to it is always a `propose_edit` the
  user decides on. Turning a server on is the consent to its tools being
  called; in Review mode, as for every tool, nothing edits.
