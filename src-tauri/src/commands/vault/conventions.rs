//! What a folder says about how it is written, read and never written: an
//! Obsidian vault's `.obsidian/app.json`, and a document's Typora front matter
//! (`typora-copy-images-to`). Anything missing or unreadable falls back to
//! Obsidian's own defaults, or to Textus's settings.

use super::{cached_index, MAX_VAULT_ASCENT};
use crate::commands::fs::ImageFolder;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

/// An Obsidian vault and the settings of it Textus follows.
#[derive(Serialize, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ObsidianVault {
    pub(crate) root: String,
    /// "Use [[Wikilinks]]" off.
    pub(crate) use_markdown_links: bool,
    /// "shortest", "relative" or "absolute".
    pub(crate) new_link_format: String,
    /// "/" the vault root, "./" the note's folder, "./sub" below it, else a
    /// folder from the root.
    pub(crate) attachment_folder: String,
    pub(crate) strict_line_breaks: bool,
    /// "Automatically update internal links"; None when the vault doesn't say.
    pub(crate) always_update_links: Option<bool>,
}

/// The nearest folder at or above `dir` holding `.obsidian/`.
pub(crate) fn find_vault(dir: &Path) -> Option<PathBuf> {
    let mut current = Some(dir);
    for _ in 0..MAX_VAULT_ASCENT {
        let here = current?;
        if here.join(".obsidian").is_dir() {
            return Some(here.to_path_buf());
        }
        current = here.parent();
    }
    None
}

/// The vault `root`'s settings, Obsidian's defaults where it has none.
pub(crate) fn read_vault(root: &Path) -> ObsidianVault {
    let app: serde_json::Value = std::fs::read_to_string(root.join(".obsidian/app.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default();
    let text = |key: &str, default: &str| {
        app.get(key)
            .and_then(|v| v.as_str())
            .unwrap_or(default)
            .to_string()
    };
    let flag = |key: &str| app.get(key).and_then(|v| v.as_bool());
    ObsidianVault {
        root: root.to_string_lossy().into_owned(),
        use_markdown_links: flag("useMarkdownLinks").unwrap_or(false),
        new_link_format: text("newLinkFormat", "shortest"),
        attachment_folder: text("attachmentFolderPath", "/"),
        strict_line_breaks: flag("strictLineBreaks").unwrap_or(false),
        always_update_links: flag("alwaysUpdateLinks"),
    }
}

/// The Obsidian vault a document or folder is in, with its settings; None
/// outside one.
#[tauri::command]
#[cfg_attr(test, specta::specta)]
pub async fn obsidian_vault(path: String) -> Result<Option<ObsidianVault>, String> {
    crate::commands::fs::require_non_empty(&path)?;
    tauri::async_runtime::spawn_blocking(move || {
        let path = Path::new(&path);
        let dir = if path.is_dir() { path } else { path.parent()? };
        find_vault(dir).map(|root| read_vault(&root))
    })
    .await
    .map_err(|e| e.to_string())
}

/// Whether a document in `dir` shows a single newline as a line break: in a
/// vault with "Strict line breaks" off, Obsidian's default.
#[cfg_attr(not(desktop), allow(dead_code))]
pub(crate) fn soft_breaks_show(dir: &Path) -> bool {
    find_vault(dir).is_some_and(|root| !read_vault(&root).strict_line_breaks)
}

/// `rel` under `base`, `.` and `..` folded; None for an absolute path.
fn fold(base: &Path, rel: &str) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    for part in Path::new(rel).components() {
        match part {
            Component::Normal(p) => out.push(p),
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(out)
}

/// `to` from the folder `from`, with forward slashes.
fn relative(from: &Path, to: &Path) -> String {
    let a: Vec<_> = from.components().collect();
    let b: Vec<_> = to.components().collect();
    let common = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let mut parts: Vec<String> = vec!["..".into(); a.len() - common];
    parts.extend(
        b[common..]
            .iter()
            .map(|c| c.as_os_str().to_string_lossy().into_owned()),
    );
    parts.join("/")
}

/// Where a pasted picture of `doc` goes when the folder says so; None to use
/// Settings > Images. Typora's front matter first, then the vault's folder.
pub(crate) fn convention_folder(doc: &Path) -> Option<(ImageFolder, Option<ObsidianVault>)> {
    let doc_dir = doc.parent()?;
    let stem = doc.file_stem()?.to_string_lossy();
    let at = |dir: PathBuf| ImageFolder {
        src_prefix: relative(doc_dir, &dir),
        dir,
    };
    if let Some(dir) = crate::commands::link_root::front_matter_value(doc, "typora-copy-images-to")
        .and_then(|to| fold(doc_dir, &to.replace("${filename}", &stem)))
    {
        return Some((at(dir), None));
    }
    let root = find_vault(doc_dir)?;
    let vault = read_vault(&root);
    let setting = vault.attachment_folder.trim();
    let dir = match setting {
        "" | "/" => Some(root.clone()),
        "./" | "." => Some(doc_dir.to_path_buf()),
        _ if setting.starts_with("./") => fold(doc_dir, setting),
        _ => fold(&root, setting),
    }
    // Never out of the vault: such a setting isn't Obsidian's.
    .filter(|dir| dir.starts_with(&root))?;
    Some((at(dir), Some(vault)))
}

/// `![[…]]` for a picture saved at `file`, as the vault writes new links;
/// None when it writes Markdown links.
pub(crate) fn vault_embed(vault: &ObsidianVault, doc: &Path, file: &Path) -> Option<String> {
    if vault.use_markdown_links {
        return None;
    }
    let root = Path::new(&vault.root);
    let from_root = file
        .strip_prefix(root)
        .ok()?
        .to_string_lossy()
        .replace('\\', "/");
    let link = match vault.new_link_format.as_str() {
        "relative" => relative(doc.parent()?, file),
        "absolute" => from_root,
        _ => {
            // The name alone when no other file in the vault ends with it.
            let name = file.file_name()?.to_string_lossy().to_lowercase();
            let tail = format!("/{name}");
            let same = cached_index(root, true)
                .iter()
                .filter(|rel| {
                    let rel = rel.to_lowercase();
                    rel == name || rel.ends_with(&tail)
                })
                .count();
            if same <= 1 {
                file.file_name()?.to_string_lossy().into_owned()
            } else {
                from_root
            }
        }
    };
    Some(format!("![[{link}]]"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn vault_with(app: &str) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join(".obsidian")).unwrap();
        fs::write(dir.path().join(".obsidian/app.json"), app).unwrap();
        fs::create_dir_all(dir.path().join("notes")).unwrap();
        dir
    }

    #[test]
    fn reads_the_vault_settings_and_obsidian_defaults() {
        let dir = vault_with(
            r#"{"useMarkdownLinks":true,"newLinkFormat":"relative","strictLineBreaks":true,"alwaysUpdateLinks":false}"#,
        );
        let vault = read_vault(dir.path());
        assert!(vault.use_markdown_links && vault.strict_line_breaks);
        assert_eq!(vault.new_link_format, "relative");
        assert_eq!(vault.attachment_folder, "/");
        assert_eq!(vault.always_update_links, Some(false));
        let plain = vault_with("not json");
        let vault = read_vault(plain.path());
        assert!(!vault.use_markdown_links && !vault.strict_line_breaks);
        assert_eq!(vault.always_update_links, None);
        assert_eq!(
            find_vault(&dir.path().join("notes")).as_deref(),
            Some(dir.path())
        );
        assert!(!soft_breaks_show(&dir.path().join("notes")));
        assert!(soft_breaks_show(&plain.path().join("notes")));
        assert!(!soft_breaks_show(tempfile::tempdir().unwrap().path()));
    }

    #[test]
    fn puts_pictures_where_the_vault_keeps_attachments() {
        let cases = [
            ("{}", "", "../"),
            (r#"{"attachmentFolderPath":"./"}"#, "notes", ""),
            (r#"{"attachmentFolderPath":"./att"}"#, "notes/att", "att/"),
            (
                r#"{"attachmentFolderPath":"Files/img"}"#,
                "Files/img",
                "../Files/img/",
            ),
        ];
        for (app, dir, prefix) in cases {
            let vault = vault_with(app);
            let doc = vault.path().join("notes/a.md");
            fs::write(&doc, "x").unwrap();
            let (folder, found) = convention_folder(&doc).unwrap();
            assert!(found.is_some());
            assert_eq!(
                folder.dir,
                vault.path().join(dir).components().collect::<PathBuf>()
            );
            assert_eq!(folder.src("p.png"), format!("{prefix}p.png"), "{app}");
        }
        let escapes = vault_with(r#"{"attachmentFolderPath":"../out"}"#);
        let doc = escapes.path().join("notes/a.md");
        fs::write(&doc, "x").unwrap();
        assert!(convention_folder(&doc).is_none());
    }

    #[test]
    fn follows_typora_copy_images_to_before_the_vault() {
        let vault = vault_with("{}");
        let doc = vault.path().join("notes/My Doc.md");
        fs::write(
            &doc,
            "---\r\ntitle: x\r\ntypora-copy-images-to: '../img/${filename}.assets'\r\n---\r\nbody",
        )
        .unwrap();
        let (folder, found) = convention_folder(&doc).unwrap();
        assert!(found.is_none());
        assert_eq!(folder.dir, vault.path().join("img/My Doc.assets"));
        assert_eq!(folder.src("p.png"), "../img/My Doc.assets/p.png");
        let outside = tempfile::tempdir().unwrap();
        let plain = outside.path().join("a.md");
        fs::write(&plain, "no front matter\ntypora-copy-images-to: x").unwrap();
        assert!(convention_folder(&plain).is_none());
    }

    #[test]
    fn writes_an_embed_in_the_vaults_link_format() {
        let vault = vault_with(r#"{"newLinkFormat":"shortest"}"#);
        let mut v = read_vault(vault.path());
        let doc = vault.path().join("notes/a.md");
        let file = vault.path().join("img/p.png");
        fs::create_dir_all(file.parent().unwrap()).unwrap();
        fs::write(&file, "x").unwrap();
        assert_eq!(vault_embed(&v, &doc, &file).as_deref(), Some("![[p.png]]"));
        v.new_link_format = "relative".into();
        assert_eq!(
            vault_embed(&v, &doc, &file).as_deref(),
            Some("![[../img/p.png]]")
        );
        v.new_link_format = "absolute".into();
        assert_eq!(
            vault_embed(&v, &doc, &file).as_deref(),
            Some("![[img/p.png]]")
        );
        v.use_markdown_links = true;
        assert_eq!(vault_embed(&v, &doc, &file), None);
    }
}
