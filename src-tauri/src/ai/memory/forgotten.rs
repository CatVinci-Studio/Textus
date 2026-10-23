//! What was deleted or forgotten, kept a while to bring back: a deleted
//! memory or library entry moves into its folder's `.forgotten/` instead
//! of going, and the Memory tab lists the newest of them with Restore.
//! The folder holds at most FORGOTTEN_KEPT; the oldest go past that.

use super::*;

pub(crate) const FORGOTTEN: &str = ".forgotten";

/// How many forgotten files each folder keeps.
pub(crate) const FORGOTTEN_KEPT: usize = 30;

/// One forgotten memory or library entry, for the Memory tab.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct Forgotten {
    /// `forgotten/<scope>/<folder>/<stem>`, for Restore.
    pub id: String,
    pub scope: Scope,
    /// A library entry's name; None for a memory.
    pub name: Option<String>,
    pub text: String,
    /// When it was forgotten, as `2026-10-18T09:30:00Z`.
    pub forgotten: String,
}

impl MemoryDirs {
    /// Moves `path` (in `scope`'s `folder`) into that folder's
    /// `.forgotten/`, and lets the oldest there go past FORGOTTEN_KEPT.
    pub(crate) fn set_aside(&self, path: &Path) -> Result<(), String> {
        let Some(dir) = path.parent() else {
            return Err("No folder.".into());
        };
        let aside = dir.join(FORGOTTEN);
        std::fs::create_dir_all(&aside).map_err(|e| e.to_string())?;
        let target = free_path(&aside, &file_stem(path));
        std::fs::rename(path, &target).map_err(|e| e.to_string())?;
        // Its mtime is when it was forgotten.
        let _ = std::fs::File::options()
            .append(true)
            .open(&target)
            .and_then(|f| f.set_modified(std::time::SystemTime::now()));
        let mut kept = forgotten_files(&aside);
        while kept.len() > FORGOTTEN_KEPT {
            let (oldest, _) = kept.remove(kept.len() - 1);
            let _ = std::fs::remove_file(oldest);
        }
        Ok(())
    }

    /// The forgotten memories and library entries, newest first.
    pub fn forgotten(&self) -> Vec<Forgotten> {
        let mut all = Vec::new();
        for (scope, folder) in [
            (Scope::Personal, MEMORY_FOLDER),
            (Scope::Project, MEMORY_FOLDER),
            (Scope::Project, LIBRARY_FOLDER),
        ] {
            let Some(dir) = self.folder(scope, folder) else {
                continue;
            };
            for (path, secs) in forgotten_files(&dir.join(FORGOTTEN)) {
                let Ok(content) = std::fs::read_to_string(&path) else {
                    continue;
                };
                let (front, body) = split_frontmatter(&content);
                let name = (folder == LIBRARY_FOLDER)
                    .then(|| front.and_then(|f| f.fields.get("name").cloned()))
                    .flatten();
                all.push((
                    secs,
                    Forgotten {
                        id: format!("forgotten/{}/{folder}/{}", scope.as_str(), file_stem(&path)),
                        scope,
                        name,
                        text: strip_html_comments(&body).trim().to_string(),
                        forgotten: timestamp(secs),
                    },
                ));
            }
        }
        all.sort_by_key(|f| std::cmp::Reverse(f.0));
        all.into_iter().map(|(_, f)| f).collect()
    }

    /// Puts a forgotten memory or library entry back where it was; its
    /// new id.
    pub fn restore(&self, id: &str) -> Result<String, String> {
        let unknown = || format!("Nothing forgotten as `{id}`.");
        let rest = id.strip_prefix("forgotten/").ok_or_else(unknown)?;
        let loc = self.locate(rest).map_err(|_| unknown())?;
        let dir = loc.path.parent().ok_or_else(unknown)?;
        let stem = file_stem(&loc.path);
        let aside = dir.join(FORGOTTEN).join(format!("{stem}.md"));
        if !std::fs::symlink_metadata(&aside).is_ok_and(|m| m.file_type().is_file()) {
            return Err(unknown());
        }
        let target = free_path(dir, &stem);
        std::fs::rename(&aside, &target).map_err(|e| e.to_string())?;
        Ok(id_of(loc.scope, loc.folder, &target))
    }

    /// The forgotten copy of the file at `path`, gone: Undo of a forget
    /// put the file itself back.
    pub(crate) fn drop_forgotten_copy(&self, path: &Path) {
        if let Some(dir) = path.parent() {
            let copy = dir.join(FORGOTTEN).join(format!("{}.md", file_stem(path)));
            if std::fs::symlink_metadata(&copy).is_ok_and(|m| m.file_type().is_file()) {
                let _ = std::fs::remove_file(copy);
            }
        }
    }
}

/// The `.md` files in a `.forgotten/` folder with their mtimes (seconds),
/// newest first.
fn forgotten_files(dir: &Path) -> Vec<(PathBuf, u64)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<(PathBuf, u64)> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("md"))
        .map(|p| {
            let secs = std::fs::metadata(&p)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            (p, secs)
        })
        .collect();
    files.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    files
}
