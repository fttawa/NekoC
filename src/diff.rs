use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Difference {
    pub path: String,
    pub kind: DifferenceKind,
    pub left: Option<String>,
    pub right: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DifferenceKind {
    Added,
    Removed,
    Changed,
}

pub fn diff_values(left: &Value, right: &Value, limit: usize) -> Vec<Difference> {
    let mut differences = Vec::new();
    diff_at("$", Some(left), Some(right), limit, &mut differences);
    differences
}

pub fn format_differences(differences: &[Difference]) -> String {
    differences
        .iter()
        .map(|difference| match difference.kind {
            DifferenceKind::Added => format!(
                "{} added right={}",
                difference.path,
                difference.right.as_deref().unwrap_or("<missing>")
            ),
            DifferenceKind::Removed => format!(
                "{} removed left={}",
                difference.path,
                difference.left.as_deref().unwrap_or("<missing>")
            ),
            DifferenceKind::Changed => format!(
                "{} changed left={} right={}",
                difference.path,
                difference.left.as_deref().unwrap_or("<missing>"),
                difference.right.as_deref().unwrap_or("<missing>")
            ),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn diff_at(
    path: &str,
    left: Option<&Value>,
    right: Option<&Value>,
    limit: usize,
    differences: &mut Vec<Difference>,
) {
    if differences.len() >= limit {
        return;
    }

    match (left, right) {
        (Some(Value::Object(left_map)), Some(Value::Object(right_map))) => {
            for (key, left_value) in left_map {
                let child_path = object_path(path, key);
                diff_at(
                    &child_path,
                    Some(left_value),
                    right_map.get(key),
                    limit,
                    differences,
                );
                if differences.len() >= limit {
                    return;
                }
            }
            for (key, right_value) in right_map {
                if !left_map.contains_key(key) {
                    let child_path = object_path(path, key);
                    diff_at(&child_path, None, Some(right_value), limit, differences);
                    if differences.len() >= limit {
                        return;
                    }
                }
            }
        }
        (Some(Value::Array(left_items)), Some(Value::Array(right_items))) => {
            let max_len = left_items.len().max(right_items.len());
            for index in 0..max_len {
                let child_path = format!("{path}[{index}]");
                diff_at(
                    &child_path,
                    left_items.get(index),
                    right_items.get(index),
                    limit,
                    differences,
                );
                if differences.len() >= limit {
                    return;
                }
            }
        }
        (Some(left_value), Some(right_value)) if values_equal(left_value, right_value) => {}
        (Some(left_value), Some(right_value)) => differences.push(Difference {
            path: path.to_owned(),
            kind: DifferenceKind::Changed,
            left: Some(summarize_value(left_value)),
            right: Some(summarize_value(right_value)),
        }),
        (Some(left_value), None) => differences.push(Difference {
            path: path.to_owned(),
            kind: DifferenceKind::Removed,
            left: Some(summarize_value(left_value)),
            right: None,
        }),
        (None, Some(right_value)) => differences.push(Difference {
            path: path.to_owned(),
            kind: DifferenceKind::Added,
            left: None,
            right: Some(summarize_value(right_value)),
        }),
        (None, None) => {}
    }
}

fn values_equal(left: &Value, right: &Value) -> bool {
    if left == right {
        return true;
    }

    match (left.as_f64(), right.as_f64()) {
        (Some(left), Some(right)) => (left - right).abs() <= f64::EPSILON,
        _ => false,
    }
}

fn object_path(parent: &str, key: &str) -> String {
    if key
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        format!("{parent}.{key}")
    } else {
        format!("{parent}[{}]", serde_json::to_string(key).unwrap())
    }
}

fn summarize_value(value: &Value) -> String {
    let raw = serde_json::to_string(value).unwrap_or_else(|_| "<unprintable>".to_owned());
    const MAX_LEN: usize = 120;
    if raw.len() > MAX_LEN {
        format!("{}...", &raw[..MAX_LEN])
    } else {
        raw
    }
}
