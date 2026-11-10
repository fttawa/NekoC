//! K4 timer version policy and decimal display rounding. Official locations and
//! recorded virtual-clock probes: docs/kitten4-fixes.md (not a KN timer change).

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum K4Timer {
    /// Before 4.1.1: milliseconds since run(); widget blocks do not affect it.
    RunClock,
    /// Since 4.1.1: stage widget, idle until started; get_time() uses toFixed(2).
    Widget,
}

/// Official Tn6a/s compares raw equality before Number() per segment. Preserve
/// its noncanonical-version behavior too (e.g. 4.1.01 is older than 4.1.1).
pub(super) fn timer_policy(version: Option<&str>) -> K4Timer {
    let Some(version) = version.filter(|v| !v.is_empty() && *v != "4.1.1") else {
        return K4Timer::Widget;
    };
    let parts: Vec<_> = version.split('.').collect();
    if parts.len() != 3 {
        return K4Timer::Widget;
    }
    for (part, boundary) in parts.iter().zip([4.0, 1.0, 1.0]) {
        let number = crate::js_number::parse(part);
        if number > boundary {
            return K4Timer::Widget;
        }
        if number < boundary {
            return K4Timer::RunClock;
        }
    }
    K4Timer::RunClock
}

/// JS toFixed(2) for the nonnegative elapsed-time value. Rust's decimal formatter
/// rounds the exact binary value correctly except that exact ties round to even.
/// A binary fraction can be exactly halfway between hundredths only at odd / 8;
/// checking that first avoids mistaking 1.005 * 100's rounded product for a tie.
pub(super) fn to_fixed2(value: f64) -> f64 {
    let scaled = value * 100.0;
    if value >= 0.0 && (value * 8.0).fract() == 0.0 && scaled.fract() == 0.5 {
        return scaled.ceil() / 100.0;
    }
    format!("{value:.2}").parse().unwrap_or(value)
}

#[cfg(test)]
mod tests {
    use super::{K4Timer, timer_policy, to_fixed2};

    #[test]
    fn official_raw_version_equality_precedes_numeric_segments() {
        for version in [None, Some(""), Some("4.1.1"), Some("4.11.19"), Some("4.1")] {
            assert_eq!(timer_policy(version), K4Timer::Widget);
        }
        for version in ["4.1.0", "4.1.01", "04.1.1", "4.0.foo", "3.x.x"] {
            assert_eq!(timer_policy(Some(version)), K4Timer::RunClock, "{version}");
        }
    }

    #[test]
    fn js_decimal_rounding_preserves_binary_near_ties() {
        // Number(value.toFixed(2)), also checked by tests/k4-fix.test.mjs.
        for (input, expected) in [
            (0.0, 0.0),
            (0.125, 0.13),
            (1.125, 1.13),
            (1.005, 1.0),
            (2.675, 2.67),
            (0.145, 0.14),
            (0.285, 0.28),
            (0.033, 0.03),
            (0.066, 0.07),
        ] {
            assert_eq!(to_fixed2(input), expected, "{input}");
        }
    }
}
