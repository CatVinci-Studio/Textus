//! The catalog's skills: listed, and installed into the global skills
//! folder, never over one of the same name.

use super::*;

/// The skills the catalog last fetched (or kept) lists.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub fn skill_catalog() -> Vec<SkillEntry> {
    FETCHED_SKILLS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

/// The error when a skill of that name exists already; it is never overwritten.
/// Its error code (errors.json).
pub const SKILL_EXISTS: &str = "skillExists";

/// Installs skill `name` from the catalog last fetched into the global skills/
/// folder, after checking it. Returns its path.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn skill_install_catalog(app: tauri::AppHandle, name: String) -> Result<String, String> {
    let entry = FETCHED_SKILLS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .iter()
        .find(|s| s.name == name)
        .cloned()
        .ok_or_else(|| format!("{name} isn't in the catalog."))?;
    let skills = crate::ai::workspace::global_agent_dir(&app)?.join("skills");
    let present = installed_skill_version(&skills, &entry.name);
    let package = ext_stats::Download {
        kind: ext_stats::Kind::Skill,
        id: &entry.name,
        version: &entry.version,
        update: present
            .as_ref()
            .is_some_and(|v| is_newer(&v.to_string(), &entry.version)),
        present: present.is_some(),
        direct: &entry.url,
    };
    let bytes = download_counted(&app, package, &name).await?;
    if bytes.len() as u64 != entry.size
        || !hex(&Sha256::digest(&bytes)).eq_ignore_ascii_case(&entry.sha256)
    {
        return Err(format!(
            "The download of {name} isn't the file the catalog lists - it was not installed."
        ));
    }
    let text = String::from_utf8(bytes).map_err(|_| format!("{name} isn't a skill file."))?;
    let path = install_skill_in(&skills, &entry.name, &text)?;
    ext_stats::installed(&app, ext_stats::Kind::Skill, &entry.name);
    Ok(path.to_string_lossy().into_owned())
}

/// The version of the catalog skill `name` installed in `dir`, when one of
/// that name is there with a version (one the user wrote has none).
fn installed_skill_version(dir: &std::path::Path, name: &str) -> Option<semver::Version> {
    crate::ai::workspace::read_skill_files(dir)
        .into_iter()
        .find(|(_, s)| s.name.eq_ignore_ascii_case(name))
        .and_then(|(_, s)| semver::Version::parse(s.version?.trim()).ok())
}

/// Writes a skill file named `name` into `dir`: never over one there, but
/// over an older version of the same catalog skill (an update).
pub(super) fn install_skill_in(
    dir: &std::path::Path,
    name: &str,
    text: &str,
) -> Result<std::path::PathBuf, String> {
    let skill = crate::ai::workspace::parse_skill_file(name, text);
    if skill.prompt.is_empty() {
        return Err(format!("{name} isn't a skill file."));
    }
    let taken = crate::ai::workspace::read_skill_files(dir)
        .into_iter()
        .find(|(_, s)| s.name.eq_ignore_ascii_case(&skill.name));
    let Some((path, _)) = taken else {
        return crate::ai::workspace::write_skill_file(
            dir,
            name,
            crate::ai::workspace::OnTaken::Refuse(SKILL_EXISTS),
            |_| text.to_string(),
        );
    };
    let newer = match (installed_skill_version(dir, &skill.name), &skill.version) {
        (Some(have), Some(offered)) => is_newer(&have.to_string(), offered),
        _ => false,
    };
    if !newer {
        return Err(crate::errors::error(SKILL_EXISTS));
    }
    crate::atomic::write_sync(&path, text).map_err(|e| e.to_string())?;
    Ok(path)
}
