use super::*;
use chrono::{FixedOffset, NaiveDate, NaiveDateTime, Offset};

/// US Central time in 2026: CDT from 8 March 08:00 UTC to 1 November
/// 07:00 UTC, CST otherwise. Enough of America/Chicago for these tests
/// without a time zone database.
#[derive(Clone, Copy, Debug)]
struct Central;

const CST: i32 = -6 * 3600;
const CDT: i32 = -5 * 3600;

fn utc(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
    Utc.with_ymd_and_hms(y, m, d, h, min, 0)
        .unwrap()
        .timestamp_millis()
}

fn summer_starts() -> NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 3, 8)
        .unwrap()
        .and_hms_opt(8, 0, 0)
        .unwrap()
}

fn summer_ends() -> NaiveDateTime {
    NaiveDate::from_ymd_opt(2026, 11, 1)
        .unwrap()
        .and_hms_opt(7, 0, 0)
        .unwrap()
}

fn offset_at_utc(at: &NaiveDateTime) -> FixedOffset {
    let summer = *at >= summer_starts() && *at < summer_ends();
    FixedOffset::east_opt(if summer { CDT } else { CST }).unwrap()
}

impl TimeZone for Central {
    type Offset = FixedOffset;
    fn from_offset(_: &FixedOffset) -> Self {
        Central
    }
    fn offset_from_local_date(&self, local: &NaiveDate) -> LocalResult<FixedOffset> {
        self.offset_from_local_datetime(&local.and_hms_opt(12, 0, 0).unwrap())
    }
    fn offset_from_local_datetime(&self, local: &NaiveDateTime) -> LocalResult<FixedOffset> {
        // The offsets under which this local time exists.
        let fits: Vec<FixedOffset> = [CDT, CST]
            .into_iter()
            .map(|s| FixedOffset::east_opt(s).unwrap())
            .filter(|o| {
                let at = *local - Duration::seconds(i64::from(o.local_minus_utc()));
                offset_at_utc(&at).fix() == *o
            })
            .collect();
        match fits.as_slice() {
            [] => LocalResult::None,
            [one] => LocalResult::Single(*one),
            [a, b] => {
                // The earlier instant first: the summer offset.
                LocalResult::Ambiguous(*a, *b)
            }
            _ => unreachable!(),
        }
    }
    fn offset_from_utc_date(&self, utc: &NaiveDate) -> FixedOffset {
        offset_at_utc(&utc.and_hms_opt(12, 0, 0).unwrap())
    }
    fn offset_from_utc_datetime(&self, utc: &NaiveDateTime) -> FixedOffset {
        offset_at_utc(utc)
    }
}

#[test]
fn every_reads_minutes_hours_and_days_and_refuses_under_fifteen_minutes() {
    assert_eq!(parse_every("15m"), Ok(15));
    assert_eq!(parse_every("1h"), Ok(60));
    assert_eq!(parse_every("1h30m"), Ok(90));
    assert_eq!(parse_every("2d"), Ok(2 * 24 * 60));
    assert!(parse_every("14m").unwrap_err().contains("shortest"));
    for bad in ["", "15", "m", "15s", "1.5h", "-15m", "0m"] {
        assert!(parse_every(bad).is_err(), "{bad}");
    }
}

#[test]
fn daily_reads_a_twenty_four_hour_time() {
    assert_eq!(parse_daily("09:30"), Ok((9, 30)));
    assert_eq!(parse_daily("23:59"), Ok((23, 59)));
    for bad in ["24:00", "9", "9:30pm", "nine"] {
        assert!(parse_daily(bad).is_err(), "{bad}");
    }
}

#[test]
fn at_reads_an_offset_or_local_time() {
    assert_eq!(
        parse_at("2026-11-02T09:00:00-06:00", &Central),
        Ok(utc(2026, 11, 2, 15, 0))
    );
    assert_eq!(
        parse_at("2026-07-01T09:00", &Central),
        Ok(utc(2026, 7, 1, 14, 0))
    );
    assert!(parse_at("tomorrow", &Central).is_err());
}

#[test]
fn every_counts_from_when_it_was_scheduled_without_drifting() {
    let anchor = utc(2026, 5, 1, 12, 0);
    let every = Trigger::Every {
        minutes: 15,
        anchor,
    };
    assert_eq!(
        next_after(every, anchor, &Central),
        Some(anchor + 15 * 60_000)
    );
    // Fired a little late: the next is still on the anchor's beat.
    let late = anchor + 15 * 60_000 + 40_000;
    assert_eq!(
        next_after(every, late, &Central),
        Some(anchor + 30 * 60_000)
    );
}

#[test]
fn daily_is_today_until_its_time_then_tomorrow() {
    let daily = Trigger::Daily { hour: 9, minute: 0 };
    // 08:00 CDT on 1 July: today's 09:00 CDT.
    assert_eq!(
        next_after(daily, utc(2026, 7, 1, 13, 0), &Central),
        Some(utc(2026, 7, 1, 14, 0))
    );
    // At 09:00 exactly it is tomorrow's.
    assert_eq!(
        next_after(daily, utc(2026, 7, 1, 14, 0), &Central),
        Some(utc(2026, 7, 2, 14, 0))
    );
}

#[test]
fn daily_keeps_its_local_time_across_daylight_saving() {
    let daily = Trigger::Daily { hour: 9, minute: 0 };
    // Saturday 31 October, 09:00 CDT, then Sunday 1 November, 09:00 CST:
    // 25 hours apart, both at nine on the clock.
    let saturday = next_after(daily, utc(2026, 10, 31, 12, 0), &Central).unwrap();
    assert_eq!(saturday, utc(2026, 10, 31, 14, 0));
    let sunday = next_after(daily, saturday, &Central).unwrap();
    assert_eq!(sunday, utc(2026, 11, 1, 15, 0));
    // And in spring, 23 hours apart.
    let before = next_after(daily, utc(2026, 3, 7, 12, 0), &Central).unwrap();
    assert_eq!(before, utc(2026, 3, 7, 15, 0));
    assert_eq!(
        next_after(daily, before, &Central),
        Some(utc(2026, 3, 8, 14, 0))
    );
}

#[test]
fn a_daily_time_the_clocks_skip_fires_after_the_gap_and_a_repeated_one_once() {
    // 02:30 doesn't exist on 8 March: 03:00 CDT instead.
    let skipped = Trigger::Daily {
        hour: 2,
        minute: 30,
    };
    assert_eq!(
        next_after(skipped, utc(2026, 3, 8, 0, 0), &Central),
        Some(utc(2026, 3, 8, 8, 0))
    );
    // 01:30 happens twice on 1 November: the first, then the next day's.
    let repeated = Trigger::Daily {
        hour: 1,
        minute: 30,
    };
    let first = next_after(repeated, utc(2026, 11, 1, 0, 0), &Central).unwrap();
    assert_eq!(first, utc(2026, 11, 1, 6, 30));
    assert_eq!(
        next_after(repeated, first, &Central),
        Some(utc(2026, 11, 2, 7, 30))
    );
}

#[test]
fn at_is_due_once() {
    let at = utc(2026, 7, 1, 14, 0);
    assert_eq!(next_after(Trigger::At(at), at - 1, &Central), Some(at));
    assert_eq!(next_after(Trigger::At(at), at, &Central), None);
}

#[test]
fn a_time_reached_on_the_timer_fires_whatever_catch_up_says() {
    let daily = Trigger::Daily { hour: 9, minute: 0 };
    let due = utc(2026, 7, 1, 14, 0);
    for catch_up in [CatchUp::Once, CatchUp::Skip] {
        let (fire, next) = on_due(daily, catch_up, due, due + 30_000, &Central);
        assert!(fire);
        assert_eq!(next, Some(utc(2026, 7, 2, 14, 0)));
    }
}

#[test]
fn a_missed_time_fires_once_or_is_skipped_and_the_next_is_after_now() {
    let anchor = utc(2026, 7, 1, 12, 0);
    let every = Trigger::Every {
        minutes: 60,
        anchor,
    };
    // Textus was closed for five hours: one catch-up, not five.
    let due = anchor + 60 * 60_000;
    let now = anchor + 5 * 60 * 60_000 + 10 * 60_000;
    let (fire, next) = on_due(every, CatchUp::Once, due, now, &Central);
    assert!(fire);
    assert_eq!(next, Some(anchor + 6 * 60 * 60_000));
    let (fire, next) = on_due(every, CatchUp::Skip, due, now, &Central);
    assert!(!fire);
    assert_eq!(next, Some(anchor + 6 * 60 * 60_000));
    // A missed `at` is done either way.
    let at = Trigger::At(due);
    assert_eq!(on_due(at, CatchUp::Once, due, now, &Central), (true, None));
    assert_eq!(on_due(at, CatchUp::Skip, due, now, &Central), (false, None));
}
