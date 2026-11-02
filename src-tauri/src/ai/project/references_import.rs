//! Importing into the reference library: files, a folder, or a zip of them,
//! copied into the project's `references/` folder. Only what the tools can
//! read is kept; a zip is unpacked into a folder named after it, never outside
//! it. Nothing already there is overwritten.

use super::*;
use std::io::Read;

/// Most files one import brings in, and most bytes a zip may unpack to.
const MAX_IMPORTED_FILES: usize = 2_000;
const MAX_UNPACKED_BYTES: u64 = 1024 * 1024 * 1024;

/// What an import did.
#[derive(Debug, Default, PartialEq, Serialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ImportedReferences {
    /// Files copied or unpacked into references/.
    pub imported: u32,
    /// Files left out: not a kind the tools read, too large, or past a limit.
    pub skipped: u32,
}

/// Whether the tools can read a file named `name`: text or a document.
fn readable(name: &str) -> bool {
    matches!(
        file_kind(Path::new(name)),
        Some(FileKind::Text | FileKind::Document)
    )
}

/// `want`, or `want (2)`, `want (3)`… - whichever is free.
fn free_path(want: &Path) -> PathBuf {
    if !want.exists() {
        return want.to_path_buf();
    }
    let stem = want.file_stem().and_then(|s| s.to_str()).unwrap_or("file");
    let ext = want
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    (2..)
        .map(|n| want.with_file_name(format!("{stem} ({n}){ext}")))
        .find(|p| !p.exists())
        .unwrap_or_else(|| want.to_path_buf())
}

/// `name` as one safe path component.
fn component(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '-' } else { c })
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').to_string();
    if cleaned.is_empty() {
        "references".into()
    } else {
        cleaned
    }
}

struct Importer {
    into: PathBuf,
    done: ImportedReferences,
}

impl Importer {
    fn full(&self) -> bool {
        (self.done.imported as usize) >= MAX_IMPORTED_FILES
    }

    /// Writes `bytes` (or copies `from`) to `rel` under references/.
    fn put(&mut self, rel: &Path, write: impl FnOnce(&Path) -> std::io::Result<()>) {
        if self.full() {
            self.done.skipped += 1;
            return;
        }
        let to = free_path(&self.into.join(rel));
        let wrote = to
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|_| write(&to));
        match wrote {
            Ok(()) => self.done.imported += 1,
            Err(_) => self.done.skipped += 1,
        }
    }

    fn file(&mut self, path: &Path, rel: &Path) {
        if size_of(path) > crate::extract::MAX_SOURCE_BYTES {
            self.done.skipped += 1;
            return;
        }
        self.put(rel, |to| std::fs::copy(path, to).map(|_| ()));
    }

    /// A folder's readable files, kept in their subfolders under its name.
    fn folder(&mut self, dir: &Path) {
        let name = component(
            &dir.file_name()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default(),
        );
        let walked = walk_readable_files(dir, false);
        for rel in &walked.files {
            self.file(&dir.join(rel), &Path::new(&name).join(rel));
        }
        if walked.truncated {
            self.done.skipped += 1;
        }
    }

    /// A zip's readable entries, under a folder named after it. Entry names
    /// that would leave that folder (`../`, absolute) are skipped.
    fn zip(&mut self, path: &Path) -> Result<(), String> {
        let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| format!("Not a zip file Textus can open: {e}"))?;
        let name = component(
            &path
                .file_stem()
                .map(|n| n.to_string_lossy())
                .unwrap_or_default(),
        );
        let mut unpacked = 0u64;
        for i in 0..archive.len() {
            let Ok(mut entry) = archive.by_index(i) else {
                self.done.skipped += 1;
                continue;
            };
            if entry.is_dir() {
                continue;
            }
            let Some(rel) = entry.enclosed_name() else {
                self.done.skipped += 1;
                continue;
            };
            // macOS's resource forks and hidden files are not material.
            let hidden = rel.components().any(|c| {
                let part = c.as_os_str().to_string_lossy();
                part == "__MACOSX" || is_hidden(&part)
            });
            if hidden || !readable(&rel.to_string_lossy()) {
                self.done.skipped += 1;
                continue;
            }
            let size = entry.size();
            if size > crate::extract::MAX_SOURCE_BYTES || unpacked + size > MAX_UNPACKED_BYTES {
                self.done.skipped += 1;
                continue;
            }
            unpacked += size;
            self.put(&Path::new(&name).join(rel), |to| {
                let mut out = std::fs::File::create(to)?;
                // Never more than the entry says, whatever the archive claims.
                std::io::copy(&mut (&mut entry).take(size), &mut out).map(|_| ())
            });
        }
        Ok(())
    }
}

/// Imports `sources` (files, folders, zips) into `root`'s references/ folder.
pub fn import_references(root: &Path, sources: &[PathBuf]) -> Result<ImportedReferences, String> {
    let into = root.join(REFERENCES_DIR);
    std::fs::create_dir_all(&into).map_err(|e| e.to_string())?;
    let mut importer = Importer {
        into,
        done: ImportedReferences::default(),
    };
    for source in sources {
        let name = source
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        // The library itself, or a folder in it: already imported.
        if source.starts_with(&importer.into) {
            importer.done.skipped += 1;
        } else if source.is_dir() {
            importer.folder(source);
        } else if crate::extract::extension_of(source) == "zip" {
            importer.zip(source)?;
        } else if readable(&name) {
            importer.file(source, Path::new(&component(&name)));
        } else {
            importer.done.skipped += 1;
        }
    }
    Ok(importer.done)
}
