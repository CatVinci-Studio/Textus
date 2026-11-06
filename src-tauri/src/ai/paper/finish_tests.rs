//! Finishing a paper a few lookups at a time: the same paper as one at a
//! time, sooner. The clock is paused, so a lookup's wait costs no real time
//! and the times printed are what the waits add up to.

use super::*;
use aicompat::agent::Source;
use aicompat::images::GeneratedImage;
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};
use std::time::Duration;
use tokio::time::{sleep, Instant};

/// How long lookup `i` takes: scattered between 100 ms and a second, the
/// same every run, so later lookups often end before earlier ones.
fn scattered(i: usize) -> Duration {
    Duration::from_millis((i as u64 * 7919 % 10 + 1) * 100)
}

/// Lookups that count how many of them are waiting at once.
#[derive(Default)]
struct InFlight {
    now: AtomicUsize,
    most: AtomicUsize,
}

impl InFlight {
    async fn wait<T>(&self, wait: Duration, value: T) -> T {
        let now = self.now.fetch_add(1, SeqCst) + 1;
        self.most.fetch_max(now, SeqCst);
        sleep(wait).await;
        self.now.fetch_sub(1, SeqCst);
        value
    }
}

/// `n` sources cited by their address alone, but every fifth already
/// titled.
fn dossier(n: usize) -> Dossier {
    let sources = (0..n)
        .map(|i| Source {
            n: i as u32 + 1,
            url: format!("https://example.org/{i}"),
            title: if i % 5 == 4 {
                format!("Kept {i}")
            } else {
                String::new()
            },
        })
        .collect();
    Dossier {
        notes: Vec::new(),
        sources,
    }
}

fn number_in(address: &str) -> usize {
    address
        .rsplit('/')
        .next()
        .and_then(|n| n.parse().ok())
        .unwrap()
}

#[tokio::test(start_paused = true)]
async fn source_titles_land_on_their_own_sources_whatever_order_lookups_end() {
    let lookups = InFlight::default();
    let mut titled = dossier(20);
    // Every third address has no title to find: its source stays untitled.
    finish::title_sources_with(&mut titled, |address| {
        let i = number_in(&address);
        lookups.wait(
            scattered(i),
            (!i.is_multiple_of(3)).then(|| format!("Title {i}")),
        )
    })
    .await;
    let titles: Vec<String> = titled.sources.iter().map(|s| s.title.clone()).collect();
    let expected: Vec<String> = (0..20)
        .map(|i| match i {
            i if i % 5 == 4 => format!("Kept {i}"),
            i if i % 3 == 0 => String::new(),
            i => format!("Title {i}"),
        })
        .collect();
    assert_eq!(titles, expected);
    assert_eq!(lookups.most.load(SeqCst), finish::LOOKUPS_AT_ONCE);
}

#[tokio::test(start_paused = true)]
async fn twenty_titles_looked_up_six_at_a_time_take_a_fifth_of_the_time() {
    let wait = Duration::from_millis(300);
    let look_up = |address: String| async move {
        sleep(wait).await;
        Some(address)
    };
    let mut untitled = dossier(20);
    untitled.sources.iter_mut().for_each(|s| s.title.clear());
    // What title_sources did before: one lookup after another.
    let mut one_by_one = untitled.clone();
    let t = Instant::now();
    for source in &mut one_by_one.sources {
        source.title = look_up(source.url.clone()).await.unwrap_or_default();
    }
    let sequential = t.elapsed();
    let mut at_once = untitled;
    let t = Instant::now();
    finish::title_sources_with(&mut at_once, look_up).await;
    let concurrent = t.elapsed();
    eprintln!(
        "title_sources: 20 × 300ms: sequential {:.1}s, concurrent {:.1}s",
        sequential.as_secs_f64(),
        concurrent.as_secs_f64()
    );
    assert_eq!(at_once, one_by_one);
    assert_eq!(sequential, wait * 20);
    // Four rounds of six.
    assert_eq!(concurrent, wait * 4);
}

/// Section `s`'s marks: three, the last of each section one Commons has
/// nothing for.
fn marked(s: usize) -> String {
    let marks: Vec<String> = (0..3)
        .map(|m| format!("<!-- textus-figure web: Picture {s}{m} | words {s}{m} -->"))
        .collect();
    format!(
        "Section {s}.\n\n{}\n\nEnd {s}.",
        marks.join("\n\nBetween.\n\n")
    )
}

fn picture(n: u8) -> GeneratedImage {
    GeneratedImage {
        bytes: vec![n],
        mime: "image/jpeg",
        ext: "jpg",
        width: 4,
        height: 3,
    }
}

#[tokio::test(start_paused = true)]
async fn web_pictures_land_where_their_marks_were_four_searches_at_a_time() {
    let searches = InFlight::default();
    let sections: Vec<String> = (0..4).map(marked).collect();
    let resolved = web_figures::resolve(&sections, |words| {
        let mark = words.trim_start_matches("words ").to_string();
        let n: usize = mark.parse().unwrap();
        let found = (n % 10 != 2)
            .then(|| (picture(n as u8), format!("Credit {mark}")))
            .ok_or_else(|| "nothing".to_string());
        searches.wait(scattered(n), found)
    })
    .await;
    assert_eq!(searches.most.load(SeqCst), web_figures::AT_ONCE);
    let ids = regex::Regex::new(r"textus-generated:[^)]+").unwrap();
    for (s, section) in resolved.iter().enumerate() {
        let expected = format!(
            "Section {s}.\n\n\
             ![Picture {s}0](textus-generated:ID)\n\n*Credit {s}0*\n\nBetween.\n\n\
             ![Picture {s}1](textus-generated:ID)\n\n*Credit {s}1*\n\nBetween.\n\n\
             ![Picture {s}2](textus-picture:16:9 Picture {s}2 (words {s}2))\n\nEnd {s}."
        );
        assert_eq!(ids.replace_all(section, "textus-generated:ID"), expected);
    }
}

#[tokio::test(start_paused = true)]
async fn twelve_web_pictures_searched_four_at_a_time_take_a_quarter_of_the_time() {
    let wait = Duration::from_millis(300);
    let find = |_: String| async move {
        sleep(wait).await;
        Ok((picture(0), "Credit".to_string()))
    };
    let sections: Vec<String> = (0..4).map(marked).collect();
    let t = Instant::now();
    for section in &sections {
        for line in section.lines().filter_map(web_figures::read_mark) {
            let _ = find(line.1).await;
        }
    }
    let sequential = t.elapsed();
    let t = Instant::now();
    web_figures::resolve(&sections, find).await;
    let concurrent = t.elapsed();
    eprintln!(
        "web figures: 12 × 300ms: sequential {:.1}s, concurrent {:.1}s",
        sequential.as_secs_f64(),
        concurrent.as_secs_f64()
    );
    assert_eq!(sequential, wait * 12);
    assert_eq!(concurrent, wait * 3);
}
