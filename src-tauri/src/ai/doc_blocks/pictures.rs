//! A rewrite's pictures: a text edit never changes a picture, so
//! `keep_pictures` puts back the ones a rewrite left out or swapped.

use super::paragraphs;

/// Whether `block` is a picture and nothing else: `![alt](path)` or an
/// `<img>`. Keep in step with the frontend's isPicture (shared cases file).
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

/// `text`, a rewrite of `run`, with the run's pictures as they were: a dropped
/// picture goes back by the paragraph it stood by, and a swapped one is taken
/// out and the original put back (the swap is generate_image's to propose).
/// `complete`: all of `text` is there; while streaming, a picture whose place
/// isn't reached yet is left out. Returns the text and how many were taken out.
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
