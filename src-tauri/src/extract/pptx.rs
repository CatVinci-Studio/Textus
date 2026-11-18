//! PowerPoint (.pptx) to Markdown: one `## Slide N: title` per slide, then its
//! shapes in reading order (top to bottom, then left to right, not z-order) and
//! notes under `### Notes`, as MarkItDown (MIT) does.

use super::xml::{resolve_part, zip_entry, Rels};
use std::path::Path;

pub(super) fn pptx_markdown(path: &Path) -> Result<String, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file)
        .map_err(|_| "This .pptx is not a readable PowerPoint file.".to_string())?;

    // Slides sort wrong as strings (slide10 before slide2), so order by number.
    let mut slides: Vec<(u32, String)> = zip
        .file_names()
        .filter_map(|name| {
            let name = name.ok()?;
            let rest = name.strip_prefix("ppt/slides/slide")?;
            let number = rest.strip_suffix(".xml")?.parse::<u32>().ok()?;
            Some((number, name.to_string()))
        })
        .collect();
    slides.sort();

    let mut out = Vec::new();
    for (number, name) in slides {
        let Some(xml) = zip_entry(&mut zip, &name) else {
            continue;
        };
        let rels_name = format!("ppt/slides/_rels/slide{number}.xml.rels");
        let rels = Rels::parse(&zip_entry(&mut zip, &rels_name).unwrap_or_default());
        let (title, body) = read_slide(&xml, &rels, true);

        let notes = rels
            .of_kind("notesSlide")
            .map(|target| resolve_part("ppt/slides", target))
            .and_then(|notes| zip_entry(&mut zip, &notes))
            .map(|xml| read_slide(&xml, &Rels::default(), false).1)
            .unwrap_or_default();

        if title.is_none() && body.is_empty() && notes.is_empty() {
            continue;
        }
        let mut slide = match title {
            Some(title) => format!("## Slide {number}: {title}"),
            None => format!("## Slide {number}"),
        };
        if !body.is_empty() {
            slide.push_str("\n\n");
            slide.push_str(&body);
        }
        if !notes.is_empty() {
            slide.push_str("\n\n### Notes\n\n");
            slide.push_str(&notes);
        }
        out.push(slide);
    }

    if out.is_empty() {
        return Err(crate::errors::error("noText"));
    }
    Ok(out.join("\n\n"))
}

mod slide;
use slide::read_slide;

#[cfg(test)]
mod tests;
