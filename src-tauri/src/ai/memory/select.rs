//! Which memories go with a request once they are more than the budget
//! holds (MAX_MEMORY_CHARS): the requirements always, then the ones that
//! share the most words with what the request is about, newer before
//! older - as Letta keeps the memory that bears on the turn in view,
//! instead of only the newest. Under the budget every memory goes.

use super::*;
use std::collections::HashSet;

/// The words a text is about, for telling which memories bear on it:
/// Latin words of three letters or more, lower-cased, and each pair of
/// neighbouring CJK characters (Chinese has no spaces to split on).
fn words(text: &str) -> HashSet<String> {
    let mut found = HashSet::new();
    let mut word = String::new();
    let mut previous_cjk: Option<char> = None;
    for c in text.chars() {
        if is_cjk(c) {
            if let Some(p) = previous_cjk {
                found.insert(format!("{p}{c}"));
            }
            previous_cjk = Some(c);
        } else {
            previous_cjk = None;
        }
        if c.is_alphanumeric() && !is_cjk(c) {
            word.extend(c.to_lowercase());
        } else {
            if word.chars().count() >= 3 {
                found.insert(std::mem::take(&mut word));
            }
            word.clear();
        }
    }
    if word.chars().count() >= 3 {
        found.insert(word);
    }
    found
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xAC00..=0xD7AF | 0xF900..=0xFAFF)
}

impl Memories {
    /// Picks what goes with a request about `focus` (the user's message,
    /// the document's title), marking `included` again.
    pub fn select_for(&mut self, focus: &str) {
        let total: usize = self.items.iter().map(|m| m.text.chars().count()).sum();
        if total <= self.cap {
            for m in &mut self.items {
                m.included = true;
            }
            self.chars = total;
            return;
        }
        let focus = words(focus);
        let shared = |m: &Memory| words(&m.text).intersection(&focus).count();
        let mut order: Vec<usize> = (0..self.items.len()).collect();
        order.sort_by(|&a, &b| {
            let (x, y) = (&self.items[a], &self.items[b]);
            let rule = |m: &Memory| m.kind != MemoryKind::Requirement;
            rule(x)
                .cmp(&rule(y))
                .then_with(|| shared(y).cmp(&shared(x)))
                .then_with(|| y.remembered.updated.cmp(&x.remembered.updated))
                .then_with(|| (x.scope == Scope::Personal).cmp(&(y.scope == Scope::Personal)))
        });
        let mut chars = 0;
        for m in &mut self.items {
            m.included = false;
        }
        for i in order {
            let size = self.items[i].text.chars().count();
            if chars + size <= self.cap {
                chars += size;
                self.items[i].included = true;
            }
        }
        self.chars = chars;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory(kind: MemoryKind, text: &str, updated: &str) -> Memory {
        Memory {
            id: format!("project/memory/{}", text.len()),
            scope: Scope::Project,
            kind,
            text: text.to_string(),
            file: String::new(),
            remembered: Remembered {
                updated: updated.to_string(),
                ..Remembered::default()
            },
            included: false,
        }
    }

    #[test]
    fn under_the_budget_everything_goes() {
        let mut memories = Memories {
            items: vec![memory(
                MemoryKind::Preference,
                "Short replies.",
                "2026-01-01",
            )],
            chars: 0,
            cap: 4000,
            forgotten: Vec::new(),
        };
        memories.select_for("anything");
        assert!(memories.items[0].included);
    }

    #[test]
    fn over_it_the_rules_go_then_what_bears_on_the_request_old_or_new() {
        // 200 newer preferences that fill the budget, one old memory about
        // the lighthouse story, and one old requirement.
        let mut items: Vec<Memory> = (0..200)
            .map(|i| {
                memory(
                    MemoryKind::Preference,
                    &format!(
                        "偏好{i}：段落之间空一行，标题不加句号，引用用直角引号。{}",
                        "。".repeat(i % 3)
                    ),
                    "2026-10-20",
                )
            })
            .collect();
        items.push(memory(
            MemoryKind::Style,
            "灯塔看守人林晚说话简短，从不叫陌生人的名字。",
            "2025-01-01",
        ));
        items.push(memory(
            MemoryKind::Requirement,
            "Never use em dashes.",
            "2025-01-01",
        ));
        let mut memories = Memories {
            items,
            chars: 0,
            cap: 4000,
            forgotten: Vec::new(),
        };
        memories.select_for("帮我续写灯塔看守人那一章，林晚开门");
        let included = |text: &str| {
            memories
                .items
                .iter()
                .find(|m| m.text.contains(text))
                .unwrap()
                .included
        };
        assert!(included("Never use em dashes."));
        assert!(included("灯塔看守人林晚"));
        assert!(memories.chars <= 4000);
        assert!(memories.items.iter().any(|m| !m.included));
    }
}
