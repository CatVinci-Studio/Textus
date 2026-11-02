//! A paper's long timelines, redrawn as what fits a page's column.

/// The most periods a timeline is drawn across the page with: one with
/// more, laid out side by side, was scaled down past reading.
const ACROSS_PERIODS: usize = 4;

struct Period {
    name: String,
    events: Vec<String>,
}

struct Section {
    name: Option<String>,
    periods: Vec<Period>,
}

/// `markdown` with every ```mermaid timeline of more than ACROSS_PERIODS
/// periods, or written `timeline TD`, as a top-down flowchart, one box a
/// period and one group a section. Mermaid's own top-down timeline wraps no
/// text and draws a section's bar over the period before it.
pub(crate) fn upright_timelines(markdown: &str) -> String {
    let lines: Vec<&str> = markdown.split('\n').collect();
    let mut out: Vec<String> = Vec::with_capacity(lines.len());
    let mut i = 0;
    while i < lines.len() {
        out.push(lines[i].to_string());
        let opens = lines[i].trim_start().starts_with("```")
            && lines[i].trim_start().trim_start_matches('`').trim() == "mermaid";
        i += 1;
        if !opens {
            continue;
        }
        let end = (i..lines.len())
            .find(|&j| lines[j].trim_start().starts_with("```"))
            .unwrap_or(lines.len());
        match upright(&lines[i..end]) {
            Some(chart) => out.push(chart),
            None => out.extend(lines[i..end].iter().map(|l| l.to_string())),
        }
        i = end;
    }
    out.join("\n")
}

/// A timeline's body as a top-down flowchart, or None when it is another
/// diagram, laid out across (`timeline LR`), or short enough to be.
fn upright(body: &[&str]) -> Option<String> {
    let mut lines = body
        .iter()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with("%%"));
    let down = match lines.next()? {
        "timeline" => false,
        "timeline TD" => true,
        _ => return None,
    };
    let mut title = None;
    let mut sections = vec![Section {
        name: None,
        periods: Vec::new(),
    }];
    for line in lines {
        if let Some(text) = line.strip_prefix("title ") {
            title = Some(text.trim());
            continue;
        }
        if line.starts_with("accTitle") || line.starts_with("accDescr") {
            continue;
        }
        if let Some(name) = line.strip_prefix("section ") {
            sections.push(Section {
                name: Some(name.trim().to_string()),
                periods: Vec::new(),
            });
            continue;
        }
        let periods = &mut sections.last_mut()?.periods;
        let mut parts = line.split(':').map(str::trim);
        let first = parts.next().unwrap_or_default();
        let events = parts.filter(|e| !e.is_empty()).map(String::from);
        match periods.last_mut() {
            // `: event`, and a line with no colon at all, which writers
            // mean as the next event though Mermaid reads it as a period.
            Some(period) if first.is_empty() => period.events.extend(events),
            Some(period) if !line.contains(':') => period.events.push(line.to_string()),
            _ => periods.push(Period {
                name: first.to_string(),
                events: events.collect(),
            }),
        }
    }
    let count: usize = sections.iter().map(|s| s.periods.len()).sum();
    if count == 0 || (!down && count <= ACROSS_PERIODS) {
        return None;
    }
    Some(flowchart(title, &sections))
}

fn flowchart(title: Option<&str>, sections: &[Section]) -> String {
    let mut out = String::new();
    if let Some(title) = title {
        let quoted = title.replace('\\', "\\\\").replace('"', "\\\"");
        out.push_str(&format!("---\ntitle: \"{quoted}\"\n---\n"));
    }
    out.push_str("flowchart TB");
    let mut ids = Vec::new();
    for (k, section) in sections.iter().enumerate() {
        if section.periods.is_empty() {
            continue;
        }
        let indent = if let Some(name) = &section.name {
            out.push_str(&format!("\n    subgraph s{k}[\"{}\"]", label(name)));
            "        "
        } else {
            "    "
        };
        for period in &section.periods {
            let id = format!("p{}", ids.len() + 1);
            let mut text = format!("<b>{}</b>", label(&period.name));
            for event in &period.events {
                text.push_str("<br>");
                text.push_str(&label(event));
            }
            out.push_str(&format!("\n{indent}{id}[\"{text}\"]"));
            ids.push(id);
        }
        if section.name.is_some() {
            out.push_str("\n    end");
        }
    }
    if ids.len() > 1 {
        out.push_str(&format!("\n    {}", ids.join(" --> ")));
    }
    out
}

/// Text for inside a quoted Mermaid label, which reads `"` and `<` itself.
fn label(text: &str) -> String {
    text.replace('"', "#quot;")
        .replace('<', "#lt;")
        .replace('>', "#gt;")
}
