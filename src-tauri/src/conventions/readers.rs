//! One reader per app, each finding its own marker in a folder and saying
//! what it sets there. Read only: nothing here writes, and no app's code
//! (a Docusaurus config, a Foam `.js` template) is ever run.

use super::text::{flat_key, json, json_bool, json_str, moment_format, read, DateSyntax};
use super::{Conventions, Daily, Setting};
use std::path::Path;

/// The readers in the order one folder's apps are asked: Textus's own
/// settings first, then the note apps, the site generators, VS Code, git.
pub(super) const READERS: &[fn(&Path) -> Option<Conventions>] = &[
    textus,
    obsidian,
    logseq,
    dendron,
    foam_or_vscode,
    mkdocs,
    hugo,
    docusaurus,
    jekyll,
    quarto,
    git,
];

/// Settings found in `root` for `app`.
struct At<'a> {
    app: &'static str,
    root: &'a Path,
}

impl At<'_> {
    fn set<T>(&self, value: T) -> Option<Setting<T>> {
        Some(Setting {
            value,
            app: self.app.to_string(),
            root: self.root.to_string_lossy().into_owned(),
        })
    }

    /// A folder named from the root as a full path.
    fn folder(&self, rel: &str) -> String {
        let rel = rel.trim().trim_matches('/');
        let path = if rel.is_empty() || rel == "." {
            self.root.to_path_buf()
        } else {
            self.root.join(rel)
        };
        path.to_string_lossy().into_owned()
    }

    fn conventions(&self) -> Conventions {
        Conventions {
            sources: vec![super::Source {
                app: self.app.to_string(),
                root: self.root.to_string_lossy().into_owned(),
            }],
            ..Default::default()
        }
    }
}

/// `.textus/settings.json`'s "conventions": the same fields, the user's own.
fn textus(dir: &Path) -> Option<Conventions> {
    let settings = json(&dir.join(".textus/settings.json"))?;
    let c = settings.get("conventions")?;
    let at = At {
        app: "textus",
        root: dir,
    };
    let s = |key: &str| json_str(c, key);
    let mut out = at.conventions();
    out.link_style = s("linkStyle").and_then(|v| at.set(v));
    out.link_path = s("linkPath").and_then(|v| at.set(v));
    out.link_root = s("linkRoot").and_then(|v| at.set(at.folder(&v)));
    out.update_links = s("updateLinks").and_then(|v| at.set(v));
    out.attachments = s("attachments").and_then(|v| at.set(v));
    out.soft_breaks = json_bool(c, "softBreaks").and_then(|v| at.set(v));
    out.templates = s("templates").and_then(|v| at.set(at.folder(&v)));
    out.new_notes = s("newNotes").and_then(|v| at.set(v));
    out.daily = c.get("daily").and_then(|d| {
        at.set(Daily {
            folder: at.folder(&json_str(d, "folder").unwrap_or_default()),
            format: json_str(d, "format").unwrap_or_else(|| "YYYY-MM-DD".into()),
            template: json_str(d, "template").map(|t| at.folder(&t)),
        })
    });
    out.ignore = strings(c.get("ignore"));
    // "followed" or "declined": the other app's settings were answered.
    out.decided = s("detected").is_some();
    Some(out)
}

fn strings(value: Option<&serde_json::Value>) -> Vec<String> {
    value
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// An Obsidian vault: `.obsidian/app.json`, its Templates and Daily notes,
/// and the Templater and Periodic Notes plugins where those are empty.
fn obsidian(dir: &Path) -> Option<Conventions> {
    let config = dir.join(".obsidian");
    if !config.is_dir() {
        return None;
    }
    let at = At {
        app: "obsidian",
        root: dir,
    };
    let app = json(&config.join("app.json")).unwrap_or_default();
    let text = |key: &str| json_str(&app, key);
    let mut out = at.conventions();
    let markdown = json_bool(&app, "useMarkdownLinks").unwrap_or(false);
    out.link_style = at.set(if markdown { "markdown" } else { "wiki" }.into());
    out.link_path = at.set(text("newLinkFormat").unwrap_or_else(|| "shortest".into()));
    out.attachments = at.set(text("attachmentFolderPath").unwrap_or_else(|| "/".into()));
    out.soft_breaks = at.set(!json_bool(&app, "strictLineBreaks").unwrap_or(false));
    // Off means Obsidian asks; left unset, Textus updates them.
    let always = json_bool(&app, "alwaysUpdateLinks").unwrap_or(true);
    out.update_links = at.set(if always { "always" } else { "ask" }.into());
    out.new_notes = match text("newFileLocation").as_deref() {
        Some("current") => at.set("./".into()),
        Some("folder") => at.set(text("newFileFolderPath").unwrap_or_default()),
        _ => at.set("/".into()),
    };
    out.ignore = strings(app.get("userIgnoreFilters"));
    let plugin = |name: &str| json(&config.join(format!("plugins/{name}/data.json")));
    out.templates = json(&config.join("templates.json"))
        .and_then(|t| json_str(&t, "folder"))
        .or_else(|| plugin("templater-obsidian").and_then(|t| json_str(&t, "templates_folder")))
        .filter(|f| !f.trim().is_empty())
        .and_then(|f| at.set(at.folder(&f)));
    let daily = json(&config.join("daily-notes.json")).or_else(|| {
        plugin("periodic-notes")
            .and_then(|p| p.get("daily").cloned())
            .filter(|d| json_bool(d, "enabled") != Some(false))
    });
    out.daily = daily.and_then(|d| {
        at.set(Daily {
            folder: at.folder(&json_str(&d, "folder").unwrap_or_default()),
            format: json_str(&d, "format")
                .filter(|f| !f.is_empty())
                .unwrap_or_else(|| "YYYY-MM-DD".into()),
            template: json_str(&d, "template")
                .filter(|t| !t.is_empty())
                .map(|t| at.folder(&with_md(&t))),
        })
    });
    Some(out)
}

/// A template named without its extension, as Obsidian stores it.
fn with_md(name: &str) -> String {
    if name.to_lowercase().ends_with(".md") {
        name.to_string()
    } else {
        format!("{name}.md")
    }
}

/// A Logseq graph kept as files: `logseq/config.edn`.
fn logseq(dir: &Path) -> Option<Conventions> {
    let config = read(&dir.join("logseq/config.edn"))?;
    let at = At {
        app: "logseq",
        root: dir,
    };
    let key = |k: &str| flat_key(&config, k);
    let mut out = at.conventions();
    out.link_style = at.set("wiki".into());
    out.link_path = at.set("shortest".into());
    out.attachments = at.set("assets".into());
    out.soft_breaks = at.set(true);
    out.new_notes = at.set(key(":pages-directory").unwrap_or_else(|| "pages".into()));
    let format = key(":journal/file-name-format").unwrap_or_else(|| "yyyy_MM_dd".into());
    out.daily = at.set(Daily {
        folder: at.folder(&key(":journals-directory").unwrap_or_else(|| "journals".into())),
        format: moment_format(&format, DateSyntax::Unicode),
        template: None,
    });
    Some(out)
}

/// A Dendron workspace: `dendron.yml`, notes named by dotted hierarchy.
fn dendron(dir: &Path) -> Option<Conventions> {
    let config = read(&dir.join("dendron.yml"))?;
    let at = At {
        app: "dendron",
        root: dir,
    };
    let key = |k: &str| flat_key(&config, k);
    let mut out = at.conventions();
    out.link_style = at.set("wiki".into());
    out.link_path = at.set("shortest".into());
    out.attachments = at.set("assets/images".into());
    let domain = key("dailyDomain").unwrap_or_else(|| "daily".into());
    let name = key("name").unwrap_or_else(|| "journal".into());
    let format = moment_format(
        &key("dateFormat").unwrap_or_else(|| "y.MM.dd".into()),
        DateSyntax::Unicode,
    );
    out.daily = at.set(Daily {
        folder: at.folder(""),
        format: format!("[{domain}.{name}.]{format}"),
        template: None,
    });
    Some(out)
}

/// VS Code's `.vscode/settings.json`: Foam's keys when it is a Foam
/// workspace (or `.foam/` is there), and the Markdown extension's.
fn foam_or_vscode(dir: &Path) -> Option<Conventions> {
    let settings = json(&dir.join(".vscode/settings.json"));
    let foam_dir = dir.join(".foam").is_dir();
    let s = settings.unwrap_or_default();
    let has_foam = foam_dir
        || s.as_object()
            .is_some_and(|o| o.keys().any(|k| k.starts_with("foam.")));
    if !has_foam && s.as_object().is_none_or(|o| o.is_empty()) {
        return None;
    }
    let at = At {
        app: if has_foam { "foam" } else { "vscode" },
        root: dir,
    };
    let text = |key: &str| json_str(&s, key);
    let mut out = at.conventions();
    out.soft_breaks = json_bool(&s, "markdown.preview.breaks").and_then(|v| at.set(v));
    out.update_links = text("markdown.updateLinksOnFileMove.enabled").and_then(|v| {
        at.set(
            match v.as_str() {
                "always" => "always",
                "never" => "never",
                _ => "ask",
            }
            .into(),
        )
    });
    out.attachments = s
        .get("markdown.copyFiles.destination")
        .and_then(|d| d.as_object())
        .and_then(|d| {
            d.get("**/*")
                .or_else(|| d.get("*"))
                .or_else(|| d.values().next())
        })
        .and_then(|v| v.as_str())
        .and_then(|v| at.set(vscode_destination(v)));
    if has_foam {
        let wiki = text("foam.completion.linkFormat").as_deref() != Some("link");
        out.link_style = at.set(if wiki { "wiki" } else { "markdown" }.into());
        out.link_path = at.set("shortest".into());
        out.new_notes = at.set(
            if text("foam.files.newNotePath").as_deref() == Some("currentDir") {
                "./"
            } else {
                "/"
            }
            .into(),
        );
        let templates = text("foam.templates.folder").unwrap_or_else(|| ".foam/templates".into());
        let daily_template = dir.join(&templates).join("daily-note.md");
        out.templates = at.set(at.folder(&templates));
        // The deprecated keys, when an older workspace still has them.
        let format = text("foam.openDailyNote.filenameFormat")
            .map(|f| moment_format(&f, DateSyntax::DateFormat))
            .unwrap_or_else(|| "YYYY-MM-DD".into());
        out.daily = at.set(Daily {
            folder: at
                .folder(&text("foam.openDailyNote.directory").unwrap_or_else(|| "journal".into())),
            format,
            template: daily_template
                .is_file()
                .then(|| daily_template.to_string_lossy().into_owned()),
        });
    }
    Some(out)
}

/// `markdown.copyFiles.destination` as an attachments rule: from the
/// workspace root, beside the document, or below it.
fn vscode_destination(value: &str) -> String {
    let value = value.replace("${documentBaseName}", "${filename}");
    // A destination naming the file itself: its folder.
    let folder = match value.rfind('/') {
        Some(i) if value[i..].contains("${fileName}") => value[..=i].to_string(),
        _ => value,
    };
    if let Some(rest) = folder.strip_prefix("${documentWorkspaceFolder}/") {
        rest.to_string()
    } else if let Some(rest) = folder.strip_prefix("${documentDirName}/") {
        format!("./{rest}")
    } else if folder.starts_with('/') {
        folder.trim_start_matches('/').to_string()
    } else {
        format!("./{}", folder.trim_start_matches("./"))
    }
}

/// A site generator: only where `/` in a link points.
fn site(dir: &Path, app: &'static str, root: Option<String>) -> Option<Conventions> {
    let at = At { app, root: dir };
    let mut out = at.conventions();
    out.link_root = at.set(at.folder(&root.unwrap_or_default()));
    Some(out)
}

fn mkdocs(dir: &Path) -> Option<Conventions> {
    let config = read(&dir.join("mkdocs.yml")).or_else(|| read(&dir.join("mkdocs.yaml")))?;
    site(
        dir,
        "mkdocs",
        Some(flat_key(&config, "docs_dir").unwrap_or_else(|| "docs".into())),
    )
}

fn hugo(dir: &Path) -> Option<Conventions> {
    let config = [
        "hugo.toml",
        "hugo.yaml",
        "hugo.yml",
        "hugo.json",
        "config.toml",
    ]
    .iter()
    .find_map(|name| read(&dir.join(name)))?;
    let key = flat_key(&config, "staticDir").or_else(|| flat_key(&config, "\"staticDir\""));
    site(dir, "hugo", Some(key.unwrap_or_else(|| "static".into())))
}

fn docusaurus(dir: &Path) -> Option<Conventions> {
    [
        "docusaurus.config.js",
        "docusaurus.config.ts",
        "docusaurus.config.mjs",
    ]
    .iter()
    .any(|name| dir.join(name).is_file())
    .then(|| site(dir, "docusaurus", Some("static".into())))?
}

fn jekyll(dir: &Path) -> Option<Conventions> {
    let config = read(&dir.join("_config.yml"))?;
    site(dir, "jekyll", flat_key(&config, "source"))
}

fn quarto(dir: &Path) -> Option<Conventions> {
    dir.join("_quarto.yml")
        .is_file()
        .then(|| site(dir, "quarto", None))?
}

/// A git repository: `/` is its root, as GitHub reads links.
fn git(dir: &Path) -> Option<Conventions> {
    dir.join(".git").exists().then(|| site(dir, "git", None))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_vscode_copy_destinations() {
        assert_eq!(
            vscode_destination("${documentWorkspaceFolder}/images/"),
            "images/"
        );
        assert_eq!(
            vscode_destination("${documentDirName}/${documentBaseName}/${fileName}"),
            "./${filename}/"
        );
        assert_eq!(vscode_destination("media/"), "./media/");
    }
}
