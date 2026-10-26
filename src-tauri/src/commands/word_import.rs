//! Opening a Word document (.docx) as a new, untitled Markdown document; the
//! .docx is only read. Pictures go to the drafts' image folder, named as pasted
//! ones, so the first save moves them like a paste.

use super::fs::{draft_assets_dir, require_non_empty, write_new_file_sync};
use crate::extract::{docx_document, extension_of, MAX_SOURCE_BYTES};
use serde::Serialize;
use std::path::Path;

/// What `open_word_document` hands the frontend.
#[derive(Serialize)]
#[cfg_attr(test, derive(specta::Type))]
pub struct WordDocument {
    markdown: String,
}

#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn open_word_document(
    app: tauri::AppHandle,
    path: String,
) -> Result<WordDocument, String> {
    require_non_empty(&path)?;
    let assets = draft_assets_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || convert(Path::new(&path), &assets))
        .await
        .map_err(|e| e.to_string())?
        .map(|markdown| WordDocument { markdown })
}

fn convert(path: &Path, assets: &Path) -> Result<String, String> {
    if extension_of(path) != "docx" {
        return Err("Only Word documents (.docx) can be opened this way.".to_string());
    }
    let size = std::fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_SOURCE_BYTES {
        return Err("This Word document is too large to open.".to_string());
    }
    // One stamp for the whole document: image-<stamp>.png, image-<stamp>-1.jpeg...
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    docx_document(path, &mut |name, bytes| {
        save_picture(assets, stamp, name, bytes)
    })
}

/// Writes one picture of the document into `assets` and returns its src: an
/// absolute path with forward slashes, since a backslash would escape in Markdown.
fn save_picture(assets: &Path, stamp: u128, name: &str, bytes: &[u8]) -> Option<String> {
    let ext = extension_of(Path::new(name));
    if ext.is_empty() || !ext.chars().all(|c| c.is_ascii_alphanumeric()) {
        return None;
    }
    std::fs::create_dir_all(assets).ok()?;
    let saved = write_new_file_sync(assets, &format!("image-{stamp}.{ext}"), bytes, false).ok()?;
    Some(assets.join(saved).to_string_lossy().replace('\\', "/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pictures_get_unique_pasted_image_names_in_the_drafts_folder() {
        let dir = tempfile::tempdir().unwrap();
        let assets = dir.path().join("assets");
        let first = save_picture(&assets, 7, "image1.png", b"one").unwrap();
        let second = save_picture(&assets, 7, "image2.PNG", b"two").unwrap();
        let root = assets.to_string_lossy().replace('\\', "/");
        assert_eq!(first, format!("{root}/image-7.png"));
        assert_eq!(second, format!("{root}/image-7-1.png"));
        assert_eq!(std::fs::read(assets.join("image-7-1.png")).unwrap(), b"two");
        assert_eq!(save_picture(&assets, 7, "no-extension", b"x"), None);
    }

    /// Every file under `dir`, relative and sorted.
    fn files_under(dir: &Path) -> Vec<String> {
        let mut files = Vec::new();
        let mut pending = vec![dir.to_path_buf()];
        while let Some(next) = pending.pop() {
            for entry in std::fs::read_dir(&next).unwrap().flatten() {
                let path = entry.path();
                if path.is_dir() {
                    pending.push(path);
                } else {
                    let rel = path.strip_prefix(dir).unwrap();
                    files.push(rel.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        files.sort();
        files
    }

    fn fingerprint(path: &Path) -> (u64, std::time::SystemTime) {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        std::fs::read(path).unwrap().hash(&mut hasher);
        let mtime = std::fs::metadata(path).unwrap().modified().unwrap();
        (hasher.finish(), mtime)
    }

    /// Opening a Word document never touches it: open, convert and the first Save
    /// As leave the .docx byte for byte and mtime as it was.
    #[test]
    fn open_convert_and_save_as_leave_the_word_file_untouched() {
        let root = tempfile::tempdir().unwrap();
        let docs = root.path().join("docs");
        let assets = root.path().join("app-data").join("assets");
        std::fs::create_dir_all(&docs).unwrap();
        let docx = docs.join("Report.docx");
        let rels = (
            "word/_rels/document.xml.rels",
            r#"<Relationships><Relationship Id="rId4" Type="image" Target="media/image1.png"/></Relationships>"#,
        );
        let body = r#"<w:p><w:r><w:t>Price: $5</w:t></w:r></w:p><w:p><w:r><w:drawing><wp:inline xmlns:wp="wp"><wp:docPr id="1" descr="Chart"/><a:graphic xmlns:a="a"><a:graphicData><pic:pic xmlns:pic="pic"><pic:blipFill><a:blip r:embed="rId4"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>"#;
        std::fs::write(
            &docx,
            crate::extract::test_docx_with(body, &[rels, ("word/media/image1.png", "PNG")]),
        )
        .unwrap();
        let before = fingerprint(&docx);
        // A coarse filesystem clock must not hide a write.
        std::thread::sleep(std::time::Duration::from_millis(20));

        let markdown = convert(&docx, &assets).unwrap();
        let src = markdown
            .split("](")
            .nth(1)
            .and_then(|rest| rest.split(')').next())
            .unwrap()
            .to_string();
        assert!(src.starts_with(&assets.to_string_lossy().replace('\\', "/")));
        assert_eq!(files_under(&docs), ["Report.docx"]);

        let md = docs.join("Report.md");
        crate::atomic::write_sync(&md, &markdown).unwrap();
        let moved = tauri::async_runtime::block_on(super::super::fs::migrate_images(
            &md,
            vec![src.clone()],
            "assets/",
            None,
            &assets,
        ))
        .unwrap();
        let moved = serde_json::to_value(&moved).unwrap();
        let new_src = moved[0]["new"].as_str().unwrap().to_string();
        crate::atomic::write_sync(&md, markdown.replace(&src, &new_src)).unwrap();

        assert_eq!(fingerprint(&docx), before);
        let picture = format!("assets/{}", new_src.trim_start_matches("assets/"));
        assert_eq!(
            files_under(&docs),
            ["Report.docx".to_string(), "Report.md".to_string(), picture]
        );
        // The draft copy moved, rather than staying behind.
        assert_eq!(files_under(&assets), Vec::<String>::new());
    }

    #[test]
    fn only_a_docx_is_converted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.md");
        std::fs::write(&path, "# Notes").unwrap();
        assert!(convert(&path, dir.path()).is_err());
    }

    #[test]
    fn a_word_document_becomes_markdown_and_is_left_as_it_was() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("Report.docx");
        let bytes = crate::extract::test_docx(&["Price: $5 *each*"]);
        std::fs::write(&path, &bytes).unwrap();
        assert_eq!(
            convert(&path, &dir.path().join("assets")).unwrap(),
            "Price: \\$5 \\*each\\*"
        );
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
}
