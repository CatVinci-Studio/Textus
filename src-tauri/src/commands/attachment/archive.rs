//! Attached zip archives, unpacked into the conversation's attachments so
//! the agent reads what is inside like any attached file.

use std::io::Read;
use std::path::Path;

/// The most an archive may unpack to, in files and bytes: a zip bomb stops
/// here rather than filling the disk.
const MAX_FILES: usize = 2000;
const MAX_BYTES: u64 = 512 * 1024 * 1024;

/// Unpacks `archive` into `to`, and returns the files, relative to `to`.
/// Links and the folders macOS adds (`__MACOSX`) are left out.
pub(super) fn unpack(archive: &Path, to: &Path) -> Result<Vec<String>, String> {
    let reader = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(reader)
        .map_err(|_| "That archive isn't a zip file Textus can open.".to_string())?;
    let mut files = Vec::new();
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() || entry.is_symlink() {
            continue;
        }
        // A name with `..` or an absolute path would land outside `to`.
        let Some(rel) = entry.enclosed_name() else {
            continue;
        };
        if rel.components().any(|c| c.as_os_str() == "__MACOSX") {
            continue;
        }
        if files.len() == MAX_FILES {
            return Err(format!("That archive holds more than {MAX_FILES} files."));
        }
        let target = to.join(&rel);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut bytes = Vec::new();
        (&mut entry)
            .take(MAX_BYTES + 1 - total)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        total += bytes.len() as u64;
        if total > MAX_BYTES {
            return Err("That archive is too large to unpack.".to_string());
        }
        std::fs::write(&target, bytes).map_err(|e| e.to_string())?;
        files.push(rel.to_string_lossy().replace('\\', "/"));
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn unpacks_files_and_skips_what_could_escape() {
        let dir = std::env::temp_dir().join(format!("textus-unpack-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let archive = dir.join("notes.zip");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&archive).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        for (name, text) in [
            ("a.md", "alpha"),
            ("sub/b.txt", "beta"),
            ("__MACOSX/._a.md", "junk"),
            ("../escape.txt", "no"),
        ] {
            zip.start_file(name, options).unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap();

        let out = dir.join("out");
        let files = unpack(&archive, &out).unwrap();

        assert_eq!(files, ["a.md", "sub/b.txt"]);
        assert_eq!(
            std::fs::read_to_string(out.join("sub/b.txt")).unwrap(),
            "beta"
        );
        assert!(!dir.join("escape.txt").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
