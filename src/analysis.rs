use std::collections::BTreeSet;

use serde_json::{Value, json};

pub fn build_report(ir: &Value) -> Value {
    let mut scripts = Vec::new();
    let mut all_reads = BTreeSet::new();
    let mut all_writes = BTreeSet::new();

    if let Some(screens) = ir.get("screens").and_then(Value::as_array) {
        for screen in screens {
            collect_actor_scripts(
                screen.get("actors"),
                &mut scripts,
                &mut all_reads,
                &mut all_writes,
            );
        }
    } else {
        collect_actor_scripts(
            ir.get("actors"),
            &mut scripts,
            &mut all_reads,
            &mut all_writes,
        );
    }

    scripts.sort_by(|left, right| {
        json_string(left, "actor")
            .cmp(&json_string(right, "actor"))
            .then(json_string(left, "event").cmp(&json_string(right, "event")))
            .then(json_string(left, "id").cmp(&json_string(right, "id")))
    });

    let written_not_read = difference(&all_writes, &all_reads);
    let read_not_written = difference(&all_reads, &all_writes);

    json!({
        "format": "nekoc-analysis",
        "version": 1,
        "source": ir.get("source").cloned().unwrap_or(Value::Null),
        "summary": {
            "scripts": scripts.len(),
            "variables": {
                "reads": all_reads.into_iter().collect::<Vec<_>>(),
                "writes": all_writes.into_iter().collect::<Vec<_>>(),
                "written_not_read": written_not_read,
                "read_not_written": read_not_written,
            }
        },
        "scripts": scripts,
    })
}

fn collect_actor_scripts(
    actors: Option<&Value>,
    scripts: &mut Vec<Value>,
    all_reads: &mut BTreeSet<String>,
    all_writes: &mut BTreeSet<String>,
) {
    let Some(actors) = actors.and_then(Value::as_array) else {
        return;
    };

    for actor in actors {
        let actor_name = actor.get("name").cloned().unwrap_or(Value::Null);
        let actor_kind = actor.get("kind").cloned().unwrap_or(Value::Null);
        let Some(actor_scripts) = actor.get("scripts").and_then(Value::as_array) else {
            continue;
        };

        for script in actor_scripts {
            let reads = string_set(script.pointer("/data_flow/reads"));
            let writes = string_set(script.pointer("/data_flow/writes"));
            all_reads.extend(reads.iter().cloned());
            all_writes.extend(writes.iter().cloned());

            scripts.push(json!({
                "actor": actor_name,
                "actor_kind": actor_kind,
                "id": script.get("id").cloned().unwrap_or(Value::Null),
                "event": script.get("event").cloned().unwrap_or(Value::Null),
                "reads": reads.iter().cloned().collect::<Vec<_>>(),
                "writes": writes.iter().cloned().collect::<Vec<_>>(),
                "written_not_read": difference(&writes, &reads),
                "read_not_written": difference(&reads, &writes),
            }));
        }
    }
}

fn string_set(value: Option<&Value>) -> BTreeSet<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect()
}

fn difference(left: &BTreeSet<String>, right: &BTreeSet<String>) -> Vec<String> {
    left.difference(right).cloned().collect()
}

fn json_string<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}
