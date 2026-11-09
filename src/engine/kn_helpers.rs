//! Code-view scalar helpers. No object/JSON model is introduced here.
//! 参考 HateNeko 0.7.1 的 rt/impl/js.lua::parseInt/parseFloat/b64_encode/b64_decode。
//! Browser Base64 uses Latin-1, not UTF-8; invalid input returns an empty string.
const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn trim_js_start(text: &str) -> &str {
    text.trim_start_matches(|c| {
        matches!(c,
            '\u{0009}'..='\u{000d}' | ' ' | '\u{00a0}' | '\u{1680}' |
            '\u{2000}'..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' |
            '\u{205f}' | '\u{3000}' | '\u{feff}'
        )
    })
}

pub(super) fn encode64(text: &str) -> String {
    let Some(bytes) = text
        .chars()
        .map(|c| u8::try_from(c as u32).ok())
        .collect::<Option<Vec<_>>>()
    else {
        return String::new();
    };
    let mut out = String::new();
    for chunk in bytes.chunks(3) {
        let n = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        for shift in [18, 12] {
            out.push(B64[((n >> shift) & 63) as usize] as char);
        }
        out.push(if chunk.len() > 1 {
            B64[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            B64[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

pub(super) fn decode64(text: &str) -> String {
    let mut bytes = text
        .bytes()
        .filter(|b| !matches!(b, b' ' | b'\t' | b'\n' | b'\r' | 12))
        .collect::<Vec<_>>();
    if bytes.len().is_multiple_of(4) {
        for _ in 0..2 {
            if bytes.last() == Some(&b'=') {
                bytes.pop();
            }
        }
    }
    if bytes.len() % 4 == 1 {
        return String::new();
    }
    let mut out = String::new();
    let (mut acc, mut bits) = (0u32, 0);
    for byte in bytes {
        let Some(value) = B64.iter().position(|b| *b == byte) else {
            return String::new();
        };
        acc = (acc << 6) | value as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(char::from(((acc >> bits) & 255) as u8));
            acc &= (1 << bits) - 1;
        }
    }
    out
}

pub(super) fn parse_int(text: &str, radix: f64) -> f64 {
    let text = trim_js_start(text);
    let (sign, mut text) = if let Some(s) = text.strip_prefix('-') {
        (-1.0, s)
    } else {
        (1.0, text.strip_prefix('+').unwrap_or(text))
    };
    // ECMAScript ToInt32 before radix validation.
    let radix = if radix.is_finite() {
        radix.trunc().rem_euclid(4294967296.0) as u32 as i32
    } else {
        0
    };
    let mut radix = radix;
    if (radix == 0 || radix == 16) && (text.starts_with("0x") || text.starts_with("0X")) {
        radix = 16;
        text = &text[2..];
    }
    if radix == 0 {
        radix = 10;
    }
    if !(2..=36).contains(&radix) {
        return f64::NAN;
    }
    let mut digits = text.chars().map_while(|c| c.to_digit(radix as u32));
    let Some(first) = digits.next() else {
        return f64::NAN;
    };
    sign * digits.fold(first as f64, |n, d| n * radix as f64 + d as f64)
}

pub(super) fn parse_float(text: &str) -> f64 {
    static PREFIX: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let prefix = PREFIX.get_or_init(|| {
        regex::Regex::new(r"\A[+-]?(?:Infinity|(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)")
            .expect("constant float prefix")
    });
    prefix
        .find(trim_js_start(text))
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(f64::NAN)
}
