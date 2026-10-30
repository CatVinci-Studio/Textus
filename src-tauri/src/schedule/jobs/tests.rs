use super::*;
use chrono::{FixedOffset, Utc};

fn tz() -> FixedOffset {
    FixedOffset::west_opt(6 * 3600).unwrap()
}

fn at(h: u32, m: u32) -> i64 {
    Utc.with_ymd_and_hms(2026, 7, 1, h, m, 0)
        .unwrap()
        .timestamp_millis()
}

fn reminder(daily: &str) -> JobSpec {
    JobSpec {
        daily: Some(daily.to_string()),
        notify: Some(NotificationSpec {
            title: "Write".to_string(),
            body: String::new(),
            open: None,
        }),
        ..Default::default()
    }
}

#[test]
fn a_job_names_one_trigger_and_something_to_do() {
    let mut store = Store::default();
    let both = JobSpec {
        every: Some("1h".into()),
        ..reminder("09:00")
    };
    assert!(store.set("a.b", "x", both, None, at(12, 0), &tz()).is_err());
    let nothing = JobSpec {
        daily: Some("09:00".into()),
        ..Default::default()
    };
    assert!(store
        .set("a.b", "x", nothing, None, at(12, 0), &tz())
        .is_err());
    assert!(store
        .set("a.b", "../x", reminder("09:00"), None, at(12, 0), &tz())
        .is_err());
    let job = store
        .set("a.b", "morning", reminder("09:00"), None, at(12, 0), &tz())
        .unwrap();
    // 12:00 UTC is 06:00 here: due at 09:00 local, 15:00 UTC.
    assert_eq!(job.next_due, Some(at(15, 0) as f64));
}

#[test]
fn a_plugin_keeps_a_bounded_number_of_jobs() {
    let mut store = Store::default();
    for i in 0..MAX_JOBS_PER_PLUGIN {
        store
            .set(
                "a.b",
                &format!("j{i}"),
                reminder("09:00"),
                None,
                at(12, 0),
                &tz(),
            )
            .unwrap();
    }
    assert!(store
        .set("a.b", "one-more", reminder("09:00"), None, at(12, 0), &tz())
        .is_err());
    // Replacing one is fine.
    assert!(store
        .set("a.b", "j0", reminder("10:00"), None, at(12, 0), &tz())
        .is_ok());
}

#[test]
fn due_jobs_fire_and_move_on_and_a_fired_at_is_removed() {
    let mut store = Store::default();
    store
        .set("a.b", "daily", reminder("09:00"), None, at(12, 0), &tz())
        .unwrap();
    let once = JobSpec {
        daily: None,
        at: Some("2026-07-01T09:30:00-06:00".into()),
        ..reminder("")
    };
    store
        .set("a.b", "once", once, None, at(12, 0), &tz())
        .unwrap();
    assert_eq!(store.earliest(|_| true), Some(at(15, 0)));
    assert!(store.take_due(at(14, 59), |_| true, &tz()).is_empty());
    let fired = store.take_due(at(15, 0), |_| true, &tz());
    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].id, "daily");
    let fired = store.take_due(at(15, 31), |_| true, &tz());
    assert_eq!(
        fired.iter().map(|f| f.id.as_str()).collect::<Vec<_>>(),
        ["once"]
    );
    let left = store.list("a.b");
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].last_fired, Some(at(15, 0) as f64));
}

#[test]
fn a_paused_plugins_jobs_wait_and_catch_up_once_when_it_runs_again() {
    let mut store = Store::default();
    store
        .set("a.b", "daily", reminder("09:00"), None, at(12, 0), &tz())
        .unwrap();
    // Turned off over 09:00: nothing fires, nothing moves.
    assert!(store.take_due(at(16, 0), |_| false, &tz()).is_empty());
    assert_eq!(store.earliest(|_| false), None);
    // On again at 10:00 local: the missed 09:00 fires once.
    assert_eq!(store.take_due(at(16, 0), |_| true, &tz()).len(), 1);
    assert!(store.take_due(at(16, 1), |_| true, &tz()).is_empty());
}

#[test]
fn a_skipped_catch_up_lets_the_missed_time_go() {
    let mut store = Store::default();
    let spec = JobSpec {
        catch_up: CatchUp::Skip,
        ..reminder("09:00")
    };
    store
        .set("a.b", "daily", spec, None, at(12, 0), &tz())
        .unwrap();
    assert!(store.take_due(at(18, 0), |_| true, &tz()).is_empty());
    assert_eq!(store.earliest(|_| true), Some(at(15, 0) + 24 * 3_600_000));
}

#[test]
fn an_at_in_the_past_fires_at_once_or_is_refused_with_skip() {
    let mut store = Store::default();
    let past = JobSpec {
        daily: None,
        at: Some("2026-07-01T01:00:00-06:00".into()),
        ..reminder("")
    };
    let job = store
        .set("a.b", "late", past.clone(), None, at(12, 0), &tz())
        .unwrap();
    assert_eq!(job.next_due, Some(at(12, 0) as f64));
    let skip = JobSpec {
        catch_up: CatchUp::Skip,
        ..past
    };
    assert!(store
        .set("a.b", "late2", skip, None, at(12, 0), &tz())
        .is_err());
}

#[test]
fn the_store_survives_a_round_trip_through_its_file() {
    let mut store = Store::default();
    let every = JobSpec {
        every: Some("15m".into()),
        run: Some("sync".into()),
        catch_up: CatchUp::Skip,
        ..Default::default()
    };
    store
        .set(
            "a.b",
            "sync",
            every,
            Some("/notes".into()),
            at(12, 0),
            &tz(),
        )
        .unwrap();
    store
        .set("c.d", "daily", reminder("21:30"), None, at(12, 0), &tz())
        .unwrap();
    let json = serde_json::to_string(&store).unwrap();
    let back: Store = serde_json::from_str(&json).unwrap();
    assert_eq!(back, store);
    assert!(json.contains("\"catchUp\":\"skip\""));
    // An empty or missing file is no jobs.
    assert_eq!(
        serde_json::from_str::<Store>("{}").unwrap(),
        Store::default()
    );
}

#[test]
fn uninstalling_or_clearing_takes_jobs_away() {
    let mut store = Store::default();
    store
        .set("a.b", "x", reminder("09:00"), None, at(12, 0), &tz())
        .unwrap();
    store
        .set("a.b", "y", reminder("10:00"), None, at(12, 0), &tz())
        .unwrap();
    assert!(store.clear("a.b", "x"));
    assert!(!store.clear("a.b", "x"));
    assert!(store.drop_plugin("a.b"));
    assert!(store.list("a.b").is_empty());
    assert!(store.plugins.is_empty());
}

#[test]
fn a_listed_job_reads_as_the_plugin_wrote_it() {
    let mut store = Store::default();
    store
        .set("a.b", "x", reminder("09:00"), None, at(12, 0), &tz())
        .unwrap();
    let json = serde_json::to_value(&store.list("a.b")[0]).unwrap();
    assert_eq!(json["id"], "x");
    assert_eq!(json["daily"], "09:00");
    assert_eq!(json["catchUp"], "once");
    assert_eq!(json["notify"]["title"], "Write");
    assert_eq!(json["nextDue"], at(15, 0) as f64);
}
