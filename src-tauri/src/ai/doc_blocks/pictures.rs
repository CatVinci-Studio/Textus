//! A rewrite's pictures: a text edit never changes a picture - the
//! picture tool does - so `keep_pictures` puts back the ones a rewrite of
//! a run left out or swapped (doc_blocks.rs resolves the call around it).

use super::paragraphs;

/// Whether `block` is a picture and nothing else: `![alt](path)`, or an
/// `<img>` (a picture given a width) - for text the model wrote, which has
/// no node to ask. isPicture in src/ai/doc-blocks.ts; both are held to
/// keep-pictures-cases.json.
pub(super) fn is_picture(block: &str) -> bool {
    let b = block.trim();
    if b.contains('\n') {
        return false;
    }
    if let Some(rest) = b.strip_prefix("![") {
        // `![alt](path)`: no `]` in the alt, no `)` in the path.
        return match rest.find(']') {
            Some(close) => rest[close + 1..]
                .strip_prefix('(')
                .and_then(|r| r.strip_suffix(')'))
                .is_some_and(|path| !path.contains(')')),
            None => false,
        };
    }
    b.strip_prefix("<img")
        .and_then(|r| r.strip_suffix('>'))
        .is_some_and(|attrs| attrs.starts_with(char::is_whitespace) && !attrs.contains('>'))
}

/// `text`, a rewrite of the run `run` (its blocks' markdown), with the
/// run's pictures as they were: a text edit never changes a picture -
/// generate_image does. A picture the rewrite left out goes back, after as
/// many of the new text's paragraphs as there were text blocks before it
/// in the run - by the paragraph it stood by, as the card pairs them. A
/// new picture the rewrite wrote where one was is taken out first, the
/// original going back in its place: the swap is the picture tool's to
/// propose, on a card of its own. Before, a picture dropped from a rewrite
/// was deleted with nothing said, a swapped one went with the words, and
/// either way the card had nothing to pair paragraph by paragraph (rc.6).
/// New pictures with every original kept stay. `complete`: all of `text`
/// is there; while it streams in, a picture whose place it hasn't reached
/// is left out for now (keepPictures in src/ai/doc-blocks.ts, held to the
/// same cases by keep-pictures-cases.json). Returns the text and how many
/// swapped pictures were taken out.
pub(crate) fn keep_pictures(run: &[&str], text: &str, complete: bool) -> (String, usize) {
    let originals: Vec<&str> = run
        .iter()
        .map(|b| b.trim())
        .filter(|t| is_picture(t))
        .collect();
    let missing = originals.iter().filter(|p| !text.contains(**p)).count();
    let mut swapped = 0;
    let mut out = if missing == 0 {
        text.to_string()
    } else {
        let kept: Vec<&str> = paragraphs(text)
            .into_iter()
            .map(|(s, e)| &text[s..e])
            .filter(|t| {
                let new = is_picture(t) && !originals.contains(&t.trim());
                if new && swapped < missing {
                    swapped += 1;
                    return false;
                }
                true
            })
            .collect();
        if swapped == 0 {
            text.to_string()
        } else {
            kept.join("\n\n")
        }
    };
    let mut words_before = 0;
    // Pictures in the new text so far: each moves the later places on by one.
    let mut put = 0;
    for block in run {
        let picture = block.trim();
        if !is_picture(picture) {
            words_before += 1;
            continue;
        }
        // Kept where the rewrite has it, it takes a place all the same.
        if out.contains(picture) {
            put += 1;
            continue;
        }
        let spans = paragraphs(&out);
        let at = words_before + put;
        out = if at == 0 {
            format!("{picture}\n\n{}", out.trim_start())
        } else if at < spans.len() {
            let end = spans[at - 1].1;
            format!(
                "{}\n\n{picture}\n\n{}",
                &out[..end],
                out[end..].trim_start()
            )
        } else if complete && !spans.is_empty() {
            format!("{}\n\n{picture}", out.trim_end())
        } else {
            continue;
        };
        put += 1;
    }
    (out, swapped)
}
