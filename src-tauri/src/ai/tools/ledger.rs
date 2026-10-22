//! What this request's proposals have done so far: the text proposed,
//! the pictures in it, and the passages a later proposal may not overlap.

/// What this request's propose_edit calls have done so far.
#[derive(Debug, Default)]
pub struct ProposalLedger {
    /// The passages proposals already replace or delete.
    pub(crate) passages: Vec<ProposedPassage>,
    /// Replacements refused once as looking cut off (degenerate_replacement),
    /// as `anchor\0text`: the same call sent again is meant, and goes through.
    pub(crate) refused_short: Vec<String>,
    /// The new text of each proposal made: a picture may go next to a
    /// paragraph of it (ai::images), though it isn't in the document yet.
    pub(crate) texts: Vec<String>,
    /// The pictures this request wrote into its text (images::inline), by
    /// id.
    pub(crate) pictures: Vec<String>,
    /// Why pictures written into the text were left out of it (the limit
    /// reached), for propose_edit's result to say.
    pub(crate) unmade: Vec<String>,
}

impl ProposalLedger {
    /// A ledger that knows these pictures already: earlier requests',
    /// not decided yet, which this request's text may carry.
    pub fn with_pictures(pictures: Vec<String>) -> Self {
        Self {
            pictures,
            ..Self::default()
        }
    }

    /// A picture written into text this request proposes.
    pub fn add_picture(&mut self, id: String) {
        self.pictures.push(id);
    }

    /// The pictures written into this request's text, by id.
    #[cfg(test)]
    pub fn pictures(&self) -> &[String] {
        &self.pictures
    }

    /// A picture written into the text was left out, and why.
    pub fn note_unmade(&mut self, why: String) {
        if !self.unmade.contains(&why) {
            self.unmade.push(why);
        }
    }

    /// What becomes of the picture lines in `text`, for its result: each
    /// now reads `textus-generated:ID` in the call the model sees again.
    /// Unexplained, DeepSeek and MiniMax took that for an id they had made
    /// up, and spent the rest of the request trying to fix it.
    pub fn pictures_placed(&self, text: &str) -> String {
        let placed = self
            .pictures
            .iter()
            .filter(|id| text.contains(&format!("textus-generated:{id}")))
            .count();
        match placed {
            0 => String::new(),
            1 => " Its picture line is being made into its picture: in the text it now reads `textus-generated:` and the picture's id, which Textus wrote - nothing to fix.".to_string(),
            n => format!(" Its {n} picture lines are being made into their pictures: in the text each now reads `textus-generated:` and its picture's id, which Textus wrote - nothing to fix."),
        }
    }

    /// What the pictures left out of the text since last asked came to.
    pub fn take_unmade(&mut self) -> Option<String> {
        (!self.unmade.is_empty()).then(|| {
            format!(
                " A picture line was left out of the text: {}",
                std::mem::take(&mut self.unmade).join(" ")
            )
        })
    }

    /// Why `text`'s pictures can't stand: one put in twice, or one this
    /// request never asked for - a long id copied wrong drew one picture
    /// in two places. None when they can, or none were asked for.
    pub(crate) fn pictures_problem(&self, text: &str) -> Option<String> {
        if self.pictures.is_empty() {
            return None;
        }
        let mut used: Vec<&str> = Vec::new();
        for (at, _) in text.match_indices("textus-generated:") {
            let id: String = text[at + "textus-generated:".len()..]
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric())
                .collect();
            let Some(known) = self.pictures.iter().find(|p| **p == id) else {
                let missing: Vec<&str> = self.pictures.iter().map(String::as_str).collect();
                return Some(format!("Not proposed: `textus-generated:{id}` is no picture of this request. Its pictures are: {}.", missing.join(", ")));
            };
            if used.contains(&known.as_str()) {
                let left: Vec<&str> = self
                    .pictures
                    .iter()
                    .map(String::as_str)
                    .filter(|p| !used.contains(p) && *p != known)
                    .collect();
                return Some(format!(
                    "Not proposed: the picture `{id}` is in the text twice. Each picture goes in once{} - send the text again with each in its place.",
                    if left.is_empty() { String::new() } else { format!("; not placed yet: {}", left.join(", ")) }
                ));
            }
            used.push(known);
        }
        None
    }
    /// The new text of each proposal this request has made, in order.
    pub fn texts(&self) -> &[String] {
        &self.texts
    }

    /// A ledger whose proposals made these texts.
    #[cfg(test)]
    pub fn with_texts(texts: &[&str]) -> Self {
        Self {
            texts: texts.iter().map(|t| t.to_string()).collect(),
            ..Self::default()
        }
    }
}

/// A passage one of this request's proposals replaces or deletes: where it
/// sits in the document when the anchor (or its disambiguating context)
/// is found there verbatim, and the quoted text either way. Two proposals
/// overlap when their spans intersect - two fixes of the same repeated
/// word in one paragraph, pinned by overlapping contexts, are different
/// passages - and, where a span couldn't be placed, when one quote
/// contains the other.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ProposedPassage {
    /// Byte range in the document.
    pub(crate) span: Option<(usize, usize)>,
    /// The context if it pins the anchor, else the anchor; "" for the
    /// selection.
    pub(crate) quote: String,
}

impl ProposedPassage {
    pub(crate) fn selection() -> Self {
        Self::default()
    }

    pub(crate) fn locate(document: &str, anchor: &str, context: Option<&str>) -> Self {
        let context = context.filter(|c| c.len() > anchor.len() && c.contains(anchor));
        let span = match context {
            Some(c) if document.matches(c).count() == 1 => document
                .find(c)
                .zip(c.find(anchor))
                .map(|(at, offset)| at + offset),
            _ if document.matches(anchor).count() == 1 => document.find(anchor),
            _ => None,
        }
        .map(|start| (start, start + anchor.len()));
        Self {
            span,
            quote: context.unwrap_or(anchor).to_string(),
        }
    }

    pub(crate) fn overlaps(&self, other: &Self) -> bool {
        if let (Some(a), Some(b)) = (self.span, other.span) {
            return a.0 < b.1 && b.0 < a.1;
        }
        let (p, q) = (self.quote.as_str(), other.quote.as_str());
        (p.is_empty() && q.is_empty())
            || (!p.is_empty() && !q.is_empty() && (p.contains(q) || q.contains(p)))
    }
}
