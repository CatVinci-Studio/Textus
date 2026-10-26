use crate::ai::agent::AgentMode;
use crate::ai::builtin;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

mod frontmatter;
pub(crate) use frontmatter::*;
mod skills;
pub(crate) use skills::*;
mod layers;
pub(crate) use layers::*;

/// Everything that shapes Textus AI for the document being edited: the
/// project folder, its `.textus/` folder and the global config folder. The
/// user-facing names and rules are in docs/design/ai-concepts.md; in code the
/// project folder is still called the workspace root.
///
/// The project folder is the document's own folder unless the user chose
/// another one, and its `.textus/` directory holds the project's settings:
///
/// ```text
/// my-novel/                 <- the project folder
/// ├── chapter-1.md          <- the open document
/// └── .textus/
///     ├── agent.md          <- the project's writing instructions (system prompt)
///     ├── style.md          <- the style profile (ai::project)
///     ├── library/          <- the library (ai::project)
///     └── skills/
///         └── polish.md     <- one skill per file: YAML frontmatter + prompt body
/// ```
///
/// The global config folder lives in the app config dir under `agent/` with
/// the agent.md + skills/ half of that shape and applies to every document:
/// its writing instructions come first and the project's after them, and a
/// project skill with the same name shadows the global one. Skill files are
/// markdown with a frontmatter block:
///
/// ```text
/// ---
/// name: polish
/// description: Tighten prose without changing meaning
/// ---
/// (full instructions the model loads on demand)
/// ```
///
/// Only `name` + `description` go into the system prompt (the skill index);
/// the body is loaded dynamically via the `use_skill` tool.
pub const WORKSPACE_DIR_NAME: &str = ".textus";

/// Where a project's settings live: `<project folder>/.textus/`.
pub fn project_dir(root: &Path) -> PathBuf {
    root.join(WORKSPACE_DIR_NAME)
}

/// One project file, when it exists: `.textus/<rel>`.
pub fn project_file(root: &Path, rel: &str) -> Option<PathBuf> {
    Some(project_dir(root).join(rel)).filter(|path| path.is_file())
}

/// Who may start a skill (`metadata.textus-invocation`). `Both`: the model,
/// when a request matches the description, and the user with /name.
/// `UserOnly`: /name only - left out of the skill index the model sees.
/// `Hidden`: neither; loaded by exact name with use_skill (the reference
/// packs).
#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum Invocation {
    #[default]
    Both,
    UserOnly,
    Hidden,
}

/// Which layer a skill comes from: bundled with the app (ai::builtin), the
/// global config folder's skills/, or the project's .textus/skills/. Each
/// layer replaces same-named skills of the ones before it.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum SkillSource {
    Builtin,
    #[default]
    Global,
    Project,
}

/// A skill's name and one-line hint in one UI language.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
pub struct SkillLabel {
    pub label: String,
    pub hint: String,
}

/// One skill as the app sees it: the frontmatter's name and description,
/// the body (`prompt`, comments stripped) and the Textus-only keys under
/// `metadata:` (see docs in parse_skill_file). Serialised camelCase for
/// the frontend's skill list (src/ai/types.ts).
#[derive(Serialize, Clone, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct AgentSkill {
    pub name: String,
    pub description: String,
    pub prompt: String,
    /// `textus-category`: write, revise, check or format (the `/` menu's
    /// groups). None for a user skill that doesn't say.
    pub category: Option<String>,
    /// `textus-modes`: the panel modes the skill applies in (write, review,
    /// create) - only those offer it in the `/` menu and the skill index.
    /// Write for a skill that doesn't say.
    pub modes: Vec<AgentMode>,
    pub invocation: Invocation,
    pub source: SkillSource,
    /// A global or project skill with a built-in skill's name, which it
    /// replaces.
    pub overrides_builtin: bool,
    /// What people see it called, and its one-line hint, per UI language
    /// code: `textus-label-<code>` and `textus-hint-<code>` - a market or
    /// user skill's; a built-in's are in src/ai/skills/texts.
    pub labels: BTreeMap<String, SkillLabel>,
    /// Extra words the user can type after `/`, per UI language code
    /// (src/i18n/langs.ts): `textus-aliases-<code>`, comma-separated.
    pub aliases: BTreeMap<String, Vec<String>>,
    /// `textus-packs`: the reference-pack sections appended to the body when
    /// the skill is used ("contract", "craft#fiction", "standards#dialogue"
    /// for the document's language) - see ai::builtin::expand_skill.
    pub packs: Vec<String>,
    /// `textus-version` of a built-in skill (bumped when its behaviour
    /// changes).
    pub version: Option<String>,
    /// `textus-based-on: "<name>@<version>"`, written into a copy made with
    /// Customize… - what makes Reset allowed to delete it.
    pub based_on: Option<String>,
    /// A customized copy whose built-in has a newer version since.
    pub builtin_updated: bool,
    /// `textus-target-packs`: sections of the TARGET language's pack to
    /// attach when the request names one (translate).
    #[serde(skip)]
    pub target_packs: Vec<String>,
}

impl Default for AgentSkill {
    fn default() -> Self {
        AgentSkill {
            name: String::new(),
            description: String::new(),
            prompt: String::new(),
            category: None,
            modes: vec![AgentMode::Write],
            invocation: Invocation::Both,
            source: SkillSource::Global,
            overrides_builtin: false,
            labels: BTreeMap::new(),
            aliases: BTreeMap::new(),
            packs: Vec::new(),
            version: None,
            based_on: None,
            builtin_updated: false,
            target_packs: Vec::new(),
        }
    }
}

impl AgentSkill {
    /// Whether the model is told about this skill in the skill index and
    /// may load it by description.
    pub fn offered_to_model(&self) -> bool {
        self.invocation == Invocation::Both
    }
}

#[derive(Serialize, Clone, Default)]
#[cfg_attr(test, derive(specta::Type))]
pub struct AgentWorkspace {
    /// The global writing instructions (the global config folder's
    /// agent.md, comments stripped), in prompt order.
    pub instructions: Vec<String>,
    /// The project's writing instructions (`.textus/agent.md`), sent after
    /// the global ones and winning where the two conflict.
    pub project_instructions: Option<String>,
    /// Merged skills: the built-in ones (turned-off ones included, with
    /// `enabled: false`, so Settings can list them), then the global
    /// config folder's, then the project's, each replacing same-named
    /// skills of the layers before it. The reference packs are not here
    /// (ai::builtin::packs).
    pub skills: Vec<AgentSkill>,
    /// The project folder - the document's own by default, or the one
    /// picked in the panel - when there is one: the sandbox root for the
    /// agent's file tools. None for an unsaved draft, and for a folder too
    /// broad to expose (the home directory or a filesystem root).
    pub root: Option<String>,
    /// `.textus/style.md` - the author's style profile.
    pub style: Option<String>,
    /// `.textus/library/*.md` - the project's people, places and terms.
    pub library: Vec<crate::ai::project::LibraryEntry>,
    /// Where `root` came from - or why there is none - so the agent can
    /// tell the user which folder it reads and how to change that.
    pub root_source: RootSource,
    /// The writing conventions the style profile's front matter sets
    /// (`conventions: zh-Hans-CN/fiction`, option keys) - rules::profile.
    pub conventions: crate::ai::rules::ProjectConventions,
    /// What Textus AI remembered by itself, personal and the project's
    /// (ai::memory), with which of them fit in the prompt.
    pub memories: crate::ai::memory::Memories,
    /// Whether Textus AI may remember things by itself: the `remember`
    /// tool is offered only then (Settings > Textus AI > Remember
    /// automatically, settings.json's `rememberAutomatically`).
    pub remember: bool,
}

impl AgentWorkspace {
    /// Whether any skill can be used at all (use_skill also loads the
    /// reference packs, but only skills ask for those).
    pub fn has_usable_skills(&self) -> bool {
        !self.skills.is_empty()
    }
}

/// Why the workspace root (the project folder, to the user) is the one it
/// is, or why there is none.
#[derive(Serialize, Clone, Copy, Default, PartialEq, Debug)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum RootSource {
    /// An unsaved document and no folder chosen.
    #[default]
    None,
    /// The open document's own folder - the default.
    DocumentFolder,
    /// The nearest folder above the document that has a `.textus/` folder.
    EnclosingProject,
    /// The folder the user chose (the project menu, or Settings > Textus AI).
    Chosen,
    /// The folder would be the home folder or a drive root, which is never
    /// opened to the agent (project::is_too_broad).
    TooBroad,
}

/// The workspace as the frontend needs it: the skill list for the `/name`
/// picker in the chat input, plus the resolved project folder (`root`),
/// style profile and library the project bar shows. Loaded fresh each time
/// the chat opens so file edits are picked up without restarting.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn load_agent_workspace(
    app: AppHandle,
    doc_path: Option<String>,
    root_override: Option<String>,
) -> AgentWorkspace {
    tauri::async_runtime::spawn_blocking(move || {
        load(&app, doc_path.as_deref(), root_override.as_deref())
    })
    .await
    .unwrap_or_default()
}

/// Every skill for a document as the `/` menu and Settings list it:
/// built-ins (turned-off ones too, with `enabled: false`), then the global
/// folder's, then the project's, each replacing same-named ones. Hidden
/// skills are left out. Both arguments None (Settings) gives the built-ins
/// and the global skills.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn list_skills(
    app: AppHandle,
    doc_path: Option<String>,
    workspace_root: Option<String>,
) -> Vec<AgentSkill> {
    tauri::async_runtime::spawn_blocking(move || {
        listed(load(&app, doc_path.as_deref(), workspace_root.as_deref()).skills)
    })
    .await
    .unwrap_or_default()
}

/// Folder picker behind "Choose project folder…" (the project bar's menu
/// and Settings > Textus AI > Project Folder). Desktop only: the dialog
/// plugin has no folder picker on iOS.
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn pick_workspace_root(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        crate::commands::fs::window_file_dialog(&window).blocking_pick_folder()
    })
    .await
    .map_err(|e| e.to_string())?;
    let picked = picked.map(|p| p.to_string());
    // The home directory or a drive root would hand the agent everything
    // the user owns; refuse it here, where the choice is made, with a reason
    // the panel can show.
    if picked
        .as_deref()
        .is_some_and(|p| crate::ai::project::is_too_broad(Path::new(p)))
    {
        return Err("TOO_BROAD".to_string());
    }
    Ok(picked)
}

/// Creates the global config folder (with a starter agent.md and skills/
/// folder on first use) and reveals it in the file manager - Settings >
/// Textus AI > Global Config Folder. Desktop only: iOS has no file manager to
/// reveal a folder in (the opener plugin only opens URLs there).
#[cfg(desktop)]
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_global_agent_dir(app: AppHandle, template: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;

    let dir = ensure_global_layer(&app, &template)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// Creates the global config folder if needed (skills/ folder plus a
/// starter agent.md, same shape `open_global_agent_dir` guarantees) and
/// returns the agent.md path. Backs Settings > Textus AI > Writing
/// Instructions > Edit agent.md, which opens that file in the editor itself
/// - Textus IS a markdown editor, so there's no bespoke textarea for it.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ensure_global_agent_md(app: AppHandle, template: String) -> Result<String, String> {
    Ok(ensure_global_layer(&app, &template)?
        .join("agent.md")
        .to_string_lossy()
        .to_string())
}

/// Copies a user-picked .md skill file into the global skills folder and
/// returns the refreshed global skill list (None if the dialog was
/// cancelled). The file is stored under the skill's resolved name, so
/// re-importing an updated copy replaces the old one instead of piling up.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn import_agent_skill(
    app: AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Option<Vec<AgentSkill>>, String> {
    let picked = {
        tauri::async_runtime::spawn_blocking(move || {
            crate::commands::fs::window_file_dialog(&window)
                .add_filter("Markdown", &["md"])
                .blocking_pick_file()
        })
        .await
        .map_err(|e| e.to_string())?
    };
    let Some(src) = picked.map(|p| p.to_string()) else {
        return Ok(None);
    };

    let content = std::fs::read_to_string(&src).map_err(|e| e.to_string())?;
    let stem = Path::new(&src)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("skill")
        .to_string();
    let skill = parse_skill_file(&stem, &content);
    if skill.prompt.is_empty() {
        return Err("That file has no skill content.".to_string());
    }

    let global_dir = global_agent_dir(&app)?;
    let skills_dir = global_dir.join("skills");
    std::fs::create_dir_all(&skills_dir).map_err(|e| e.to_string())?;
    let target = skill_file_path(&skills_dir, &skill.name)?;
    crate::atomic::write(&target, &content)
        .await
        .map_err(|e| e.to_string())?;

    let (_, skills) = read_layer(&global_dir, SkillSource::Global);
    Ok(Some(skills))
}

/// Settings > Textus AI > Skills > Customize…: copies a built-in skill into
/// the global config folder's skills/, where it replaces the built-in, and
/// returns the copy's path for the frontend to open in a tab. The copy
/// gains `textus-based-on: "<name>@<version>"` under `metadata:`, which is
/// what lets Reset delete it and Settings say when the built-in has changed.
/// An existing skill of that name - an earlier copy, or the user's own - is
/// never overwritten: its path is returned instead.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn customize_builtin_skill(app: AppHandle, name: String) -> Result<String, String> {
    let skills_dir = global_agent_dir(&app)?.join("skills");
    tauri::async_runtime::spawn_blocking(move || customize_in(&skills_dir, &name))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().to_string())
}

/// Settings > Textus AI > Skills > Reset to built-in: deletes the global
/// copies Customize… made of a built-in skill (those carrying
/// `textus-based-on`), so the built-in applies again. A same-named skill the
/// user wrote or imported themselves is theirs: NOT_A_COPY, nothing
/// deleted. Nothing to delete is not an error. Returns the deleted files'
/// paths, so the frontend can close a tab still showing one: saving that
/// tab would quietly write the copy back.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn reset_builtin_skill(app: AppHandle, name: String) -> Result<Vec<String>, String> {
    let skills_dir = global_agent_dir(&app)?.join("skills");
    tauri::async_runtime::spawn_blocking(move || reset_in(&skills_dir, &name))
        .await
        .map_err(|e| e.to_string())?
}

/// Sets the panel modes a skill of the user's applies in (Settings ›
/// Extensions › Skills): rewrites `textus-modes` in its file - the global
/// folder's, or the project's for a project skill. A built-in's modes are
/// fixed.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn set_skill_modes(
    app: AppHandle,
    name: String,
    source: SkillSource,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    modes: Vec<AgentMode>,
) -> Result<(), String> {
    let dir = match source {
        SkillSource::Builtin => return Err(UNKNOWN_BUILTIN.to_string()),
        SkillSource::Global => global_agent_dir(&app)?,
        SkillSource::Project => project_dir(
            &project_root(doc_path.as_deref(), workspace_root.as_deref())
                .ok_or("No project folder.")?,
        ),
    };
    tauri::async_runtime::spawn_blocking(move || set_modes_in(&dir.join("skills"), &name, &modes))
        .await
        .map_err(|e| e.to_string())?
}

/// Save this skill, under a reply that wrote one (Create mode's `skill`
/// skill): the file goes into the global config folder's skills/ with
/// the modes the user picked - over an earlier version of the same skill.
/// Its path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn save_written_skill(
    app: AppHandle,
    text: String,
    modes: Vec<AgentMode>,
) -> Result<String, String> {
    let dir = global_agent_dir(&app)?.join("skills");
    tauri::async_runtime::spawn_blocking(move || save_written_in(&dir, &text, &modes))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests;
