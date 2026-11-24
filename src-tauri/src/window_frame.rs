//! Where an editor window opens: where the last one closed if still on a screen,
//! else centred on the main screen, and never bigger than its screen; and how it
//! was left, maximized or full screen.

use serde::{Deserialize, Serialize};

/// A screen's work area (without the menu bar, Dock or taskbar), in
/// logical pixels - the window's own units.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Screen {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// How much of the window's top edge must be on a screen for the window
/// to count as there: enough of the title bar to take hold of and drag.
const GRIP: (f64, f64) = (120.0, 40.0);

/// The window's position and size (logical px). `saved` is the last window's
/// position; the first screen is the main one; `min` the least size.
pub fn place(
    saved: Option<(f64, f64)>,
    size: (f64, f64),
    screens: &[Screen],
    min: (f64, f64),
) -> (Option<(f64, f64)>, (f64, f64)) {
    let Some(main) = screens.first() else {
        return (saved, size);
    };
    let held = saved.and_then(|(x, y)| {
        screens
            .iter()
            .find(|s| grips(s, x, y, size.0))
            .map(|s| (s, (x, y)))
    });
    let screen = held.map_or(main, |(s, _)| s);
    let fit = (
        size.0.min(screen.width).max(min.0),
        size.1.min(screen.height).max(min.1),
    );
    let (w, h) = fit;
    let position = match held {
        // Where it was, moved in only as far as it now runs off.
        Some((_, (x, y))) => (
            x.min(screen.x + screen.width - w).max(screen.x),
            y.min(screen.y + screen.height - h).max(screen.y),
        ),
        None => (
            screen.x + (screen.width - w) / 2.0,
            screen.y + (screen.height - h) / 2.0,
        ),
    };
    (Some((position.0.round(), position.1.round())), fit)
}

/// How a window was left.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Normal,
    Maximized,
    Fullscreen,
}

/// A window's normal bounds (logical px: inner size, outer position) and how it
/// was left. Maximized or full screen, the bounds are those it goes back to.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Kept {
    pub size: (f64, f64),
    /// None where the system doesn't say (Wayland), or for a window it placed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<(f64, f64)>,
    #[serde(default)]
    pub mode: Mode,
}

/// What a window's bounds and state read now.
pub struct Live {
    pub frame: Kept,
    pub minimized: bool,
}

/// The bounds a window would go back to, when it is in none of the states
/// that hide them.
pub fn normal_bounds(live: &Live) -> Option<Kept> {
    (!live.minimized && live.frame.mode == Mode::Normal).then_some(live.frame)
}

/// What to keep of a closing window. Maximized or full screen its size is the
/// screen's, so the normal bounds last seen (`normal`) are kept with the mode.
pub fn on_close(live: &Live, normal: Option<Kept>) -> Option<Kept> {
    if live.minimized {
        return normal;
    }
    if live.frame.mode == Mode::Normal {
        return Some(live.frame);
    }
    Some(Kept {
        mode: live.frame.mode,
        ..normal.unwrap_or(live.frame)
    })
}

/// A kept frame fitted to today's screens by `place`, its mode unchanged: a
/// maximized window whose screen is gone maximizes on the main one.
pub fn reopen(kept: Kept, screens: &[Screen], min: (f64, f64)) -> Kept {
    let (position, size) = place(kept.position, kept.size, screens, min);
    Kept {
        size,
        position,
        mode: kept.mode,
    }
}

/// Whether enough of a window at (x, y), `width` wide, has its top edge on
/// `screen` to be taken hold of.
fn grips(screen: &Screen, x: f64, y: f64, width: f64) -> bool {
    let left = x.max(screen.x);
    let right = (x + width).min(screen.x + screen.width);
    right - left >= GRIP.0 && y >= screen.y && y + GRIP.1 <= screen.y + screen.height
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: (f64, f64) = (480.0, 320.0);
    const LAPTOP: Screen = Screen {
        x: 0.0,
        y: 25.0,
        width: 1440.0,
        height: 850.0,
    };
    const MONITOR: Screen = Screen {
        x: 1440.0,
        y: 0.0,
        width: 2560.0,
        height: 1415.0,
    };

    #[test]
    fn opens_where_the_last_window_closed() {
        let (pos, size) = place(Some((300.0, 100.0)), (1000.0, 700.0), &[LAPTOP], MIN);
        assert_eq!(pos, Some((300.0, 100.0)));
        assert_eq!(size, (1000.0, 700.0));
    }

    #[test]
    fn opens_on_the_second_screen_it_was_left_on() {
        let screens = [LAPTOP, MONITOR];
        let (pos, _) = place(Some((1800.0, 300.0)), (1200.0, 800.0), &screens, MIN);
        assert_eq!(pos, Some((1800.0, 300.0)));
    }

    #[test]
    fn a_screen_gone_centres_it_on_the_main_one() {
        // Left on the monitor, now unplugged.
        let (pos, size) = place(Some((1800.0, 300.0)), (1200.0, 800.0), &[LAPTOP], MIN);
        assert_eq!(size, (1200.0, 800.0));
        assert_eq!(pos, Some((120.0, 50.0)));
    }

    #[test]
    fn a_size_from_a_bigger_screen_shrinks_to_fit_and_centres() {
        // 2000x1200 from the monitor, on the laptop's 1440x850.
        let (pos, size) = place(None, (2000.0, 1200.0), &[LAPTOP], MIN);
        assert_eq!(size, (1440.0, 850.0));
        assert_eq!(pos, Some((0.0, 25.0)));
    }

    #[test]
    fn half_off_the_edge_is_moved_back_in() {
        let (pos, size) = place(Some((1200.0, 600.0)), (1000.0, 700.0), &[LAPTOP], MIN);
        assert_eq!(size, (1000.0, 700.0));
        assert_eq!(pos, Some((440.0, 175.0)));
    }

    #[test]
    fn only_a_sliver_left_on_screen_counts_as_gone() {
        let (pos, _) = place(Some((1380.0, 200.0)), (1000.0, 700.0), &[LAPTOP], MIN);
        assert_eq!(pos, Some((220.0, 100.0)));
    }

    #[test]
    fn never_below_the_least_size() {
        let tiny = Screen {
            width: 400.0,
            height: 250.0,
            ..LAPTOP
        };
        let (_, size) = place(None, (1000.0, 700.0), &[tiny], MIN);
        assert_eq!(size, MIN);
    }

    fn live(size: (f64, f64), at: (f64, f64), mode: Mode, minimized: bool) -> Live {
        Live {
            frame: Kept {
                size,
                position: Some(at),
                mode,
            },
            minimized,
        }
    }

    const NORMAL: Kept = Kept {
        size: (1000.0, 700.0),
        position: Some((300.0, 100.0)),
        mode: Mode::Normal,
    };

    #[test]
    fn a_window_closed_maximized_keeps_its_normal_bounds_and_reopens_maximized() {
        let filled = live((1440.0, 850.0), (0.0, 25.0), Mode::Maximized, false);
        // While maximized its bounds are the screen's, not ones to go back to.
        assert_eq!(normal_bounds(&filled), None);
        let kept = on_close(&filled, Some(NORMAL)).unwrap();
        assert_eq!(
            kept,
            Kept {
                mode: Mode::Maximized,
                ..NORMAL
            }
        );
        assert_eq!(reopen(kept, &[LAPTOP], MIN), kept);
    }

    #[test]
    fn a_window_closed_full_screen_reopens_full_screen() {
        let full = live((1440.0, 900.0), (0.0, 0.0), Mode::Fullscreen, false);
        assert_eq!(
            on_close(&full, Some(NORMAL)).unwrap().mode,
            Mode::Fullscreen
        );
        // Never seen otherwise: what it has now, which reopening fits.
        let kept = on_close(&full, None).unwrap();
        assert_eq!(kept.size, (1440.0, 900.0));
        assert_eq!(reopen(kept, &[LAPTOP], MIN).size, (1440.0, 850.0));
    }

    #[test]
    fn a_window_closed_normal_keeps_what_it_has_and_minimized_what_it_had() {
        let now = live((900.0, 600.0), (50.0, 60.0), Mode::Normal, false);
        assert_eq!(normal_bounds(&now), Some(now.frame));
        assert_eq!(on_close(&now, Some(NORMAL)), Some(now.frame));
        let away = live((160.0, 30.0), (-32000.0, -32000.0), Mode::Normal, true);
        assert_eq!(normal_bounds(&away), None);
        assert_eq!(on_close(&away, Some(NORMAL)), Some(NORMAL));
        assert_eq!(on_close(&away, None), None);
    }

    #[test]
    fn a_maximized_window_whose_screen_is_gone_maximizes_on_the_main_one() {
        let kept = Kept {
            mode: Mode::Maximized,
            size: (1200.0, 800.0),
            position: Some((1800.0, 300.0)),
        };
        let opening = reopen(kept, &[LAPTOP], MIN);
        assert_eq!(opening.mode, Mode::Maximized);
        assert_eq!(opening.position, Some((120.0, 50.0)));
    }

    #[test]
    fn the_kept_frame_reads_back_as_written() {
        let kept = Kept {
            mode: Mode::Fullscreen,
            ..NORMAL
        };
        let json = serde_json::to_value(kept).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"size": [1000.0, 700.0], "position": [300.0, 100.0], "mode": "fullscreen"})
        );
        assert_eq!(serde_json::from_value::<Kept>(json).unwrap(), kept);
        // Wayland's, with no place.
        let sized: Kept = serde_json::from_str(r#"{"size":[800,600]}"#).unwrap();
        assert_eq!((sized.position, sized.mode), (None, Mode::Normal));
    }

    #[test]
    fn no_screens_known_leaves_it_as_it_was() {
        assert_eq!(
            place(Some((10.0, 20.0)), (900.0, 600.0), &[], MIN),
            (Some((10.0, 20.0)), (900.0, 600.0))
        );
    }
}
