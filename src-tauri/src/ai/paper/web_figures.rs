//! A paper's web pictures: each `<!-- textus-figure web: caption | search
//! words -->` mark the writers left becomes the best match on Wikimedia
//! Commons, kept in the picture store like a generated picture - shown in
//! place, saved with the paper - with the credit its licence asks for on
//! the line after it. A mark nothing is found for becomes a picture for the
//! image model to make instead: a real picture first, a generated one only
//! where none is found.

use super::checks::WEB_FIGURE_MARK;
use crate::ai::images::{begin, finish as finish_picture, placeholder_src, Slot};
use crate::ai::web::commons;
use aicompat::images::GeneratedImage;
use futures_util::{stream, StreamExt};
use std::future::Future;

use super::tuning::COMMONS_TRIES as TRIES;

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

/// Marks searched for at once, across all a paper's sections: each search
/// and fetch is mostly waiting on Commons, and a few at a time stay polite.
pub(crate) const AT_ONCE: usize = 4;

/// `sections` with their web-picture marks replaced by pictures `find`
/// finds - the picture and its credit - each kept in the picture store. A
/// mark `find` finds nothing for becomes a `textus-picture:` line, begun
/// with the planned generated pictures, or left out with them when there is
/// no image model. The marks are searched for a few at a time, whichever
/// section they are in, and each lands where its mark was.
pub(crate) async fn resolve<F, Fut>(sections: &[String], find: F) -> Vec<String>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Result<(GeneratedImage, String), String>>,
{
    let words: Vec<String> = sections
        .iter()
        .flat_map(|s| s.split('\n'))
        .filter_map(read_mark)
        .map(|(_, words)| words)
        .collect();
    // Kept in the store as soon as found, so the bytes aren't held here
    // while the slower searches finish.
    let found: Vec<Option<(String, String)>> = stream::iter(words)
        .map(|words| {
            let search = find(words);
            async move {
                let (image, credit) = search.await.ok()?;
                let id = begin();
                finish_picture(&id, Slot::Ready(image));
                Some((id, credit))
            }
        })
        .buffered(AT_ONCE)
        .collect()
        .await;
    let mut found = found.into_iter();
    sections
        .iter()
        .map(|section| place(section, &mut found))
        .collect()
}

/// `section` with each of its marks replaced by the next of `found`: the
/// kept picture's id and its credit, or None for one to generate instead.
fn place(section: &str, found: &mut impl Iterator<Item = Option<(String, String)>>) -> String {
    if !section.contains(WEB_FIGURE_MARK) {
        return section.to_string();
    }
    let mut out: Vec<String> = Vec::new();
    for line in section.split('\n') {
        let Some((caption, words)) = read_mark(line) else {
            out.push(line.to_string());
            continue;
        };
        if let Some((id, credit)) = found.next().flatten() {
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

/// `words`, then with its last word dropped, then its last two, keeping
/// two at least: a search too narrow to find anything gets a wider one.
pub(crate) fn fewer_words(words: &str) -> Vec<String> {
    let all: Vec<&str> = words.split_whitespace().collect();
    let mut tries = vec![all.join(" ")];
    for n in [all.len().saturating_sub(1), all.len().saturating_sub(2)] {
        let shorter = all[..n].join(" ");
        if n >= 2 && !tries.contains(&shorter) {
            tries.push(shorter);
        }
    }
    tries
}

/// The best picture on Commons for `words` that can be fetched, and its
/// credit; with nothing found, the same search with fewer words.
pub(crate) async fn find_on_commons(words: String) -> Result<(GeneratedImage, String), String> {
    let mut last = format!("Nothing on Wikimedia Commons for {words:?}.");
    for query in fewer_words(&words) {
        let found = commons::search(&query).await?;
        for image in found.iter().take(TRIES) {
            match commons::fetch(image).await {
                Ok(picture) => return Ok((picture, image.credit())),
                Err(why) => last = why,
            }
        }
    }
    Err(last)
}
