//! ECMAScript Number/String conversions shared by both interpreters.

pub(crate) fn text(value: f64) -> String {
    ryu_js::Buffer::new().format(value).to_owned()
}

pub(crate) fn parse(value: &str) -> f64 {
    // ECMAScript WhiteSpace + LineTerminator, not Rust's broader Unicode
    // whitespace set (which also accepts U+0085).
    let value = value.trim_matches(|c: char| {
        matches!(c, '\u{0009}'..='\u{000d}' | '\u{0020}' | '\u{00a0}' | '\u{1680}'
            | '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}'
            | '\u{205f}' | '\u{3000}' | '\u{feff}')
    });
    if value.is_empty() {
        return 0.0;
    }
    match value {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefixes, radix) in [(["0x", "0X"], 16), (["0o", "0O"], 8), (["0b", "0B"], 2)] {
        if let Some(digits) = prefixes.iter().find_map(|p| value.strip_prefix(p)) {
            // Number accepts arbitrarily long unsigned radix literals.
            if digits.is_empty() {
                return f64::NAN;
            }
            // All supported radices are powers of two. Keep the top 53 bits,
            // then round once (ties to even), rather than rounding every digit.
            let mut significant = 0u64;
            let mut bits = 0usize;
            let mut guard = false;
            let mut sticky = false;
            for c in digits.chars() {
                let Some(digit) = c.to_digit(radix) else {
                    return f64::NAN;
                };
                for bit in (0..radix.trailing_zeros()).rev() {
                    let one = (digit >> bit) & 1 != 0;
                    if bits == 0 && !one {
                        continue;
                    }
                    bits = bits.saturating_add(1);
                    if bits <= 53 {
                        significant = (significant << 1) | u64::from(one);
                    } else if bits == 54 {
                        guard = one;
                    } else {
                        sticky |= one;
                    }
                }
            }
            if bits <= 53 {
                return significant as f64;
            }
            if guard && (sticky || significant & 1 != 0) {
                significant += 1;
            }
            return if bits > 1024 {
                f64::INFINITY
            } else {
                significant as f64 * 2.0f64.powi((bits - 53) as i32)
            };
        }
    }
    // Rust accepts spellings such as `inf` that JavaScript Number rejects.
    static DECIMAL: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let decimal = DECIMAL.get_or_init(|| {
        regex::Regex::new(r"\A[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?\z")
            .expect("constant JS decimal pattern")
    });
    if decimal.is_match(value) {
        value.parse().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_number_strings() {
        for (n, expected) in [
            (-0.0, "0"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
            (f64::NEG_INFINITY, "-Infinity"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1e-6, "0.000001"),
            (1e-7, "1e-7"),
            (1000000000000000100.0, "1000000000000000100"),
        ] {
            assert_eq!(text(n), expected);
        }
    }

    #[test]
    fn javascript_number_parsing() {
        for (s, expected) in [
            ("", 0.0),
            ("\u{feff} 2 ", 2.0),
            ("0x10", 16.0),
            ("0b11", 3.0),
            ("1e999", f64::INFINITY),
            ("-Infinity", f64::NEG_INFINITY),
            ("0x20000000000001", 9007199254740992.0),
            ("0x20000000000003", 9007199254740996.0),
            ("0x2000000000000101", 2305843009213694464.0),
        ] {
            assert_eq!(parse(s), expected);
        }
        for s in [
            "inf",
            "infinity",
            "+0x10",
            "not-a-number",
            "0x",
            "NaN",
            "\u{0085}2",
        ] {
            assert!(parse(s).is_nan(), "{s}");
        }
        assert!(parse("-0").is_sign_negative());
    }
}
