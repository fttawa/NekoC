//! Native KN fixture runner; no K4 importer and no legacy reference interpreter.
use anyhow::{Context, Result, ensure};
use nekoc::engine::{Cell, Engine, Program};
use serde_json::{Value, json};
use std::{collections::BTreeMap, time::Duration};

fn encode(value: &Cell) -> Value {
    match value {
        Cell::Number(n) if !n.is_finite() => {
            json!({"$number": if n.is_nan() { "NaN" } else if *n > 0.0 { "Infinity" } else { "-Infinity" }})
        }
        Cell::List(items) => Value::Array(items.borrow().iter().map(encode).collect()),
        Cell::Object(props) => Value::Object(
            props
                .borrow()
                .iter()
                .map(|(k, v)| (k.clone(), encode(v)))
                .collect(),
        ),
        Cell::Undefined => json!({"$undefined":true}),
        _ => serde_json::to_value(value).expect("scalar serialization"),
    }
}

fn main() -> Result<()> {
    let input = std::env::args()
        .nth(1)
        .context("Usage: kn-trace <native.bcmkn>")?;
    let source = std::fs::read_to_string(input)?;
    let project: Value = serde_json::from_str(&source)?;
    ensure!(project["toolType"] == "KN", "expected a native KN project");
    let mut engine = Engine::new(Program::compile(&project)?);
    engine.use_virtual_clock();
    engine.start();
    for _ in 0..180 {
        // A single KN warp slice can complete 30002 iterations per script;
        // multiple scripts must fit without mistaking a trace safety budget
        // for the runtime's semantic iteration yield.
        let update = engine.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(1))?;
        ensure!(!update.budget_yield, "fixture exceeded execution budget");
    }
    let variables: BTreeMap<_, _> = project["variables"]["variablesDict"]
        .as_object()
        .context("missing variablesDict")?
        .iter()
        .map(|(id, variable)| {
            let value = if variable["isGlobal"].as_bool() == Some(false) {
                engine.entity_variable_value(variable["currentEntityId"].as_str().unwrap_or(""), id)
            } else {
                engine.variable_value(id)
            };
            (id.clone(), encode(&value))
        })
        .collect();
    println!("{}", json!({"variables":variables}));
    Ok(())
}
