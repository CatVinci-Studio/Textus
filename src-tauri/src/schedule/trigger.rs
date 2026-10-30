//! When a job is due: its trigger read from what the plugin asked for, the
//! next time after a moment, and what a time missed while Textus wasn't
//! running becomes. Pure; times are Unix milliseconds, local time comes from
//! the `TimeZone` passed in.

use chrono::{DateTime, Duration, LocalResult, NaiveTime, TimeZone, Utc};

/// The shortest `every` a plugin may ask for.
pub const MIN_EVERY_MINUTES: u32 = 15;

/// A due time this late was missed (Textus wasn't running, or asleep), not
/// just reached on the timer's next tick.
pub const MISSED_AFTER_MS: i64 = 2 * 60 * 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Trigger {
    /// Once, at this moment.
    At(i64),
    /// Every so many minutes from the moment it was scheduled.
    Every { minutes: u32, anchor: i64 },
    /// Every day at this local time.
    Daily { hour: u32, minute: u32 },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub enum CatchUp {
    /// A time missed fires once when Textus is next running.
    #[default]
    Once,
    /// A time missed is let go.
    Skip,
}

/// "15m", "1h", "1h30m", "2d": minutes; at least `MIN_EVERY_MINUTES`.
pub fn parse_every(text: &str) -> Result<u32, String> {
    let bad = || format!("every \"{text}\" is not like \"15m\", \"1h\" or \"1h30m\".");
    let mut minutes: u64 = 0;
    let mut number = String::new();
    for c in text.trim().chars() {
        if c.is_ascii_digit() {
            number.push(c);
            continue;
        }
        let unit = match c {
            'm' => 1,
            'h' => 60,
            'd' => 24 * 60,
            _ => return Err(bad()),
        };
        let n: u64 = number.parse().map_err(|_| bad())?;
        minutes = minutes.saturating_add(n.saturating_mul(unit));
        number.clear();
    }
    if !number.is_empty() || minutes == 0 {
        return Err(bad());
    }
    let minutes = u32::try_from(minutes).map_err(|_| bad())?;
    if minutes < MIN_EVERY_MINUTES {
        return Err(format!(
            "every \"{text}\" is under the shortest, {MIN_EVERY_MINUTES}m."
        ));
    }
    Ok(minutes)
}

/// "09:30": hour and minute.
pub fn parse_daily(text: &str) -> Result<(u32, u32), String> {
    let time = NaiveTime::parse_from_str(text.trim(), "%H:%M")
        .map_err(|_| format!("daily \"{text}\" is not a time like \"09:30\"."))?;
    use chrono::Timelike;
    Ok((time.hour(), time.minute()))
}

/// An RFC 3339 date and time ("2026-11-02T09:00:00-06:00"), or one without
/// an offset, read as local time.
pub fn parse_at<Tz: TimeZone>(text: &str, tz: &Tz) -> Result<i64, String> {
    let bad = || format!("at \"{text}\" is not a date and time like \"2026-11-02T09:00\".");
    if let Ok(at) = DateTime::parse_from_rfc3339(text.trim()) {
        return Ok(at.timestamp_millis());
    }
    let naive = ["%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"]
        .iter()
        .find_map(|f| chrono::NaiveDateTime::parse_from_str(text.trim(), f).ok())
        .ok_or_else(bad)?;
    first_valid(tz, naive).ok_or_else(bad)
}

/// The instant a local time names: the earlier of two when clocks go back,
/// and the first minute after the gap when they go forward.
fn first_valid<Tz: TimeZone>(tz: &Tz, naive: chrono::NaiveDateTime) -> Option<i64> {
    // A gap is at most a few hours anywhere.
    for minutes in 0..=4 * 60 {
        match tz.from_local_datetime(&(naive + Duration::minutes(minutes))) {
            LocalResult::Single(t) => return Some(t.timestamp_millis()),
            LocalResult::Ambiguous(earlier, _) => return Some(earlier.timestamp_millis()),
            LocalResult::None => continue,
        }
    }
    None
}

/// The first time the trigger is due strictly after `after`; None once an
/// `at` has passed.
pub fn next_after<Tz: TimeZone>(trigger: Trigger, after: i64, tz: &Tz) -> Option<i64> {
    match trigger {
        Trigger::At(at) => (at > after).then_some(at),
        Trigger::Every { minutes, anchor } => {
            let step = i64::from(minutes) * 60_000;
            if after < anchor {
                return Some(anchor + step);
            }
            Some(anchor + ((after - anchor) / step + 1) * step)
        }
        Trigger::Daily { hour, minute } => {
            let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
            let local = Utc
                .timestamp_millis_opt(after)
                .single()?
                .with_timezone(tz)
                .date_naive();
            // Today's, else tomorrow's: a day later is always past `after`.
            (0..=2).find_map(|days| {
                let at = first_valid(tz, (local + Duration::days(days)).and_time(time))?;
                (at > after).then_some(at)
            })
        }
    }
}

/// A job whose due time `due` has come, looked at `now`: whether it fires,
/// and when it is due next (None: it is done).
pub fn on_due<Tz: TimeZone>(
    trigger: Trigger,
    catch_up: CatchUp,
    due: i64,
    now: i64,
    tz: &Tz,
) -> (bool, Option<i64>) {
    let missed = now - due > MISSED_AFTER_MS;
    let fire = !missed || catch_up == CatchUp::Once;
    (fire, next_after(trigger, now, tz))
}

#[cfg(test)]
mod tests;
