//! Every plugin's scheduled jobs, kept in `plugins/schedule.json` so they
//! outlive a restart: what each asked for, when it is due next, and which
//! are due now.

use super::trigger::{self, CatchUp, Trigger};
use chrono::TimeZone;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// The most jobs one plugin may keep.
pub const MAX_JOBS_PER_PLUGIN: usize = 32;

/// Where a notification's click goes: a file, inside the folder the job or
/// call came from, at a line. Mirrors NotificationOpen in
/// src/plugins/background/schedule.ts.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NotificationOpen {
    pub path: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
}

/// A system notification as a plugin asks for it. Mirrors NotificationSpec
/// in src/plugins/background/schedule.ts.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct NotificationSpec {
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub open: Option<NotificationOpen>,
}

/// A job as a plugin asks for it: one of `at`, `every`, `daily`, and a
/// notification, a handler of its background code, or both. Mirrors JobSpec
/// in src/plugins/background/schedule.ts.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct JobSpec {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub every: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily: Option<String>,
    #[serde(default)]
    pub catch_up: CatchUp,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify: Option<NotificationSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<String>,
}

/// A job kept: what was asked, read, and where it stands.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub spec: JobSpec,
    pub trigger: Trigger,
    /// The folder open when it was scheduled, for its files and its
    /// notification's file (only with files.read).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    pub next_due: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_fired: Option<i64>,
}

/// A job as the plugin and Settings see it. Mirrors ScheduledJob in
/// src/plugins/background/schedule.ts.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[cfg_attr(test, derive(specta::Type))]
#[serde(rename_all = "camelCase")]
pub struct ScheduledJob {
    pub id: String,
    #[serde(flatten)]
    pub spec: JobSpec,
    /// Unix milliseconds; null once an `at` has fired.
    pub next_due: Option<f64>,
    pub last_fired: Option<f64>,
}

/// A job that came due and fires.
#[derive(Clone, Debug, PartialEq)]
pub struct Firing {
    pub plugin: String,
    pub id: String,
    pub spec: JobSpec,
    pub root: Option<String>,
    pub due: i64,
}

#[derive(Serialize, Deserialize, Default, Clone, Debug, PartialEq)]
pub struct Store {
    #[serde(default)]
    pub plugins: BTreeMap<String, BTreeMap<String, Job>>,
}

/// A job's id: what a plugin calls it, safe to keep and show.
pub fn require_job_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok {
        Ok(())
    } else {
        Err(format!(
            "A job id is 1 to 64 letters, digits, '-', '_' or '.', not \"{id}\"."
        ))
    }
}

/// The trigger a spec names: exactly one of at, every, daily. `now` is
/// when it was scheduled, which `every` counts from.
pub fn trigger_of<Tz: TimeZone>(spec: &JobSpec, now: i64, tz: &Tz) -> Result<Trigger, String> {
    let named = [&spec.at, &spec.every, &spec.daily]
        .iter()
        .filter(|t| t.is_some())
        .count();
    if named != 1 {
        return Err("A job has one of at, every or daily.".to_string());
    }
    if spec.notify.is_none() && spec.run.is_none() {
        return Err("A job has notify, run or both.".to_string());
    }
    if let Some(n) = &spec.notify {
        if n.title.trim().is_empty() {
            return Err("A notification has a title.".to_string());
        }
    }
    if let Some(at) = &spec.at {
        return trigger::parse_at(at, tz).map(Trigger::At);
    }
    if let Some(every) = &spec.every {
        let minutes = trigger::parse_every(every)?;
        return Ok(Trigger::Every {
            minutes,
            anchor: now,
        });
    }
    let (hour, minute) = trigger::parse_daily(spec.daily.as_deref().unwrap_or_default())?;
    Ok(Trigger::Daily { hour, minute })
}

impl Store {
    /// Adds or replaces a plugin's job. An `at` in the past fires at once
    /// with catchUp "once", and is refused with "skip".
    pub fn set<Tz: TimeZone>(
        &mut self,
        plugin: &str,
        id: &str,
        spec: JobSpec,
        root: Option<String>,
        now: i64,
        tz: &Tz,
    ) -> Result<ScheduledJob, String> {
        require_job_id(id)?;
        let trigger = trigger_of(&spec, now, tz)?;
        let next_due = match trigger {
            Trigger::At(at) if at <= now => {
                if spec.catch_up == CatchUp::Skip {
                    return Err("That time has passed.".to_string());
                }
                Some(now)
            }
            _ => trigger::next_after(trigger, now, tz),
        };
        let jobs = self.plugins.entry(plugin.to_string()).or_default();
        if !jobs.contains_key(id) && jobs.len() >= MAX_JOBS_PER_PLUGIN {
            return Err(format!(
                "A plugin keeps at most {MAX_JOBS_PER_PLUGIN} jobs."
            ));
        }
        let job = Job {
            spec,
            trigger,
            root,
            next_due,
            last_fired: None,
        };
        let shown = scheduled(id, &job);
        jobs.insert(id.to_string(), job);
        Ok(shown)
    }

    pub fn clear(&mut self, plugin: &str, id: &str) -> bool {
        let Some(jobs) = self.plugins.get_mut(plugin) else {
            return false;
        };
        let gone = jobs.remove(id).is_some();
        if jobs.is_empty() {
            self.plugins.remove(plugin);
        }
        gone
    }

    /// Every job of a plugin goes (it was uninstalled).
    pub fn drop_plugin(&mut self, plugin: &str) -> bool {
        self.plugins.remove(plugin).is_some()
    }

    pub fn list(&self, plugin: &str) -> Vec<ScheduledJob> {
        self.plugins
            .get(plugin)
            .map(|jobs| jobs.iter().map(|(id, job)| scheduled(id, job)).collect())
            .unwrap_or_default()
    }

    /// The soonest due time among the plugins that run; a plugin turned off
    /// keeps its jobs, paused.
    pub fn earliest(&self, runs: impl Fn(&str) -> bool) -> Option<i64> {
        self.plugins
            .iter()
            .filter(|(plugin, _)| runs(plugin))
            .flat_map(|(_, jobs)| jobs.values().filter_map(|j| j.next_due))
            .min()
    }

    /// The jobs of running plugins due by `now`, moved on to their next
    /// time (or removed when done); the ones that fire.
    pub fn take_due<Tz: TimeZone>(
        &mut self,
        now: i64,
        runs: impl Fn(&str) -> bool,
        tz: &Tz,
    ) -> Vec<Firing> {
        let mut firings = Vec::new();
        for (plugin, jobs) in self.plugins.iter_mut().filter(|(p, _)| runs(p)) {
            jobs.retain(|id, job| {
                let Some(due) = job.next_due.filter(|due| *due <= now) else {
                    return true;
                };
                let (fire, next) = trigger::on_due(job.trigger, job.spec.catch_up, due, now, tz);
                if fire {
                    job.last_fired = Some(now);
                    firings.push(Firing {
                        plugin: plugin.clone(),
                        id: id.clone(),
                        spec: job.spec.clone(),
                        root: job.root.clone(),
                        due,
                    });
                }
                job.next_due = next;
                next.is_some()
            });
        }
        self.plugins.retain(|_, jobs| !jobs.is_empty());
        firings
    }
}

fn scheduled(id: &str, job: &Job) -> ScheduledJob {
    ScheduledJob {
        id: id.to_string(),
        spec: job.spec.clone(),
        next_due: job.next_due.map(|t| t as f64),
        last_fired: job.last_fired.map(|t| t as f64),
    }
}

#[cfg(test)]
mod tests;
