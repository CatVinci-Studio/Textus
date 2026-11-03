//! A paper's local sources - the files attached to it (`attached/...`, in
//! the paper's folder) and the project's files, such as its reference
//! library - and how they are cited and addressed among its sources.

use crate::ai::scratch::ATTACHED;
use crate::ai::tools::ToolContext;
use std::path::Path;

/// What a path can't hold inside a Markdown link: spaces, brackets,
/// parentheses, `%` and control characters (and, as always, non-ASCII).
const LINK_UNSAFE: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'(')
    .add(b')')
    .add(b'[')
    .add(b']')
    .add(b'<')
    .add(b'>')
    .add(b'%');

/// What a web address can't hold inside a Markdown link, `%` aside so an
/// escape already in it stays as it is: a DOI like 10.1061/40927(243)238
/// cut the citation short at its `)`.
const WEB_LINK_UNSAFE: &percent_encoding::AsciiSet = &percent_encoding::CONTROLS
    .add(b' ')
    .add(b'(')
    .add(b')')
    .add(b'<')
    .add(b'>');

/// A source's address as the paper's links carry it.
pub(crate) fn link_safe(url: &str) -> String {
    if is_local(url) {
        return url.to_string();
    }
    percent_encoding::utf8_percent_encode(url, WEB_LINK_UNSAFE).to_string()
}

/// Whether a source's address is a file's rather than a web page's.
fn is_local(address: &str) -> bool {
    !address.contains("://")
}

/// `path` with each part percent-encoded, so an address has no spaces.
fn encoded(path: &str) -> String {
    let parts: Vec<String> = path
        .split('/')
        .map(|p| percent_encoding::utf8_percent_encode(p, LINK_UNSAFE).to_string())
        .collect();
    parts.join("/")
}

fn decoded(address: &str) -> String {
    percent_encoding::percent_decode_str(address)
        .decode_utf8_lossy()
        .into_owned()
}

/// A project file's address among the paper's sources: its path from the
/// project folder (`references/...` for the reference library).
pub(crate) fn reference_address(path: &str) -> String {
    encoded(path)
}

/// The path of the project file at a source's address, or None for a web
/// page or an attached file.
pub(crate) fn reference_path(address: &str) -> Option<String> {
    (is_local(address) && material_name(address).is_none()).then(|| decoded(address))
}

/// An attached file's address among the paper's sources, by its path in
/// `attached/`.
pub(crate) fn material_address(name: &str) -> String {
    format!("{ATTACHED}/{}", encoded(name))
}

/// The attached file's path in `attached/` at a source's address, or None
/// for another source.
pub(crate) fn material_name(address: &str) -> Option<String> {
    address
        .strip_prefix(ATTACHED)
        .and_then(|rest| rest.strip_prefix('/'))
        .map(decoded)
}

/// The local file a note cites, as its address and title: `attached/...`
/// from the paper's folder, or a file of the project folder - a bare name
/// of an attached file too. None when `cited` names no readable file there
/// (a source's number or a web address).
pub(super) fn cited_file(ctx: &ToolContext, cited: &str) -> Option<(String, String)> {
    let cited = cited
        .trim()
        .trim_start_matches('@')
        .trim_start_matches("./");
    if cited.is_empty() || !is_local(cited) || cited.trim_matches(['[', ']']).parse::<u32>().is_ok()
    {
        return None;
    }
    let path = decoded(cited);
    let found = |folder: Option<&Path>, path: &str| {
        crate::ai::project::resolve(folder?, path)
            .ok()
            .map(|(_, rel)| rel)
    };
    let title = |path: &str| path.rsplit('/').next().unwrap_or(path).to_string();
    let attached = |name: &str| (material_address(name), title(name));
    if let Some(name) = material_name(&path) {
        return found(ctx.scratch, &path).map(|_| attached(&name));
    }
    if let Some(rel) = found(ctx.root, &path) {
        return Some((reference_address(&rel), title(&rel)));
    }
    found(ctx.scratch, &format!("{ATTACHED}/{path}")).map(|_| attached(&path))
}
