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

/// The project's settings folder. The project folder is the document's own
/// unless the user chose another; the global config folder applies to every
/// document, and a project skill shadows a global one of the same name.
pub const WORKSPACE_DIR_NAME: &str = ".textus";

/// Where a project's settings live: `<project folder>/.textus/`.
pub fn project_dir(root: &Path) -> PathBuf {
    root.join(WORKSPACE_DIR_NAME)
}

/// One project file, when it exists: `.textus/<rel>`.
pub fn project_file(root: &Path, rel: &str) -> Option<PathBuf> {
    Some(project_dir(root).join(rel)).filter(|path| path.is_file())
}

/// Who may start a skill (`metadata.textus-invocation`). `Both`: the model and
/// /name. `UserOnly`: /name only. `Hidden`: neither; loaded by exact name with
/// use_skill (the reference packs).
#[derive(Serialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum Invocation {
    #[default]
    Both,
    UserOnly,
    Hidden,
}

/// Which layer a skill comes from: built in, the global config folder, or the
/// project. Each layer replaces same-named skills of the ones before it.
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

/// One skill as the app sees it: the frontmatter's name and description, the
/// body (`prompt`, comments stripped) and the Textus-only `metadata:` keys.
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
    /// `textus-modes`: the panel modes the skill applies in. Write for a skill
    /// that doesn't say.
    pub modes: Vec<AgentMode>,
    /// `textus-off`: turned off in Settings for now, its modes kept for when
    /// it is turned on again. Neither the model nor the `/` menu offers it.
    pub off: bool,
    pub invocation: Invocation,
    pub source: SkillSource,
    /// A global or project skill with a built-in skill's name, which it
    /// replaces.
    pub overrides_builtin: bool,
    /// What people see it called, and its one-line hint, per UI language code
    /// (`textus-label-<code>`, `textus-hint-<code>`), for market or user skills.
    pub labels: BTreeMap<String, SkillLabel>,
    /// Extra words the user can type after `/`, per UI language code
    /// (`textus-aliases-<code>`, comma-separated).
    pub aliases: BTreeMap<String, Vec<String>>,
    /// `textus-packs`: the reference-pack sections appended to the body when the
    /// skill is used ("craft#fiction", "standards#dialogue").
    pub packs: Vec<String>,
    /// `textus-version` of a built-in skill (bumped when its behaviour
    /// changes).
    pub version: Option<String>,
    /// `textus-based-on: "<name>@<version>"`, written into a Customize… copy;
    /// what allows Reset to delete it.
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
            off: false,
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
    /// Merged skills: the built-ins (turned-off ones too, so Settings can list
    /// them), then the global folder's, then the project's, each replacing
    /// same-named ones before it.
    pub skills: Vec<AgentSkill>,
    /// The project folder, the sandbox root for the agent's file tools. None for
    /// an unsaved draft, and for a folder too broad to expose.
    pub root: Option<String>,
    /// `.textus/style.md` - the author's style profile.
    pub style: Option<String>,
    /// `.textus/library/*.md` - the project's people, places and terms.
    pub library: Vec<crate::ai::project::LibraryEntry>,
    /// Where `root` came from, or why there is none, so the agent can tell the
    /// user which folder it reads and how to change that.
    pub root_source: RootSource,
    /// The writing conventions the style profile's front matter sets.
    pub conventions: crate::ai::rules::ProjectConventions,
    /// What Textus AI remembered by itself, with which of them fit in the prompt.
    pub memories: crate::ai::memory::Memories,
    /// Whether Textus AI may remember things by itself.
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
    /// The folder would be the home folder or a drive root, never opened to the
    /// agent.
    TooBroad,
}

/// The workspace as the frontend needs it: skills, the resolved project
/// folder, style profile and library. Loaded fresh each time so edits show.
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

/// Every skill for a document as the `/` menu and Settings list it, hidden ones
/// left out. Both arguments None (Settings) gives built-ins and global skills.
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

/// Folder picker behind "Choose project folder…". Desktop only: the dialog
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
    // The home directory or a drive root would hand the agent everything the user
    // owns: refuse it here, with a reason the panel can show.
    if picked
        .as_deref()
        .is_some_and(|p| crate::ai::project::is_too_broad(Path::new(p)))
    {
        return Err("TOO_BROAD".to_string());
    }
    Ok(picked)
}

/// Creates the global config folder (with a starter agent.md and skills/) and
/// reveals it in the file manager. Desktop only: iOS has no file manager.
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

/// Creates the global config folder if needed and returns the agent.md path,
/// which the frontend opens in the editor itself.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn ensure_global_agent_md(app: AppHandle, template: String) -> Result<String, String> {
    Ok(ensure_global_layer(&app, &template)?
        .join("agent.md")
        .to_string_lossy()
        .to_string())
}

/// Copies a user-picked .md skill file into the global skills folder and returns
/// the refreshed list (None if cancelled). Stored under the skill's name, so
/// re-importing replaces the old copy.
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

/// Customize…: copies a built-in skill into the global skills/, where it
/// replaces the built-in, marked `textus-based-on`, and returns its path. An
/// existing skill of that name is never overwritten: its path is returned.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn customize_builtin_skill(app: AppHandle, name: String) -> Result<String, String> {
    let skills_dir = global_agent_dir(&app)?.join("skills");
    tauri::async_runtime::spawn_blocking(move || customize_in(&skills_dir, &name))
        .await
        .map_err(|e| e.to_string())?
        .map(|p| p.to_string_lossy().to_string())
}

/// Reset to built-in: deletes the Customize… copies (those with
/// `textus-based-on`); a same-named skill the user wrote is NOT_A_COPY. Returns
/// the deleted paths, so the frontend can close tabs that would write them back.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn reset_builtin_skill(app: AppHandle, name: String) -> Result<Vec<String>, String> {
    let skills_dir = global_agent_dir(&app)?.join("skills");
    tauri::async_runtime::spawn_blocking(move || reset_in(&skills_dir, &name))
        .await
        .map_err(|e| e.to_string())?
}

/// Sets the panel modes a user's skill applies in, rewriting `textus-modes` in
/// its file. A built-in's modes are fixed.
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

/// Turns a user's skill off for now, or on again, rewriting `textus-off` in
/// its file. A built-in is always on.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn set_skill_off(
    app: AppHandle,
    name: String,
    source: SkillSource,
    doc_path: Option<String>,
    workspace_root: Option<String>,
    off: bool,
) -> Result<(), String> {
    let dir = match source {
        SkillSource::Builtin => return Err(UNKNOWN_BUILTIN.to_string()),
        SkillSource::Global => global_agent_dir(&app)?,
        SkillSource::Project => project_dir(
            &project_root(doc_path.as_deref(), workspace_root.as_deref())
                .ok_or("No project folder.")?,
        ),
    };
    tauri::async_runtime::spawn_blocking(move || set_off_in(&dir.join("skills"), &name, off))
        .await
        .map_err(|e| e.to_string())?
}

/// Saves a skill a Create-mode reply wrote into the global skills/ with the
/// picked modes, over an earlier version. Returns its path.
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
