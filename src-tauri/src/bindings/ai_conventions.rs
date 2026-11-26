use super::{builder, Group};

pub(super) fn group() -> Group {
    (
        "ai-conventions.ts",
        builder()
            // The document languages WRITING_CONVENTIONS is keyed by.
            .typ::<crate::ai::rules::Lang>(),
    )
}
