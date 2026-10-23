//! Where an editor window opens (#356): where the last one closed, when
//! that is still on a screen; else centred on the main screen. Either way
//! no bigger than the screen it opens on - a size kept from a larger
//! display opened a window running off the edge.

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

/// The window's position and size (logical px). `saved` is the last
/// window's position, if any; `size` its size; the first screen is the
/// main one; `min` the window's least size.
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

    #[test]
    fn no_screens_known_leaves_it_as_it_was() {
        assert_eq!(
            place(Some((10.0, 20.0)), (900.0, 600.0), &[], MIN),
            (Some((10.0, 20.0)), (900.0, 600.0))
        );
    }
}
