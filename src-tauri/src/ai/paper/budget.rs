//! What one paper's research may spend, in all its helpers together - in
//! place of chat's five searches and five page reads per request.

use crate::ai::web::{WebBudget, WebUse};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// A count of each thing research spends.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct BudgetCounts {
    pub searches: u32,
    pub fetches: u32,
    pub paper_lookups: u32,
    pub images: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum BudgetKind {
    Search,
    Fetch,
    PaperLookup,
    /// A picture made by the image service.
    Image,
}

impl BudgetCounts {
    fn get(&self, kind: BudgetKind) -> u32 {
        match kind {
            BudgetKind::Search => self.searches,
            BudgetKind::Fetch => self.fetches,
            BudgetKind::PaperLookup => self.paper_lookups,
            BudgetKind::Image => self.images,
        }
    }

    fn get_mut(&mut self, kind: BudgetKind) -> &mut u32 {
        match kind {
            BudgetKind::Search => &mut self.searches,
            BudgetKind::Fetch => &mut self.fetches,
            BudgetKind::PaperLookup => &mut self.paper_lookups,
            BudgetKind::Image => &mut self.images,
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
        })
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
