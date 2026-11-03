use nekoc::{
    engine::{Cell, Engine, Program},
    pack::{PackOptions, decode, encode, pack, unpack},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

/// Frames of a fake animation: similar neighbours, digits with leading zeros,
/// unit separators, an emoji (surrogate pair) and an empty item.
fn frames() -> Vec<String> {
    (0..300)
        .map(|i| {
            if i == 150 {
                return String::new();
            }
            let cells: Vec<String> = (0..40)
                .map(|j| format!("{:03}\u{1f}━\u{200a}{}🐱", (i / 7 + j) % 50, j % 3))
                .collect();
            format!("007|{}", cells.join("\u{1f}"))
        })
        .collect()
}
fn project(items: &[String]) -> Value {
    let mut p = Document::blank().value().clone();
    p["variables"]["variablesDict"]["kn-list-frames"] = json!({"id":"kn-list-frames","name":"frames",
        "type":"list","isGlobal":true,"value":items,"visible":false});
    p["variables"]["variablesDict"]["kn-var-first"] =
        json!({"id":"kn-var-first","name":"first","type":"any","isGlobal":true,"value":0});
    // The project's own start script reads the list immediately.
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([{
        "id":"start","type":"on_running_group_activated","next":{"id":"s1","type":"variables_set",
        "parent_id":"start","fields":{"variable":"kn-var-first"},"inputs":{"value":{"id":"s2","type":"list_item",
        "parent_id":"s1","is_output":true,"fields":{"item":"any"},"inputs":{
            "list":{"id":"s3","type":"pure_list_get","parent_id":"s2","is_output":true,"is_shadow":true,"fields":{"list":"kn-list-frames"}},
            "list_index":{"id":"s4","type":"math_number","parent_id":"s2","is_output":true,"fields":{"NUM":"2"}}}}}}}]);
    p
}

#[test]
fn encoding_round_trips_and_compresses_similar_items() {
    let items = frames();
    let (records, tokens) = encode(&items, '^', 8, 12);
    assert_eq!(decode(&records, '^').unwrap(), items);
    let (a, b) = (
        json!(items).to_string().len(),
        json!(records).to_string().len(),
    );
    assert!(b * 4 < a, "{a} -> {b}");
    assert!(tokens < items.len() * 20);
}

#[test]
fn packed_project_restores_lists_in_the_block_runtime_before_start_scripts() {
    let items = frames();
    let original = project(&items);
    let (packed, report) = pack(
        &original,
        &PackOptions {
            min_list_bytes: 1024,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(report.lists.len(), 1);
    assert_eq!(report.gated_scripts, 1);
    assert!(report.packed_bytes * 3 < report.original_bytes);
    assert_eq!(
        packed["variables"]["variablesDict"]["kn-list-frames"]["value"],
        json!([])
    );

    // The block decoder itself (compile_exact skips the native unpack).
    let mut vm = Engine::new(Program::compile_exact(&packed).unwrap());
    vm.start();
    let mut frames_run = 0;
    while vm.variable_text("nekoc-pack-zready") != "1" {
        vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
            .unwrap();
        frames_run += 1;
        assert!(frames_run < 600, "decoder did not finish");
    }
    // One more frame lets the gated start script run.
    vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
        .unwrap();
    let list = vm
        .program
        .list_names
        .iter()
        .position(|n| n == "kn-list-frames")
        .unwrap();
    let restored: Vec<String> = vm.list_values(list).iter().map(Cell::text).collect();
    assert_eq!(restored, items);
    assert_eq!(vm.variable_text("kn-var-first"), items[1]);

    assert_eq!(unpack(&packed).unwrap(), original);

    // The regular compile path unpacks natively: data is there on frame one.
    let mut vm = Engine::new(Program::compile(&packed).unwrap());
    vm.start();
    vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
        .unwrap();
    assert_eq!(vm.variable_text("kn-var-first"), items[1]);
}

#[test]
fn small_numeric_or_already_packed_projects_are_left_alone() {
    let mut p = project(&frames());
    p["variables"]["variablesDict"]["kn-list-frames"]["value"] =
        json!((0..5000).collect::<Vec<_>>());
    let (out, report) = pack(
        &p,
        &PackOptions {
            min_list_bytes: 1024,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(report.lists.is_empty());
    assert_eq!(report.skipped[0].1, "items are not all text");
    assert_eq!(out, p);
    let (packed, _) = pack(
        &project(&frames()),
        &PackOptions {
            min_list_bytes: 1024,
            ..Default::default()
        },
    )
    .unwrap();
    assert!(pack(&packed, &PackOptions::default()).is_err());
}
