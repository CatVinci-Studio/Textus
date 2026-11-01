//! What one paper's research may spend, in all its helpers together - in
//! place of chat's five searches and five page reads per request.

use crate::ai::web::{WebBudget, WebUse};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Model calls a paper may make before it stops to ask: an ordinary paper
/// takes 60-100.
pub(crate) const MODEL_STEPS: u32 = 120;

/// A paper's error when its model calls are spent; the card says so.
pub(crate) const STEPS_SPENT: &str = "PAPER_STEPS_SPENT";

/// A count of each thing research spends.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BudgetCounts {
    pub searches: u32,
    pub fetches: u32,
    pub paper_lookups: u32,
    pub images: u32,
    /// Calls to the writing model, in every stage together.
    pub model_steps: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BudgetKind {
    Search,
    Fetch,
    PaperLookup,
    /// A picture made by the image service.
    Image,
    /// One call to the writing model.
    ModelStep,
}

impl BudgetCounts {
    fn get(&self, kind: BudgetKind) -> u32 {
        match kind {
            BudgetKind::Search => self.searches,
            BudgetKind::Fetch => self.fetches,
            BudgetKind::PaperLookup => self.paper_lookups,
            BudgetKind::Image => self.images,
            BudgetKind::ModelStep => self.model_steps,
        }
    }

    fn get_mut(&mut self, kind: BudgetKind) -> &mut u32 {
        match kind {
            BudgetKind::Search => &mut self.searches,
            BudgetKind::Fetch => &mut self.fetches,
            BudgetKind::PaperLookup => &mut self.paper_lookups,
            BudgetKind::Image => &mut self.images,
            BudgetKind::ModelStep => &mut self.model_steps,
        }
    }
}

/// A paper's limits and what it has used of them.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ResearchBudget {
    pub limits: BudgetCounts,
    pub used: BudgetCounts,
}

impl ResearchBudget {
    pub(crate) fn new(limits: BudgetCounts) -> Self {
        Self {
            limits,
            used: BudgetCounts::default(),
        }
    }

    /// Enough for 6-10 research questions on a 5,000-10,000 character paper.
    pub(crate) fn for_paper() -> Self {
        Self::new(BudgetCounts {
            searches: 40,
            fetches: 60,
            paper_lookups: 30,
            images: 6,
            model_steps: MODEL_STEPS,
        })
    }

    /// A paper that spent its model calls is given as many again when it is
    /// gone on with: going on is the user's yes to spending them.
    pub(crate) fn renewed(mut self) -> Self {
        if self.used.model_steps >= self.limits.model_steps {
            self.limits.model_steps = self.used.model_steps + MODEL_STEPS;
        }
        self
    }

    /// Counts one use of `kind`; false, and nothing counted, when none is left.
    pub(crate) fn take(&mut self, kind: BudgetKind) -> bool {
        let limit = self.limits.get(kind);
        let used = self.used.get_mut(kind);
        if *used >= limit {
            return false;
        }
        *used += 1;
        true
    }

    pub(crate) fn remaining(&self) -> BudgetCounts {
        let left = |kind| self.limits.get(kind).saturating_sub(self.used.get(kind));
        BudgetCounts {
            searches: left(BudgetKind::Search),
            fetches: left(BudgetKind::Fetch),
            paper_lookups: left(BudgetKind::PaperLookup),
            images: left(BudgetKind::Image),
            model_steps: left(BudgetKind::ModelStep),
        }
    }
}

/// A budget the research helpers running at once all count against.
pub(crate) struct SharedBudget(Mutex<ResearchBudget>);

impl SharedBudget {
    pub(crate) fn new(budget: ResearchBudget) -> Self {
        Self(Mutex::new(budget))
    }

    pub(crate) fn take(&self, kind: BudgetKind) -> bool {
        self.0.lock().unwrap().take(kind)
    }

    /// What it stands at now, to keep with the paper or show the user.
    pub(crate) fn snapshot(&self) -> ResearchBudget {
        *self.0.lock().unwrap()
    }
}

fn web_kind(kind: WebUse) -> BudgetKind {
    match kind {
        WebUse::Search => BudgetKind::Search,
        WebUse::Fetch => BudgetKind::Fetch,
        WebUse::Papers => BudgetKind::PaperLookup,
    }
}

impl WebBudget for SharedBudget {
    fn take(&self, kind: WebUse) -> bool {
        SharedBudget::take(self, web_kind(kind))
    }

    fn limit(&self, kind: WebUse) -> usize {
        self.0.lock().unwrap().limits.get(web_kind(kind)) as usize
    }
}

/// Writes what research has spent into the kept paper when it ends short -
/// stopped, failed - so going on doesn't begin again with a full budget.
pub(super) struct KeepSpent<'a> {
    pub(super) root: &'a std::path::Path,
    pub(super) id: String,
    pub(super) budget: std::sync::Arc<SharedBudget>,
    /// The paper's own picture limit, not this run's image model's.
    pub(super) images: u32,
    pub(super) done: bool,
}

impl KeepSpent<'_> {
    pub(super) fn spent(&self) -> ResearchBudget {
        let mut spent = self.budget.snapshot();
        spent.limits.images = self.images;
        spent
    }
}

impl Drop for KeepSpent<'_> {
    fn drop(&mut self) {
        if self.done {
            return;
        }
        if let Ok(mut files) = super::load(self.root, &self.id) {
            files.paper.budget = self.spent();
            let _ = super::save(self.root, &files);
        }
    }
}
