//! Where a request's workspace comes from: the project folder found for
//! the document, and the global and project layers loaded over the built
//! in skills.

use super::*;

pub(crate) fn global_agent_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .map(|p| p.join("agent"))
}

/// Resolves the workspace root - the project folder: the folder `.textus/`
/// is read from and the sandbox boundary the `find_files`/`read_file` tools
/// may not escape.
///
/// `root_override` is the chosen project folder ("Choose project folder…"
/// in the project bar, or Settings > Textus AI > Project Folder) - one
/// setting for every document, unsaved drafts included. Without it, the
/// project is the nearest folder holding the document that has a `.textus/`
/// folder (enclosing_project), else the document's own folder: a chapter in
/// `novel/part-1/` belongs to `novel/` once `novel/.textus/` exists, and a
/// folder of chapters with notes next to the draft needs nothing at all.
///
/// An override that no longer exists (a moved or unmounted folder) falls
/// back to the document's project rather than leaving the agent with no
/// workspace at all.
pub(crate) fn resolve_root(doc_path: Option<&str>, root_override: Option<&str>) -> Option<PathBuf> {
    let picked = root_override
        .map(str::trim)
        .filter(|p| !p.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_dir());
    picked.or_else(|| {
        let folder = document_folder(doc_path)?;
        Some(enclosing_project(folder).unwrap_or_else(|| folder.to_path_buf()))
    })
}

pub(crate) fn document_folder(doc_path: Option<&str>) -> Option<&Path> {
    doc_path
        .map(Path::new)
        .and_then(|p| p.parent())
        .filter(|p| !p.as_os_str().is_empty())
}

/// The nearest folder from `folder` upwards that is a project: one holding
/// a `.textus/` folder, or the folder above `.textus/` itself - a file of
/// the project's own (.textus/library/Lin.md, opened from the Memory tab)
/// belongs to it; left at its own folder, the panel took .textus/library
/// for the project and showed an empty library right after New library
/// entry. The walk stops before the home folder and a drive root, which
/// are never a project (project::is_too_broad) - a `.textus/` there would
/// make every document under it part of one.
pub(crate) fn enclosing_project(folder: &Path) -> Option<PathBuf> {
    for dir in folder.ancestors() {
        if dir.file_name().and_then(|n| n.to_str()) == Some(WORKSPACE_DIR_NAME) {
            return dir.parent().map(Path::to_path_buf);
        }
        if crate::ai::project::is_too_broad(dir) {
            return None;
        }
        if project_dir(dir).is_dir() {
            return Some(dir.to_path_buf());
        }
    }
    None
}

/// The project folder the agent may read: the resolved root, unless it is
/// too broad to treat as one (a home folder, a drive root).
pub(crate) fn project_root(doc_path: Option<&str>, root_override: Option<&str>) -> Option<PathBuf> {
    resolve_root(doc_path, root_override).filter(|root| !crate::ai::project::is_too_broad(root))
}

/// Loads the merged agent workspace for a document: the built-in skills,
/// then the global config folder, then the project folder's `.textus/`
/// layer on top.
pub fn load(
    app: &AppHandle,
    doc_path: Option<&str>,
    root_override: Option<&str>,
) -> AgentWorkspace {
    AgentWorkspace {
        remember: crate::ai::memory::remember_enabled(app),
        ..load_layers(
            global_agent_dir(app).ok().as_deref(),
            doc_path,
            root_override,
            &disabled_builtin_skills(app),
        )
    }
}

/// [`load`] with the global layer's folder given directly and no built-in
/// skill turned off - the live eval's loader, which builds real workspaces
/// on disk to exercise exactly this path.
#[cfg(test)]
pub(crate) fn load_from(
    global_dir: Option<&Path>,
    doc_path: Option<&str>,
    root_override: Option<&str>,
) -> AgentWorkspace {
    load_layers(global_dir, doc_path, root_override, &[])
}

/// The three skill layers: built-in < global < project, by name. A
/// built-in in `disabled` stays in the list, turned off, so Settings can
/// show it; a user skill of the same name still replaces it.
pub(crate) fn load_layers(
    global_dir: Option<&Path>,
    doc_path: Option<&str>,
    root_override: Option<&str>,
    disabled: &[String],
) -> AgentWorkspace {
    let mut ws = AgentWorkspace {
        skills: builtin::skills()
            .iter()
            .map(|s| AgentSkill {
                enabled: !disabled.contains(&s.name),
                ..s.clone()
            })
            .collect(),
        ..AgentWorkspace::default()
    };

    if let Some(global_dir) = global_dir {
        let (instructions, skills) = read_layer(global_dir, SkillSource::Global);
        ws.instructions.extend(instructions);
        for skill in skills {
            push_layer_skill(&mut ws.skills, skill);
        }
    }

    let resolved = resolve_root(doc_path, root_override);
    let chosen = root_override
        .map(str::trim)
        .is_some_and(|p| !p.is_empty() && Path::new(p).is_dir());
    ws.root_source = match &resolved {
        None => RootSource::None,
        Some(root) if crate::ai::project::is_too_broad(root) => RootSource::TooBroad,
        Some(_) if chosen => RootSource::Chosen,
        Some(root) if Some(root.as_path()) != document_folder(doc_path) => {
            RootSource::EnclosingProject
        }
        Some(_) => RootSource::DocumentFolder,
    };
    let root = resolved.filter(|_| ws.root_source != RootSource::TooBroad);
    if let Some(root) = root.as_deref() {
        ws.root = Some(root.to_string_lossy().to_string());
        ws.style = crate::ai::project::read_style(root);
        ws.conventions = crate::ai::project::style_conventions(ws.style.as_deref());
        ws.library = crate::ai::project::read_library(root);
        ws.levis_project = crate::ai::levis_project::unconverted(root);
        let (instructions, skills) = read_layer(&project_dir(root), SkillSource::Project);
        ws.project_instructions = instructions;
        // Project skills shadow same-named global and built-in ones.
        for skill in skills {
            push_layer_skill(&mut ws.skills, skill);
        }
    }
    ws.memories = crate::ai::memory::MemoryDirs::new(global_dir, root.as_deref()).load();

    // A copy made by Customize… is still that built-in as far as the
    // switch in Settings goes: turning the built-in off turns the copy off.
    // A skill the user wrote by hand with the same name is theirs and stays.
    for skill in &mut ws.skills {
        if skill.based_on.is_some() && disabled.contains(&skill.name) {
            skill.enabled = false;
        }
    }

    ws
}

pub(crate) fn listed(skills: Vec<AgentSkill>) -> Vec<AgentSkill> {
    skills
        .into_iter()
        .filter(|s| s.invocation != Invocation::Hidden)
        .collect()
}

/// Guarantees the global config folder exists with its starter files;
/// returns it. `template` is the starter agent.md in the UI language
/// (`agentInstructionsTemplate` in src/i18n/locales/): a how-to written
/// entirely in HTML comments, which `read_layer` strips before anything
/// reaches the model - so it teaches without polluting the system prompt.
/// It is only written when there is no agent.md yet.
pub(crate) fn ensure_global_layer(app: &AppHandle, template: &str) -> Result<PathBuf, String> {
    let dir = global_agent_dir(app)?;
    std::fs::create_dir_all(dir.join("skills")).map_err(|e| e.to_string())?;
    let agent_md = dir.join("agent.md");
    if !agent_md.exists() {
        crate::atomic::write_sync(&agent_md, template).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}
