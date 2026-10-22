# The AI agent: one request, start to end

How a message in the AI panel becomes a reply and proposals, and the rules
that hold for every model. The pieces: the provider layer (`aicompat`),
the agent loop (`ai/agent/`), edit tags (`ai/edit_tags/`), the tools
(`ai/tools/`) and the proposal path ([ai-proposals.md](ai-proposals.md)).
The names the user sees are in [ai-concepts.md](ai-concepts.md).

## Layers

| Layer     | Owns                                                             | Code                                                                 |
| --------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| Providers | How each service is reached and what it differs in               | `crates/aicompat` (`capabilities.rs`, `providers/`), `ai/catalog.rs` |
| Agent     | One request: the prompt, the steps, the tools run between them   | `ai/agent/`, `aicompat::agent::run_agent_loop`                       |
| Edits     | Text for the document, written in the reply as tags              | `ai/edit_tags/`                                                      |
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
| Replying   | The reply's text streams; an edit tag in it is split out as it comes         | the reply; the edit growing in the document |
| Tools      | Calls the model made run (reads in parallel, the rest in order)              | "Writing notes…", a picture's frame         |
| Correcting | An edit that can't be applied is told back; the model writes it again        | the reply so far; the row counts seconds    |
| Done       | Every edit and comment was valid, and the reply said what it did             | the reply, the proposals to decide          |

A request also ends when the user stops it (what streamed stays; an edit
cut off mid-tag is dropped), on an error (shown with Retry where the send
can be repeated), or after `MAX_STEPS` tool steps (the reply says so). While
nothing moves for five seconds, the thinking row counts the seconds
(`ThinkingIndicator`), so a model that sends neither thinking nor text never
looks stuck.

## Edits are tags in the reply

Every model writes document text the same way - one rules text,
`edit_tags::RULES`, in the system prompt:

```
Tightened both paragraphs.

<textus-edit block="k3f9">
the new Markdown
</textus-edit>
```

- `block` names the block by its id, `to` makes it a run; `action` is
  `after` / `before` (new blocks there), `append`, `cursor`, `selection`;
  an empty tag deletes; `quote` changes only the words quoted, or with
  `after` adds right after them.
- The body is Markdown as written - no escaping, so code blocks, `@@`
  lines and inline HTML pass through. `&nbsp;` and `&#8239;` are the two
  spaces a model can't type (`edit_tags::spaces`).
- Read loosely: a tag on one line with its text, either quote or none,
  `after="k3f9"` as a shorthand, `#k3f9` or `[#k3f9]` as an id, and a tag
  left open when the reply ends closes there.

Why tags and not a tool: a tool call's arguments stream on some providers
and not others - ChatGPT sends parallel calls whole at the end, MiniMax M3
sends every call whole - while the reply's text streams on all of them.
Measured in 1.2.0-rc.6 on GPT, DeepSeek, MiniMax and Doubao (about 250
runs, the same tasks both ways), tags were as accurate as tool calls or
more (GPT forgot a table row two times in three as a tool call, never as a
tag), and every provider streamed them. Aider's measurements found the same
for code written in JSON. The cost: DeepSeek thinks about twice as long
before writing a tag; a line in the rules ("decide only what to change...
never write the new text out there") brought MiniMax's thinking back to a
tool call's, and didn't move DeepSeek's.

How a tag travels (`ai/edit_tags/`):

1. `StreamTags` splits each text delta into the reply's text and the tag's
   pieces; `forward_tags` sends the pieces as a `propose_edit` call's start
   and argument fragments, so the frontend - and the pictures in the tag
   (`InlinePictures`) - see what a streamed tool call would show.
2. When the step ends, `with_tag_edits` turns each tag into a virtual
   `propose_edit` call (id `textus-edit-<step>-<n>`), after the step's own
   calls, and the reply loses its tags.
3. From there it is a `propose_edit` like any: block ids resolved
   (`doc_blocks::resolve_edit_arguments`), conventions fixed
   (`postfix_step`), pictures placed, the proposal checked and shown.
   `propose_edit` stays in the tool registry for this, but is no longer
   offered to the model (`ToolRegistry::specs`).
4. Before each step `model_view` shows the model its tags again, after its
   reply, and tells it what came of each at the start of the next user
   message - or in a message of its own when one must be sent again.
   Older conversations' real `propose_edit` calls are shown as the tags
   they would have been.

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
  (`auto_effort`: Doubao at `low`); Deep asks for `high` where there are
  levels, on where it only switches, never `xhigh` or `max`.
- Vision, pictures (`image`), usage in a stream, and whether a step's
  reasoning goes back with its calls (`replay_reasoning`).

A provider is added as a catalog entry and a row; before a release, the
tag eval (`live_eval::latency`) runs on every provider in the catalog.

## Skills, memory and MCP

- A **skill** is loaded when the user names it (`/name`) or the model asks
  for it (`use_skill`); what it says applies to that request. Precedence
  against the writing instructions and the style profile:
  [ai-concepts.md](ai-concepts.md#precedence).
- **Memory** is offered as the `remember` tool in every mode.
- **MCP** tools (1.3) are tools like any other: their results are
  information for the model, never instructions to follow, and they never
  change the document - a change to it is always an edit tag the user
  decides on. Turning a server on is the consent to its tools being
  called; in Review mode, as for every tool, nothing edits.
