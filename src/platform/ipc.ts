import { Channel } from "@tauri-apps/api/core";
import type { ProviderCatalogEntry } from "../ai/provider-catalog";
import type { ImageModel, ImageProviderEntry } from "../ai/image-models";
import type { SentBlock } from "../ai/doc-blocks";
import type { AgentTurn, ImageAttachment, ThinkingLevel } from "../ai/types";
import type { GrammarIssue } from "../ai/writing/grammar-check-plugin";
import type { AgentMode } from "../settings/SettingsContext";
import type {
  CompletionRequest_Deserialize as CompletionRequest,
  GrammarRequest_Deserialize as GrammarRequest,
} from "./bindings/ai";
import type { AgentTurn_Deserialize as AgentTurnInput } from "./bindings/ai-agent";
import type {
  PassRequest_Deserialize as PassRequest,
  Value,
  SkillOffer,
} from "./bindings/ai-memory";
import { isIOSApp } from "./capabilities";
import { iosFiles } from "./ios-files";
import {
  aiCall,
  aiCommand,
  command,
  desktopActionCommand,
  desktopQueryCommand,
} from "./ipc-call";
import type {
  CompletionHints,
  MemoryKind,
  MemoryScope,
  RememberedChange,
  SkillListItem,
  StreamEvent,
} from "./ipc-ai-types";
export { IpcError } from "./ipc-call";
export * from "./ipc-plugins";
export type { UpdateChannel } from "./update-channel";
export {
  type SavedImage,
  type IndexedFile,
  type FolderIndex,
  type WordDocument,
  type ImageMigration,
  fs,
  session,
  type StoredSnapshot,
  type HistoryKind,
  storage,
  type DraftSnapshot,
  drafts,
  ownNotes,
} from "./ipc-files";
export {
  type FloatingDragArgs,
  type WindowBounds,
  windowIpc,
  menuIpc,
  links,
  webPages,
  exportDoc,
  themes,
  themeGallery,
  cli,
  BACKGROUND_STATUS,
  type BackgroundStatus,
  background,
  type DefaultEditorStatus,
  defaultEditor,
  type Distribution,
  distribution,
  updater,
} from "./ipc-app";
export {
  type OauthStatus,
  type CustomEndpointConfig,
  auth,
  imageHostAuth,
} from "./ipc-auth";
export {
  AI_CANCELLED,
  type GeneratedImageData,
  type WebSearchStatus,
  type StreamEvent,
  type CompletionHints,
  type LibraryEntry,
  type Remembered,
  type Memory,
  type MemoryScope,
  type MemoryKind,
  type Memories,
  type LibraryUse,
  type AgentWorkspaceInfo,
  WRITING_CONVENTIONS_KEY,
  WRITING_CONVENTIONS_AUTOMATIC,
  type ConventionsLang,
  WRITING_CONVENTIONS,
  type WritingConventionsSetting,
  type ProjectConventions,
  type ConventionsProfile,
  type WritingConventionsOptions,
  type EffectiveConventions,
  type ConventionsFinding,
  type ConventionsReport,
  type TextMeasure,
  type SkillListItem,
  type RememberedChange,
} from "./ipc-ai-types";

/**
 * Thin, typed wrappers around every Tauri command the frontend calls -
 * command names and their argument/return shapes live here once instead of
 * being repeated (and occasionally drifting) at each call site. This layer
 * intentionally does not change behavior: it's the same `invoke()` calls,
 * just typed and funneled through one error shape.
 *
 * Grouped by domain to match the Rust command modules in src-tauri/src/:
 * files and storage in ipc-files.ts, windows, export, themes and updates in
 * ipc-app.ts, sign-in in ipc-auth.ts, the AI commands here with their types
 * in ipc-ai-types.ts. Everything is re-exported from this file, so callers
 * import from one place.
 */

export const ai = {
  // Rust sends the dialect and the auth methods as plain strings, from the
  // fixed sets ProviderCatalogEntry names.
  listProviders: () =>
    command("list_providers") as Promise<ProviderCatalogEntry[]>,
  /** Whether Deep thinking changes anything for this provider and Agent
   *  model (null: the provider's default) - ai_can_think_deeper in
   *  src-tauri/src/ai/catalog.rs. */
  canThinkDeeper: (provider: string, model: string | null) =>
    command("ai_can_think_deeper", provider, model),
  /** The services Settings › Textus AI › Image model offers (ai/images.rs). */
  listImageProviders: (): Promise<ImageProviderEntry[]> =>
    command("list_image_providers"),
  /** A picture generate_image made, waiting for Accept or Reject. */
  generatedImage: (id: string) => command("ai_generated_image", id),
  /** Asks again for a picture that wasn't made, by itself. */
  retryGeneratedImage: (id: string) => command("ai_retry_generated_image", id),
  /** The description a waiting picture was drawn from; null once gone. */
  generatedImagePrompt: (id: string) =>
    command("ai_generated_image_prompt", id),
  /** Draws a waiting picture again from the writer's description. */
  redrawGeneratedImage: (id: string, prompt: string) =>
    command("ai_redraw_generated_image", id, prompt),
  /** Lets a waiting picture go: rejected, or saved. */
  discardGeneratedImage: (id: string) =>
    command("ai_discard_generated_image", id),
  /** The document's undecided proposals as kept with it
   *  (ai/revision/kept-proposals.ts), or null when none are. */
  keptProposalsRead: (docPath: string, workspaceRoot: string | null) =>
    command("kept_proposals_read", docPath, workspaceRoot),
  /** Keeps them, with the made pictures among `pictures` - or, with
   *  null, removes what was kept. Their shape is the frontend's, opaque
   *  JSON to Rust. */
  keptProposalsWrite: (
    docPath: string,
    workspaceRoot: string | null,
    kept: object | null,
    pictures: string[],
  ) =>
    command(
      "kept_proposals_write",
      docPath,
      workspaceRoot,
      kept as Value,
      pictures,
    ),
  fetchAgentModels: (provider: string) =>
    aiCommand("fetch_agent_models", provider),
  setAiProxy: (proxy: string | null) => command("set_ai_proxy", proxy),
  complete: (
    provider: string,
    before: string,
    after: string,
    style: string | null,
    model: string | null,
    hints: CompletionHints | null = null,
    /** Resolve the project folder whose style profile and library the
     *  completion follows (src-tauri ai::project). */
    project: { docPath: string | null; workspaceRoot: string | null } = {
      docPath: null,
      workspaceRoot: null,
    },
  ) =>
    // Rust reads these keys as one struct (commands/args.rs), which the
    // generated bindings can't call; the struct itself is generated.
    aiCall<string>("ai_complete", {
      provider,
      before,
      after,
      style,
      model,
      hints,
      docPath: project.docPath,
      workspaceRoot: project.workspaceRoot,
    } satisfies CompletionRequest),
  grammarCheck: (
    provider: string,
    paragraph: string,
    strictness: string | null,
    model: string | null,
    /** The document's project, for its writing conventions profile and
     *  library names; omitted, the check uses the global setting. */
    project: { docPath: string | null; workspaceRoot: string | null } = {
      docPath: null,
      workspaceRoot: null,
    },
    /** The app's language: the explanations are written in it. */
    uiLanguage: string | null = null,
  ) =>
    // One struct in Rust, as ai_complete's.
    aiCall<GrammarIssue[]>("ai_grammar_check", {
      provider,
      paragraph,
      strictness,
      model,
      docPath: project.docPath,
      workspaceRoot: project.workspaceRoot,
      uiLanguage,
    } satisfies GrammarRequest),
  agentMessage: ({
    onEvent,
    ...args
  }: {
    provider: string;
    /** The document, block by block as the editor has it (doc-blocks.ts):
     *  the model sees each after its id, and edits name them. */
    blocks: SentBlock[];
    docPath: string | null;
    /** The chosen project folder (Settings > Textus AI > Project Folder, or
     *  the project bar); null keeps the default, the document's own folder.
     *  Decides where .textus/ is read from and how far find_files/read_file
     *  may reach. */
    workspaceRoot: string | null;
    history: AgentTurn[];
    message: string;
    /** Attached images. Text-shaped attachments were already extracted and
     *  inlined into `message` by the caller. */
    images: ImageAttachment[];
    webSearch: boolean;
    /** How hard the model thinks; left out, the provider's default. */
    thinking?: ThinkingLevel;
    /** Settings > Search service and the SearXNG address: what web_search
     *  uses when the model can't search by itself (ai/web/mod.rs). */
    searchService?: string;
    searxngUrl?: string;
    mode: AgentMode;
    model: string | null;
    requestId: string;
    /** Heading of the section the cursor/selection is in - embedded in full
     *  when the document is too long to send whole (agent.rs). */
    focusHeading?: string | null;
    /** The UI language: the agent is given that UI's names for the app's
     *  concepts and controls (agent.rs, UiNames). */
    uiLanguage?: string;
    /** The image model, or null for none: generate_image is offered
     *  only with one (ai/images.rs). */
    imageModel?: ImageModel | null;
    /** Live fragments while the request runs - see StreamEvent. */
    onEvent?: (event: StreamEvent) => void;
  }) => {
    const channel = new Channel<StreamEvent>();
    if (onEvent) channel.onmessage = onEvent;
    // More parameters than the generated bindings take (ten), so typed by
    // hand; what the channel streams is generated, and the turns the
    // frontend keeps must still be turns Rust reads.
    return aiCall<AgentTurn[]>("ai_agent_message", {
      ...args,
      history: args.history satisfies AgentTurnInput[],
      onEvent: channel,
    });
  },
  /** What the Web search button can do with this provider and model: its
   *  own search, or the search service Textus would use instead (none: it
   *  needs one set up). */
  webSearchStatus: (
    provider: string,
    model: string | null,
    searchService: string,
    searxngUrl: string,
  ) => command("web_search_status", provider, model, searchService, searxngUrl),
  cancelAgentMessage: (requestId: string) => command("ai_cancel", requestId),

  loadAgentWorkspace: (docPath: string | null, rootOverride: string | null) =>
    command("load_agent_workspace", docPath, rootOverride),
  /** The writing conventions setting's allowed values (ai::conventions). */
  writingConventionsOptions: () => command("writing_conventions_options"),
  /** The profile a document follows, and each language's in its project. */
  writingConventionsEffective: (
    docPath: string | null,
    workspaceRoot: string | null,
    document: string | null = null,
  ) =>
    command("writing_conventions_effective", docPath, workspaceRoot, document),
  /** Checks a document's writing conventions offline (no AI provider). */
  checkConventions: (
    document: string,
    docPath: string | null,
    workspaceRoot: string | null,
    strictness: string | null = null,
  ) =>
    command(
      "conventions_check_document",
      document,
      docPath,
      workspaceRoot,
      strictness,
    ),
  /** Exact platform counts: "x_weighted", "bluesky", "wechat_title"... */
  measureText: (text: string, metric: string) =>
    command("measure_text", text, metric),
  /** The project folder's text files, for @-mentions (ai::project). */
  listProjectFiles: (docPath: string | null, workspaceRoot: string | null) =>
    command("list_project_files", docPath, workspaceRoot),
  readProjectFile: (
    docPath: string | null,
    workspaceRoot: string | null,
    path: string,
  ) => command("read_project_file", docPath, workspaceRoot, path),
  /** Creates `.textus/<rel>` from `template` if missing; returns its path. */
  ensureProjectFile: (
    docPath: string | null,
    workspaceRoot: string | null,
    rel: string,
    template: string,
  ) => command("ensure_project_file", docPath, workspaceRoot, rel, template),
  pickTextFiles: () => command("pick_text_files"),
  /** Undoes a remember call (ai::memory): deletes what it created, or
   *  writes back `previous`, the file before it updated it. */
  /** After an exchange: what to remember, update or forget, decided by
   *  the conversation's model and made (ai/memory/pass.rs). Nothing while
   *  Remember automatically is off. */
  memoryPass: (args: {
    provider: string;
    model: string | null;
    docPath: string | null;
    workspaceRoot: string | null;
    /** Recorded with what is remembered (`Source` in ai/memory.rs). */
    conversation: { id: string; title: string };
    exchange: { messages: string[]; reply: string };
  }) =>
    // One struct in Rust, as ai_complete's.
    aiCall<RememberedChange[]>("memory_pass", args satisfies PassRequest),
  /** After an exchange, its request offered as a skill to save
   *  (ai/memory/skill_offer.rs) - null when it isn't one. */
  offerSkill: (args: {
    provider: string;
    model: string | null;
    docPath: string | null;
    workspaceRoot: string | null;
    exchange: { messages: string[]; reply: string };
  }) => aiCall<SkillOffer | null>("ai_offer_skill", args),
  /** An offered skill saved, for every document or this project's. */
  saveOfferedSkill: (
    offer: SkillOffer,
    scope: "personal" | "project",
    docPath: string | null,
    workspaceRoot: string | null,
  ) => command("save_offered_skill", offer, scope, docPath, workspaceRoot),
  /** What the writer will probably say next, after a reply
   *  (ai/next_message.rs); null when there is no clear next step. */
  suggestNextMessage: (args: {
    provider: string;
    model: string | null;
    exchange: { messages: string[]; reply: string };
  }) =>
    aiCommand("suggest_next_message", args.provider, args.model, args.exchange),
  memoryUndo: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
    previous: string | null,
  ) => command("memory_undo", docPath, workspaceRoot, id, previous),
  /** Moves a memory to the other scope; returns its new id. */
  memoryMove: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
    scope: MemoryScope,
  ) => command("memory_move", docPath, workspaceRoot, id, scope),
  /** Puts a forgotten memory or library entry back; its new id. */
  memoryRestore: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
  ) => command("memory_restore", docPath, workspaceRoot, id),
  /** Deletes a memory or a library entry (`project/library/<stem>`). */
  memoryDelete: (
    docPath: string | null,
    workspaceRoot: string | null,
    id: string,
  ) => command("memory_delete", docPath, workspaceRoot, id),
  /** Saves one memory the user asked for with a click (a suggestion
   *  learned from revision choices); returns its id. Fails with plain
   *  words on a duplicate. */
  memoryRemember: (
    docPath: string | null,
    workspaceRoot: string | null,
    kind: MemoryKind,
    scope: MemoryScope,
    text: string,
  ) => command("memory_remember", docPath, workspaceRoot, kind, scope, text),
  /** The revision choices log (ai/revision/revision-learning.ts), kept
   *  beside the personal memories and never sent anywhere; null when
   *  there is none yet. */
  revisionChoicesRead: () => command("revision_choices_read"),
  // The log is the frontend's own shape, opaque JSON to Rust.
  revisionChoicesWrite: (log: object) =>
    command("revision_choices_write", log as Value),
  /** The library entries the last request for the document carried. */
  libraryUse: (
    docPath: string | null,
    workspaceRoot: string | null,
    document: string,
  ) => command("library_use", docPath, workspaceRoot, document),
  /** "Learn my style": writes the project's .textus/style.md from the
   *  picked samples and returns its path. */
  learnStyle: (args: {
    provider: string;
    model: string | null;
    docPath: string | null;
    workspaceRoot: string | null;
    files: string[];
  }) =>
    aiCommand(
      "learn_style",
      args.provider,
      args.model,
      args.docPath,
      args.workspaceRoot,
      args.files,
    ),
  /** Folder picker behind "Choose project folder…" (the project bar's menu
   *  and Settings > Textus AI > Project Folder). */
  pickWorkspaceRoot: (): Promise<string | null> =>
    isIOSApp
      ? iosFiles.pickProjectFolder()
      : desktopQueryCommand("pick_workspace_root", null),
  /** Reveals the global config folder, creating it - with `template` as
   *  its agent.md - on first use. */
  openGlobalAgentDir: (template: string) =>
    desktopActionCommand("open_global_agent_dir", template),
  /** The global agent.md's path, created from `template` if missing. */
  ensureGlobalAgentMd: (template: string) =>
    command("ensure_global_agent_md", template),
  importAgentSkill: () => command("import_agent_skill"),
  /** Every skill for this document - built-in, global and project - each
   *  with the modes it applies in. Both null: the built-ins and the global
   *  ones, as Settings shows them. */
  listSkills: (docPath: string | null, workspaceRoot: string | null) =>
    command("list_skills", docPath, workspaceRoot) as Promise<SkillListItem[]>,
  /** Copies a built-in into the global config folder's skills/ (or finds
   *  the copy already there) and returns its path, to open in a tab. */
  customizeBuiltinSkill: (name: string) =>
    command("customize_builtin_skill", name),
  /** Deletes the copy Customize… made, so the built-in applies again;
   *  returns the deleted files' paths (a tab showing one is closed). */
  resetBuiltinSkill: (name: string) => command("reset_builtin_skill", name),
  /** Sets the modes a skill of the user's applies in (its file's
   *  `textus-modes`); a built-in's are fixed. */
  setSkillModes: (
    name: string,
    source: SkillListItem["source"],
    docPath: string | null,
    workspaceRoot: string | null,
    modes: AgentMode[],
  ) => command("set_skill_modes", name, source, docPath, workspaceRoot, modes),
  pickAttachmentFile: () => command("pick_attachment_file"),
};

// ---------------------------------------------------------------------------
// cli (src-tauri/src/commands/cli.rs)
// ---------------------------------------------------------------------------
