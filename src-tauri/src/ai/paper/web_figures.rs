//! A paper's web pictures: each `<!-- textus-figure web: caption | search
//! words -->` mark the writers left becomes the best match on Wikimedia
//! Commons, kept in the picture store like a generated picture - shown in
//! place, saved with the paper - with the credit its licence asks for on
//! the line after it. A mark nothing is found for becomes a picture for the
//! image model to make instead: a real picture first, a generated one only
//! where none is found.

use super::draft::WEB_FIGURE_MARK;
use crate::ai::images::{begin, finish as finish_picture, placeholder_src, Slot};
use crate::ai::web::commons;
use aicompat::images::GeneratedImage;
use std::future::Future;

/// Search results tried for one mark before it is left out.
const TRIES: usize = 3;

/// A mark's caption and the words to search for (the caption itself when
/// the mark gives none). None for any other line.
pub(crate) fn read_mark(line: &str) -> Option<(String, String)> {
    let body = line
        .trim()
        .strip_prefix(WEB_FIGURE_MARK)?
        .trim_end()
        .strip_suffix("-->")?
        .trim();
    let (caption, words) = match body.split_once('|') {
        Some((caption, words)) if !words.trim().is_empty() => (caption.trim(), words.trim()),
        _ => (body, body),
    };
    (!caption.is_empty()).then(|| (caption.to_string(), words.to_string()))
}

/// `section` with its web-picture marks replaced by pictures `find` finds -
/// the picture and its credit - each kept in the picture store. A mark
/// `find` finds nothing for becomes a `textus-picture:` line, begun with
/// the planned generated pictures, or left out with them when there is no
/// image model.
pub(crate) async fn resolve<F, Fut>(section: &str, find: F) -> String
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<(GeneratedImage, String), String>>,
{
    if !section.contains(WEB_FIGURE_MARK) {
        return section.to_string();
    }
    let mut out: Vec<String> = Vec::new();
    for line in section.split('\n') {
        let Some((caption, words)) = read_mark(line) else {
            out.push(line.to_string());
            continue;
        };
        if let Ok((image, credit)) = find(words.clone()).await {
            let id = begin();
            finish_picture(&id, Slot::Ready(image));
            out.push(format!(
                "![{}]({})",
                caption.replace(['[', ']'], ""),
                placeholder_src(&id)
            ));
            out.push(String::new());
            out.push(format!("*{credit}*"));
        } else {
            out.push(generated_instead(&caption, &words));
        }
    }
    let mut text = out.join("\n");
    while text.contains("\n\n\n") {
        text = text.replace("\n\n\n", "\n\n");
    }
    text
}

/// The picture line a mark Commons has nothing for becomes: its caption as
/// the alt text, and as the prompt the caption with the search words, which
/// say in English what it shows.
fn generated_instead(caption: &str, words: &str) -> String {
    let alt = caption.replace(['[', ']'], "");
    if words == caption {
        format!("![{alt}](textus-picture:16:9 {alt})")
    } else {
        format!("![{alt}](textus-picture:16:9 {alt} ({words}))")
    }
}

/// The best picture on Commons for `words` that can be fetched, and its
/// credit.
pub(crate) async fn find_on_commons(words: String) -> Result<(GeneratedImage, String), String> {
    let found = commons::search(&words).await?;
    let mut last = format!("Nothing on Wikimedia Commons for {words:?}.");
    for image in found.iter().take(TRIES) {
        match commons::fetch(image).await {
            Ok(picture) => return Ok((picture, image.credit())),
            Err(why) => last = why,
        }
    }
    Err(last)
}
