//! How many searches and page reads web_search and web_fetch may make: per
//! request by default, or a budget shared by several runs (a paper's
//! research helpers, `ai::paper::SharedBudget`).

use std::sync::Mutex;

/// Per request: searches and page reads the model may make before it is told
/// to answer with what it has.
pub(crate) const MAX_SEARCHES: usize = 5;
pub(crate) const MAX_FETCHES: usize = 5;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum WebUse {
    Search,
    Fetch,
}

/// What a WebPlan counts its searches and page reads against.
pub(crate) trait WebBudget: Send + Sync {
    /// Counts one use of `kind`; false, and nothing counted, when none is left.
    fn take(&self, kind: WebUse) -> bool;
    /// How many of `kind` it allows in all, for the prompt and the refusal.
    fn limit(&self, kind: WebUse) -> usize;
}

/// One request's own limits: what chat has always had.
#[derive(Default)]
pub(crate) struct PerRequest {
    /// Searches, page reads.
    used: Mutex<[usize; 2]>,
}

impl WebBudget for PerRequest {
    fn take(&self, kind: WebUse) -> bool {
        let mut used = self.used.lock().unwrap();
        let n = &mut used[kind as usize];
        if *n >= self.limit(kind) {
            return false;
        }
        *n += 1;
        true
    }

    fn limit(&self, kind: WebUse) -> usize {
        match kind {
            WebUse::Search => MAX_SEARCHES,
            WebUse::Fetch => MAX_FETCHES,
        }
    }
}
