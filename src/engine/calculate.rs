//! Safe evaluator for K4 calculate. Source: offline player_v2 modules f7Mu
//! (lexer), Ecnz (left-associative postfix), ZKJj/ZPYa (degree math/results).
//! No JavaScript execution, external parser, or HateNeko implementation.
use super::Cell;

#[derive(Clone, Debug)]
struct Token {
    name: String,
    kind: u8,
    precedence: u8,
}
fn token(name: &str, kind: u8) -> Token {
    Token {
        name: name.into(),
        kind,
        precedence: match kind {
            0 | 7 | 12 => 11,
            2 => 3,
            9 => 1,
            10 => 10,
            8 => 11,
            _ => 0,
        },
    }
}
const NAMES: &[(&str, u8)] = &[
    ("Sigma", 12),
    ("acosh", 0),
    ("atanh", 0),
    ("asinh", 0),
    ("asin", 0),
    ("acos", 0),
    ("atan", 0),
    ("cosh", 0),
    ("root", 0),
    ("tanh", 0),
    ("sinh", 0),
    ("sin", 0),
    ("cos", 0),
    ("tan", 0),
    ("int", 0),
    ("log", 0),
    ("Mod", 2),
    ("pow", 8),
    ("pi", 3),
    ("ln", 0),
    ("Pi", 12),
    ("P", 10),
    ("C", 10),
    ("e", 3),
    ("n", 13),
    ("(", 4),
    (")", 5),
    ("^", 10),
    ("/", 2),
    ("!", 7),
    ("*", 2),
    (".", 6),
    ("+", 9),
    ("-", 9),
    (",", 11),
];
fn adjust(counters: &mut [i32], n: i32) {
    for c in counters {
        *c += n;
    }
}
fn lex(input: &str) -> Result<Vec<Token>, ()> {
    // Spaces are ignored even inside numbers, but tabs/newlines are not.
    let mut out = vec![token("(", 4)];
    let mut counters = Vec::new();
    let (mut expected, mut implicit) = (true, 0u8);
    let (mut parens, mut suspended) = (0usize, 0usize);
    let mut at = 0;
    while at < input.len() {
        if out.len() > 512 {
            return Err(());
        }
        let rest = &input[at..];
        if rest.starts_with(' ') {
            at += 1;
            continue;
        }
        let digit = rest.as_bytes()[0].is_ascii_digit();
        let (name, mut kind) = if digit {
            (&rest[..1], 1)
        } else {
            *NAMES.iter().find(|(s, _)| rest.starts_with(s)).ok_or(())?
        };
        for _ in 0..counters.len() {
            if counters.last() != Some(&0) || !matches!(kind, 0 | 2 | 3 | 5 | 9 | 11 | 12 | 13) {
                break;
            }
            if expected {
                return Err(());
            }
            out.push(token(")", 5));
            implicit = 2;
            adjust(&mut counters, -1);
            counters.pop();
        }
        if expected && !matches!(kind, 0 | 1 | 3 | 4 | 6 | 8 | 9 | 12 | 13) {
            return Err(());
        }
        let multiply = match implicit {
            1 => matches!(kind, 0 | 3 | 4 | 8 | 12 | 13),
            2 => matches!(kind, 0 | 1 | 3 | 4 | 6 | 8 | 12 | 13),
            _ => false,
        };
        let mut t = token(name, kind);
        if multiply {
            kind = 2;
            t = token("*", 2);
        } else {
            at += name.len();
        }
        match kind {
            0 => {
                expected = true;
                implicit = 0;
                adjust(&mut counters, 2);
                counters.push(2);
                out.push(t);
                out.push(token("(", 4));
            }
            1 => {
                if out.last().is_some_and(|t| t.kind == 1) {
                    out.last_mut().unwrap().name.push_str(name);
                    adjust(&mut counters, 1);
                } else {
                    out.push(t);
                }
                expected = false;
                implicit = 1;
            }
            2 => {
                expected = true;
                implicit = 0;
                adjust(&mut counters, 2);
                out.push(t);
            }
            3 | 13 => {
                out.push(t);
                expected = false;
                implicit = 2;
            }
            4 => {
                suspended += counters.len();
                counters.clear();
                parens += 1;
                expected = true;
                implicit = 0;
                out.push(t);
            }
            5 => {
                if parens == 0 {
                    return Err(());
                }
                for _ in 0..suspended {
                    out.push(token(")", 5));
                }
                suspended = 0;
                parens -= 1;
                expected = false;
                implicit = 2;
                out.push(t);
            }
            6 => {
                if out.last().is_none_or(|t| t.kind != 1) {
                    out.push(token("0", 1));
                    adjust(&mut counters, -1);
                }
                let n = out.last_mut().unwrap();
                if n.name.contains('.') {
                    return Err(());
                }
                n.name.push('.');
                expected = true;
                implicit = 0;
                adjust(&mut counters, 1);
            }
            7 => {
                out.push(t);
                expected = false;
                implicit = 2;
                adjust(&mut counters, 1);
            }
            8 | 12 => {
                expected = true;
                implicit = 0;
                let n = if kind == 8 { 4 } else { 6 };
                adjust(&mut counters, n);
                counters.push(n);
                out.push(t);
                out.push(token("(", 4));
            }
            9 => {
                let last = out.last_mut().ok_or(())?;
                if last.kind == 9 {
                    if last.name == "+" {
                        last.name = name.into();
                        adjust(&mut counters, 1);
                    } else if name == "-" {
                        last.name = "+".into();
                        adjust(&mut counters, 1);
                    }
                } else if !matches!(last.kind, 5 | 7 | 1 | 3 | 13) {
                    if name == "-" {
                        adjust(&mut counters, 2);
                        counters.push(2);
                        let mut neg = token("neg", 0);
                        neg.precedence = 21;
                        out.push(neg);
                        out.push(token("(", 4));
                    }
                } else {
                    out.push(t);
                    adjust(&mut counters, 2);
                }
                expected = true;
                implicit = 0;
            }
            10 => {
                expected = true;
                implicit = 0;
                adjust(&mut counters, 2);
                out.push(t);
            }
            11 => {
                expected = true;
                implicit = 0;
                out.push(t);
            }
            _ => return Err(()),
        }
        adjust(&mut counters, -1);
    }
    while counters.last() == Some(&0) {
        out.push(token(")", 5));
        adjust(&mut counters, -1);
        counters.pop();
    }
    if expected {
        return Err(());
    }
    for _ in 0..parens {
        out.push(token(")", 5));
    }
    out.push(token(")", 5));
    Ok(out)
}

#[derive(Clone)]
enum Expr {
    Number(f64),
    N,
    Apply(String, Vec<Expr>),
}
fn factorial(x: f64) -> Result<f64, ()> {
    if x.fract() != 0.0 {
        return Err(());
    }
    if x > 170.0 {
        return Ok(f64::INFINITY);
    }
    Ok((2..=x as i32).map(f64::from).product())
}
impl Expr {
    fn symbolic(&self) -> bool {
        match self {
            Self::N => true,
            Self::Apply(_, args) => args.iter().any(Self::symbolic),
            _ => false,
        }
    }
    fn eval(&self, n: Option<f64>, budget: &mut usize) -> Result<f64, ()> {
        *budget = budget.checked_sub(1).ok_or(())?;
        let (name, args) = match self {
            Self::Number(n) => return Ok(*n),
            Self::N => return n.ok_or(()),
            Self::Apply(s, a) => (s.as_str(), a),
        };
        let a = args[0].eval(n, budget)?;
        if matches!(name, "Sigma" | "Pi") {
            let b = args[1].eval(n, budget)?;
            if !a.is_finite() || !b.is_finite() {
                return Err(());
            }
            let mut result = if name == "Pi" { 1.0 } else { 0.0 };
            let mut i = a;
            while i <= b {
                let v = args[2].eval(Some(i), budget)?;
                result = if name == "Pi" { result * v } else { result + v };
                i += 1.0;
            }
            return Ok(result);
        }
        if args.len() == 2 {
            let b = args[1].eval(n, budget)?;
            return Ok(match name {
                "+" => a + b,
                "-" => a - b,
                "*" => a * b,
                "/" => a / b,
                "Mod" => a % b,
                "^" | "pow" => a.powf(b),
                "P" => {
                    let count = b.floor().max(0.0);
                    if count > 10000.0 {
                        return Err(());
                    }
                    (0..count as usize).map(|i| a.floor() - i as f64).product()
                }
                "C" => {
                    let (large, small) = (b.max(a - b), b.min(a - b));
                    if a - large > 10000.0 {
                        return Err(());
                    }
                    let mut v = 1.0;
                    let mut i = large + 1.0;
                    while i <= a {
                        *budget = budget.checked_sub(1).ok_or(())?;
                        v *= i;
                        i += 1.0;
                    }
                    v / factorial(small)?
                }
                _ => return Err(()),
            });
        }
        Ok(match name {
            "neg" => -a,
            "sin" => a.to_radians().sin(),
            "cos" => a.to_radians().cos(),
            "tan" => a.to_radians().tan(),
            "asin" => a.asin().to_degrees(),
            "acos" => a.acos().to_degrees(),
            "atan" => a.atan().to_degrees(),
            "int" => a.floor(),
            "root" => a.sqrt(),
            "ln" => a.ln(),
            "log" => a.ln() / 10f64.ln(),
            "sinh" => (a.exp() - (-a).exp()) / 2.0,
            "cosh" => (a.exp() + (-a).exp()) / 2.0,
            "asinh" => (a + (a * a + 1.0).sqrt()).ln(),
            "acosh" => (a + (a * a - 1.0).sqrt()).ln(),
            "atanh" => ((1.0 + a) / (1.0 - a)).ln() / 2.0,
            "!" => factorial(a)?,
            // ZKJj calls nonexistent sinha/cosha: do not silently fix the oracle.
            _ => return Err(()),
        })
    }
}
pub(super) fn evaluate(input: &str) -> Result<Cell, ()> {
    if input.len() > 65536 {
        return Err(());
    }
    let tokens = lex(input)?;
    // Keep recursive evaluation and destruction bounded for untrusted text.
    if tokens.len() > 512 {
        return Err(());
    }
    let mut operators = Vec::<Token>::new();
    let mut postfix = Vec::new();
    for t in tokens {
        match t.kind {
            1 | 3 | 13 => postfix.push(t),
            4 => operators.push(t),
            5 | 11 => {
                while operators.last().is_some_and(|o| o.kind != 4) {
                    postfix.push(operators.pop().unwrap());
                }
                if operators.is_empty() {
                    return Err(());
                }
                if t.kind == 5 {
                    operators.pop();
                }
            }
            _ => {
                while operators
                    .last()
                    .is_some_and(|o| o.kind != 4 && o.precedence >= t.precedence)
                {
                    postfix.push(operators.pop().unwrap());
                }
                operators.push(t);
            }
        }
    }
    if !operators.is_empty() {
        return Err(());
    }
    let mut stack = Vec::new();
    for t in postfix {
        match t.kind {
            1 => stack.push(Expr::Number(t.name.parse().map_err(|_| ())?)),
            3 => stack.push(Expr::Number(if t.name == "pi" {
                std::f64::consts::PI
            } else {
                std::f64::consts::E
            })),
            13 => stack.push(Expr::N),
            _ => {
                let count = if t.kind == 12 {
                    3
                } else if matches!(t.kind, 2 | 8 | 9 | 10) {
                    2
                } else {
                    1
                };
                if stack.len() < count {
                    return Err(());
                }
                let mut args = stack.split_off(stack.len() - count);
                // ZPYa's type-10 symbolic-left branch calls n.concat(e)
                // instead of n.value.concat(e): the nested array's value is
                // missing, so postfixEval ultimately returns the left value.
                if t.kind == 10 && args[0].symbolic() {
                    stack.push(args.remove(0));
                } else if matches!(t.kind, 0 | 7) && args[0].symbolic() {
                    return Err(());
                } else {
                    stack.push(Expr::Apply(t.name, args));
                }
            }
        }
    }
    if stack.len() != 1 {
        return Err(());
    }
    let result = stack.pop().unwrap().eval(None, &mut 100000)?;
    Ok(if result > 1e15 {
        Cell::Text("Infinity".into())
    } else {
        Cell::Number(if result.is_finite() {
            format!("{result:.15}").parse().map_err(|_| ())?
        } else {
            result
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn offline_mathlex_observations() {
        for (s, n) in [
            ("2^3^2", 64.0),
            ("-2^2", -4.0),
            ("sin30", 0.5),
            ("cos(60)", 0.5),
            ("2(3+4)", 14.0),
            ("(1+2", 3.0),
            ("2 3", 23.0),
            ("pow(2,3)", 8.0),
            ("Sigma(1,3,n^2)", 6.0),
            ("sin2^2", 4f64.to_radians().sin()),
            ("1--2", 3.0),
        ] {
            let Cell::Number(actual) = evaluate(s).unwrap() else {
                panic!("{s}")
            };
            assert!((actual - n).abs() < 1e-14, "{s}: {actual} != {n}");
        }
        assert!(matches!(evaluate("1/0").unwrap(),Cell::Text(s) if s.as_ref()=="Infinity"));
        for s in ["", "tanh(1)", "1.5!", "n", "1+", "alert(1)", "1\t2"] {
            assert!(evaluate(s).is_err(), "{s}");
        }
    }
}
