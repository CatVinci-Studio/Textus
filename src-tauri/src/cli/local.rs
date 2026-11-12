//! The commands that need no running app: they read and write files with the
//! same walk, search and extraction Textus AI's project tools use.

use super::{Ctx, Io};
use crate::ai::project::{
    file_kind, search_in_order, walk_readable_files, FileKind, MAX_SEARCH_MATCHES, MAX_TEXT_BYTES,
    WALK_TRUNCATED_NOTE,
};
use serde_json::json;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Longer than the agent's: a person at a terminal waits for a big folder.
const SEARCH_TIME: Duration = Duration::from_secs(30);

pub type Result = std::result::Result<i32, String>;

fn folder(ctx: &Ctx, arg: Option<&String>) -> std::result::Result<PathBuf, String> {
    let path = arg.map_or_else(|| ctx.cwd.clone(), |a| ctx.cwd.join(a));
    if path.is_dir() {
        Ok(path)
    } else {
        Err(format!("{} isn't a folder.", path.display()))
    }
}

fn at_most<'a>(
    args: &'a [String],
    n: usize,
    usage: &str,
) -> std::result::Result<&'a [String], String> {
    if args.len() > n {
        Err(format!("Too many arguments. Usage: {usage}"))
    } else {
        Ok(args)
    }
}

pub fn list(ctx: &Ctx, args: &[String], io: &mut Io) -> Result {
    let args = at_most(args, 1, "textus list [<folder>]")?;
    let root = folder(ctx, args.first())?;
    let walked = walk_readable_files(&root, false);
    if ctx.json {
        io.line(&json!(walked.files).to_string());
    } else {
        for file in &walked.files {
            io.line(file);
        }
    }
    if walked.truncated {
        io.warn("The folder is too large to go through completely; some files are missing.");
    }
    Ok(0)
}

pub fn read(ctx: &Ctx, args: &[String], io: &mut Io) -> Result {
    let [file] = args else {
        return Err("Usage: textus read <file>".into());
    };
    let path = ctx.cwd.join(file);
    let text = markdown_of(&path)?;
    if ctx.json {
        io.line(&json!({ "path": path, "markdown": text }).to_string());
    } else {
        io.text(&text);
    }
    Ok(0)
}

/// A file's text, or a document's text as Markdown.
fn markdown_of(path: &Path) -> std::result::Result<String, String> {
    let shown = path.display();
    if path.is_dir() {
        return Err(format!("{shown} is a folder, not a file."));
    }
    let size = std::fs::metadata(path)
        .map_err(|e| format!("{shown} can't be read: {e}"))?
        .len();
    let ext = crate::extract::extension_of(path);
    if let Some(text) = crate::extract::document_text(path, &ext) {
        return text.map_err(|e| format!("{shown} can't be read: {e}"));
    }
    if file_kind(path) == Some(FileKind::Image) {
        return Err(format!("{shown} is an image, which has no text to print."));
    }
    if size > MAX_TEXT_BYTES {
        return Err(format!("{shown} is too large to read as text."));
    }
    std::fs::read_to_string(path)
        .ok()
        .filter(|text| !text.contains('\0'))
        .ok_or_else(|| format!("{shown} isn't a text file or a document Textus reads."))
}

pub fn search(ctx: &Ctx, args: &[String], io: &mut Io) -> Result {
    let usage = "textus search <query> [<folder>]";
    let Some((query, rest)) = args.split_first() else {
        return Err(format!("Usage: {usage}"));
    };
    let root = folder(ctx, at_most(rest, 1, usage)?.first())?;
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Err("Give some words to search for.".into());
    }
    let walked = walk_readable_files(&root, false);
    let found = search_in_order(&root, &walked.files, &needle, Instant::now() + SEARCH_TIME);
    let mut hits: Vec<Hit> = found.hits.iter().filter_map(|h| Hit::parse(h)).collect();
    let more = hits.len() > MAX_SEARCH_MATCHES;
    hits.truncate(MAX_SEARCH_MATCHES);
    if ctx.json {
        io.line(&json!(hits.iter().map(Hit::json).collect::<Vec<_>>()).to_string());
    } else {
        for hit in &hits {
            io.line(&format!("{}:{}: {}", hit.path, hit.line, hit.text));
        }
    }
    if more {
        io.warn(&format!(
            "Stopped at {MAX_SEARCH_MATCHES} matches: a more specific query finds the rest."
        ));
    } else if found.read < walked.files.len() {
        io.warn(&format!(
            "Stopped after {} of {} files: the search took too long.",
            found.read,
            walked.files.len()
        ));
    } else if walked.truncated {
        io.warn(WALK_TRUNCATED_NOTE.trim_start_matches("... "));
    }
    Ok(if hits.is_empty() { 1 } else { 0 })
}

/// One match, from the search's `path:line: text`.
struct Hit<'a> {
    path: &'a str,
    line: usize,
    text: &'a str,
}

impl<'a> Hit<'a> {
    fn parse(hit: &'a str) -> Option<Self> {
        let (head, text) = hit.split_once(": ")?;
        let (path, line) = head.rsplit_once(':')?;
        Some(Hit {
            path,
            line: line.parse().ok()?,
            text,
        })
    }

    fn json(&self) -> serde_json::Value {
        json!({ "path": self.path, "line": self.line, "text": self.text })
    }
}

pub fn new(ctx: &Ctx, args: &[String], io: &mut Io) -> Result {
    let mut args = args.to_vec();
    let title = super::take_option(&mut args, "--title")?;
    let [file] = args.as_slice() else {
        return Err("Usage: textus new <file> [--title <title>]".into());
    };
    let mut path = ctx.cwd.join(file);
    if path.extension().is_none() {
        path.set_extension("md");
    }
    let content = title.map(|t| format!("# {t}\n")).unwrap_or_default();
    write_new(&path, &content)?;
    io.line(&path.display().to_string());
    Ok(0)
}

fn write_new(path: &Path, content: &str) -> std::result::Result<(), String> {
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::AlreadyExists => {
                format!("{} is already there; nothing was changed.", path.display())
            }
            _ => format!("{} can't be created: {e}", path.display()),
        })?;
    file.write_all(content.as_bytes())
        .map_err(|e| format!("{} can't be written: {e}", path.display()))
}

pub fn move_entry(ctx: &Ctx, args: &[String], io: &mut Io) -> Result {
    let [from, to] = args else {
        return Err("Usage: textus move <from> <to>".into());
    };
    let from = ctx.cwd.join(from);
    if std::fs::symlink_metadata(&from).is_err() {
        return Err(format!("{} isn't there.", from.display()));
    }
    let mut to = ctx.cwd.join(to);
    if to.is_dir() {
        to.push(from.file_name().ok_or("Nothing to move.")?);
    }
    if std::fs::symlink_metadata(&to).is_ok() {
        return Err(format!(
            "{} is already there; nothing was moved.",
            to.display()
        ));
    }
    crate::atomic::move_entry(&from, &to)
        .map_err(|e| format!("{} can't be moved to {}: {e}", from.display(), to.display()))?;
    io.line(&to.display().to_string());
    Ok(0)
}
