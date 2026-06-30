use crate::runtime::{
    RuntimeEvent, RuntimeStep, run_project, run_project_steps, run_project_with_events,
    snapshot_to_json,
};
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
    pub steps: Vec<ScenarioStep>,
    #[serde(default)]
    pub expect: serde_json::Map<String, Value>,
    #[serde(default)]
    pub expect_trace: Vec<serde_json::Map<String, Value>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ScenarioEvent {
    Named(ScenarioNamedEvent),
    Click {
        kind: ScenarioClickEvent,
        x: Option<f64>,
        y: Option<f64>,
    },
    Key {
        kind: ScenarioKeyEvent,
        key: String,
    },
    Mouse {
        kind: ScenarioMouseEvent,
        x: Option<f64>,
        y: Option<f64>,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum ScenarioStep {
    Run { run: usize },
    Event { event: ScenarioEvent },
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScenarioNamedEvent {
    Click,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScenarioClickEvent {
    Click,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScenarioKeyEvent {
    KeyDown,
    KeyUp,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScenarioMouseEvent {
    MouseDown,
    MouseUp,
    MouseMove,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScenarioDifference {
    pub path: String,
    pub expected: String,
    pub actual: String,
}

pub fn run_runtime_scenario(project: &Value, scenario: &RuntimeScenario) -> Result<Value> {
    if !scenario.steps.is_empty() {
        let steps = scenario
            .steps
            .iter()
            .map(|step| match step {
                ScenarioStep::Run { run } => RuntimeStep::Run(*run),
                ScenarioStep::Event { event } => RuntimeStep::Event(runtime_event(event)),
            })
            .collect::<Vec<_>>();
        return Ok(snapshot_to_json(&run_project_steps(project, &steps)?));
    }

    let events = scenario
        .events
        .iter()
        .map(runtime_event)
        .collect::<Vec<_>>();
    let snapshot = if events.is_empty() {
        run_project(project, scenario.ticks)?
    } else {
        run_project_with_events(project, &events, scenario.ticks)?
    };
    Ok(snapshot_to_json(&snapshot))
}

fn runtime_event(event: &ScenarioEvent) -> RuntimeEvent {
    match event {
        ScenarioEvent::Named(ScenarioNamedEvent::Click) => RuntimeEvent::Click { x: None, y: None },
        ScenarioEvent::Click {
            kind: ScenarioClickEvent::Click,
            x,
            y,
        } => RuntimeEvent::Click { x: *x, y: *y },
        ScenarioEvent::Key { kind, key } => RuntimeEvent::Key {
            key: key.clone(),
            state: match kind {
                ScenarioKeyEvent::KeyDown => "down",
                ScenarioKeyEvent::KeyUp => "up",
            }
            .to_owned(),
        },
        ScenarioEvent::Mouse { kind, x, y } => RuntimeEvent::Mouse {
            state: match kind {
                ScenarioMouseEvent::MouseDown => Some("down".to_owned()),
                ScenarioMouseEvent::MouseUp => Some("up".to_owned()),
                ScenarioMouseEvent::MouseMove => None,
            },
            x: *x,
            y: *y,
        },
    }
}

pub fn check_runtime_scenario(
    snapshot: &Value,
    scenario: &RuntimeScenario,
) -> Vec<ScenarioDifference> {
    let mut differences = scenario
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
        .collect::<Vec<_>>();
    differences.extend(check_trace_expectations(snapshot, scenario));
    differences
}

fn check_trace_expectations(
    snapshot: &Value,
    scenario: &RuntimeScenario,
) -> Vec<ScenarioDifference> {
    let trace = snapshot
        .get("trace")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    let mut differences = Vec::new();
    let mut cursor = 0;
    for (index, expected) in scenario.expect_trace.iter().enumerate() {
        let Some(found_at) =
            trace
                .iter()
                .enumerate()
                .skip(cursor)
                .find_map(|(trace_index, entry)| {
                    trace_entry_matches(expected, entry).then_some(trace_index)
                })
        else {
            differences.push(ScenarioDifference {
                path: format!("expect_trace[{index}]"),
                expected: format_json_value(&Value::Object(expected.clone())),
                actual: "<missing matching trace entry>".to_owned(),
            });
            break;
        };
        cursor = found_at + 1;
    }
    differences
}

fn trace_entry_matches(expected: &serde_json::Map<String, Value>, entry: &Value) -> bool {
    let Some(entry) = entry.as_object() else {
        return false;
    };
    expected.iter().all(|(key, expected)| {
        entry
            .get(key)
            .is_some_and(|actual| expected_value_matches(expected, actual))
    })
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
