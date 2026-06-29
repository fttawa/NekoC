use crate::runtime::{RuntimeEvent, run_project, run_project_with_events, snapshot_to_json};
use anyhow::{Context, Result, bail};
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct RuntimeScenario {
    #[serde(default = "default_ticks")]
    pub ticks: usize,
    #[serde(default)]
    pub events: Vec<ScenarioEvent>,
    #[serde(default)]
    pub expect: serde_json::Map<String, Value>,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScenarioEvent {
    Click,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioDifference {
    pub path: String,
    pub expected: String,
    pub actual: String,
}

pub fn run_runtime_scenario(project: &Value, scenario: &RuntimeScenario) -> Result<Value> {
    let events = scenario
        .events
        .iter()
        .map(|event| match event {
            ScenarioEvent::Click => RuntimeEvent::Click,
        })
        .collect::<Vec<_>>();
    let snapshot = if events.is_empty() {
        run_project(project, scenario.ticks)?
    } else {
        run_project_with_events(project, &events, scenario.ticks)?
    };
    Ok(snapshot_to_json(&snapshot))
}

pub fn check_runtime_scenario(
    snapshot: &Value,
    scenario: &RuntimeScenario,
) -> Vec<ScenarioDifference> {
    scenario
        .expect
        .iter()
        .filter_map(|(path, expected)| {
            let actual = dotted_path(snapshot, path);
            match actual {
                Some(actual) if expected_value_matches(expected, actual) => None,
                Some(actual) => Some(ScenarioDifference {
                    path: path.clone(),
                    expected: format_json_value(expected),
                    actual: format_json_value(actual),
                }),
                None => Some(ScenarioDifference {
                    path: path.clone(),
                    expected: format_json_value(expected),
                    actual: "<missing>".to_owned(),
                }),
            }
        })
        .collect()
}

pub fn load_runtime_scenario(path: impl AsRef<std::path::Path>) -> Result<RuntimeScenario> {
    let path = path.as_ref();
    let bytes =
        std::fs::read(path).with_context(|| format!("failed to read {}", path.display()))?;
    let scenario: RuntimeScenario = serde_json::from_slice(&bytes)
        .with_context(|| format!("failed to parse {}", path.display()))?;
    Ok(scenario)
}

pub fn format_scenario_differences(differences: &[ScenarioDifference]) -> String {
    differences
        .iter()
        .map(|difference| {
            format!(
                "{}: expected {}, actual {}",
                difference.path, difference.expected, difference.actual
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn ensure_scenario_matches(differences: &[ScenarioDifference]) -> Result<()> {
    if differences.is_empty() {
        Ok(())
    } else {
        println!("{}", format_scenario_differences(differences));
        bail!("{} runtime scenario differences found", differences.len());
    }
}

fn default_ticks() -> usize {
    1
}

fn dotted_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.get(part)?;
    }
    Some(current)
}

fn expected_value_matches(expected: &Value, actual: &Value) -> bool {
    if let Some((target, epsilon)) = approx_expectation(expected) {
        return actual
            .as_f64()
            .is_some_and(|actual| (actual - target).abs() <= epsilon);
    }
    same_json_value(expected, actual)
}

fn approx_expectation(value: &Value) -> Option<(f64, f64)> {
    let object = value.as_object()?;
    let target = object.get("approx")?.as_f64()?;
    let epsilon = object
        .get("epsilon")
        .and_then(Value::as_f64)
        .unwrap_or(f64::EPSILON);
    Some((target, epsilon))
}

fn same_json_value(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => match (left.as_f64(), right.as_f64()) {
            (Some(left), Some(right)) => (left - right).abs() < f64::EPSILON,
            _ => left == right,
        },
        _ => left == right,
    }
}

fn format_json_value(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "<unprintable>".to_owned())
}
