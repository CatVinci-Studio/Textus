//! A paper's web pictures: each `<!-- textus-figure web: caption | search
//! words -->` mark the writers left becomes the best match on Wikimedia
//! Commons, else on Openverse (openly licensed pictures from Flickr, museums
//! and others), searched again with fewer words when neither has the whole
//! description. It is kept in the picture store like a generated picture -
//! shown in place, saved with the paper - with the credit its licence asks
//! for on the line after it. A mark nothing is found for becomes a picture
//! for the image model to make instead: a real picture first, a generated
//! one only where none is found.

use super::draft::WEB_FIGURE_MARK;
use crate::ai::images::{begin, finish as finish_picture, placeholder_src, Slot};
use crate::ai::web::{commons, openverse};
use aicompat::images::GeneratedImage;
use std::future::Future;

/// Search results fetched from one source for one search before the next.
const TRIES: usize = 3;
/// The fewest words a search is cut down to.
const FEWEST_WORDS: usize = 2;

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

/// The picture line a mark no source has anything for becomes: its caption as
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

/// The searches tried for `words`, in order: all of them, then with the
/// last word left off - the most specific, often a place or a date - while
/// FEWEST_WORDS remain, at most twice.
pub(crate) fn searches(words: &str) -> Vec<String> {
    let words: Vec<&str> = words.split_whitespace().collect();
    (0..=2)
        .map_while(|cut| {
            let kept = words.len().checked_sub(cut)?;
            (cut == 0 || kept >= FEWEST_WORDS).then(|| words[..kept].join(" "))
        })
        .filter(|search| !search.is_empty())
        .collect()
}

/// The best real picture for `words` that can be fetched, and its credit:
/// for each of its searches, Wikimedia Commons first, then Openverse.
pub(crate) async fn find_on_the_web(words: String) -> Result<(GeneratedImage, String), String> {
    let mut last = format!("No openly licensed picture found for {words:?}.");
    for search in searches(&words) {
        // Openverse is always asked after, so its reason is the one told.
        if let Ok(found) = on_commons(&search).await {
            return Ok(found);
        }
        match on_openverse(&search).await {
            Ok(found) => return Ok(found),
            Err(why) => last = why,
        }
    }
    Err(last)
}

/// The best picture on Commons for `words` that can be fetched, and its
/// credit.
async fn on_commons(words: &str) -> Result<(GeneratedImage, String), String> {
    let found = commons::search(words).await?;
    let mut last = format!("Nothing on Wikimedia Commons for {words:?}.");
    for image in found.iter().take(TRIES) {
        match commons::fetch(image).await {
            Ok(picture) => return Ok((picture, image.credit())),
            Err(why) => last = why,
        }
    }
    Err(last)
}

/// The best picture on Openverse for `words` that can be fetched, and its
/// credit.
async fn on_openverse(words: &str) -> Result<(GeneratedImage, String), String> {
    let found = openverse::search(words).await?;
    let mut last = format!("Nothing on Openverse for {words:?}.");
    for image in found.iter().take(TRIES) {
        match openverse::fetch(image).await {
            Ok(picture) => return Ok((picture, image.credit())),
            Err(why) => last = why,
        }
    }
    Err(last)
}
