//! Where a request's workspace comes from: the project folder found for
//! the document, and the global and project layers loaded over the built
//! in skills.

use super::*;

pub(crate) fn global_agent_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map_err(|e| e.to_string())
        .map(|config| config.join(GLOBAL_DIR))
}

/// The global layer's folder in the app's config folder: `textus/`, laid out
/// as a project's `.textus/` is (agent.md, skills/, memory/).
pub(crate) const GLOBAL_DIR: &str = "textus";

/// Resolves the project folder, the sandbox for the file tools: the chosen
/// folder, else the nearest enclosing folder with `.textus/`, else the
/// document's own. A chosen folder that no longer exists falls back.
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
/// `.textus/`, or the folder above `.textus/` itself (for a file inside it).
/// Stops before the home folder and a drive root, which are never a project.
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
        )
    }
}

/// [`load`] with the global layer's folder given directly, for the live eval.
#[cfg(test)]
pub(crate) fn load_from(
    global_dir: Option<&Path>,
    doc_path: Option<&str>,
    root_override: Option<&str>,
) -> AgentWorkspace {
    load_layers(global_dir, doc_path, root_override)
}

/// The three skill layers: built-in < global < project, by name; a user
/// skill replaces a built-in of the same name.
pub(crate) fn load_layers(
    global_dir: Option<&Path>,
    doc_path: Option<&str>,
    root_override: Option<&str>,
) -> AgentWorkspace {
    let mut ws = AgentWorkspace {
        skills: builtin::skills().to_vec(),
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
        let (instructions, skills) = read_layer(&project_dir(root), SkillSource::Project);
        ws.project_instructions = instructions;
        // Project skills shadow same-named global and built-in ones.
        for skill in skills {
            push_layer_skill(&mut ws.skills, skill);
        }
    }
    ws.memories = crate::ai::memory::MemoryDirs::new(global_dir, root.as_deref()).load();

    ws
}

pub(crate) fn listed(skills: Vec<AgentSkill>) -> Vec<AgentSkill> {
    skills
        .into_iter()
        .filter(|s| s.invocation != Invocation::Hidden)
        .collect()
}

/// Guarantees the global config folder exists with its starter files; returns
/// it. `template` is the starter agent.md, written only when there is none:
/// all HTML comments, which never reach the model.
pub(crate) fn ensure_global_layer(app: &AppHandle, template: &str) -> Result<PathBuf, String> {
    let dir = global_agent_dir(app)?;
    std::fs::create_dir_all(dir.join("skills")).map_err(|e| e.to_string())?;
    let agent_md = dir.join("agent.md");
    if !agent_md.exists() {
        crate::atomic::write_sync(&agent_md, template).map_err(|e| e.to_string())?;
    }
    Ok(dir)
}
