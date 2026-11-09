use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::time::Duration;

fn load(name: &str) -> (Value, Engine) {
    let path = format!("tests/fixtures/kitten4/semantics-{name}.bcm");
    let native: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let canonical = kitten4::to_neko(&native).unwrap();
    let mut engine = Engine::new(Program::compile(&canonical).unwrap());
    engine.start();
    (native, engine)
}

fn advance(engine: &mut Engine, frames: usize) {
    for _ in 0..frames {
        engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
            .unwrap();
    }
}

// Oracle: official 4.11.20, tools/semantics-kitten4.mjs. Wall-clock execution
// rates differ: assert level/single-flight behaviour, not browser frame counts.
#[test]
fn semantic_fixture_observations() {
    for name in ["when", "screen", "dispose", "costume", "keys", "text"] {
        let (native, mut engine) = load(name);
        advance(&mut engine, 150);
        if matches!(name, "keys" | "dispose") {
            engine.key_event("65", true);
            advance(&mut engine, 72);
            engine.key_event("65", false);
            advance(&mut engine, 18);
        }
        let values: std::collections::BTreeMap<_, _> = native["variables"]
            .as_object()
            .unwrap()
            .keys()
            .map(|id| (id.clone(), engine.variable_text(id)))
            .collect();
        println!("{name}: {}", serde_json::to_string(&values).unwrap());
    }
}

fn expect(engine: &Engine, values: &[(&str, &str)]) {
    for &(id, expected) in values {
        assert_eq!(engine.variable_text(id), expected, "variable {id}");
    }
}

#[test]
fn official_when_is_level_triggered_single_flight_and_mirrors_do_not_respond() {
    let (_, mut engine) = load("when");
    advance(&mut engine, 38);
    let entered: usize = engine.variable_text("originalEnter").parse().unwrap();
    let exited: usize = engine.variable_text("originalExit").parse().unwrap();
    assert!(entered > 1, "must retrigger during the first true interval");
    assert!(
        entered == exited || entered == exited + 1,
        "no overlapping body"
    );
    expect(&engine, &[("cloneEnter", "0"), ("cloneExit", "0")]);
    advance(&mut engine, 112);
    let entered: usize = engine.variable_text("originalEnter").parse().unwrap();
    assert!(entered > 2);
    assert_eq!(engine.variable_text("originalExit"), entered.to_string());
    assert!(engine.variable_text("always").parse::<usize>().unwrap() > 2);
    expect(&engine, &[("gate", "0"), ("done", "1")]);
    advance(&mut engine, 30);
    assert_eq!(engine.variable_text("originalEnter"), entered.to_string());
}

#[test]
fn official_check_screen_is_membership_not_a_transition_pulse() {
    let (_, mut engine) = load("screen");
    advance(&mut engine, 60);
    expect(
        &engine,
        &[
            ("stayA", "true"),
            ("leaveA", "false"),
            ("stayB", "false"),
            ("leaveB", "true"),
            ("stayA_later", "true"),
            ("leaveA_later", "false"),
            ("nameA", "true"),
            ("numberA", "true"),
            ("numberB", "false"),
            ("invalidStay", "false"),
            ("invalidLeave", "true"),
            ("done", "1"),
        ],
    );
}

#[test]
fn official_dispose_deletes_original_and_clone_and_stops_their_scripts() {
    let (_, mut engine) = load("dispose");
    advance(&mut engine, 60);
    expect(
        &engine,
        &[
            ("beforeOriginal", "1"),
            ("beforeClone", "1"),
            ("afterOriginal", "0"),
            ("afterClone", "0"),
        ],
    );
    engine.key_event("65", true);
    advance(&mut engine, 30);
    engine.key_event("65", false);
    expect(&engine, &[("keyAfterDispose", "0")]);
    // Restart restores the deleted original and the stable original sprite slot.
    engine.start();
    advance(&mut engine, 60);
    expect(
        &engine,
        &[
            ("beforeOriginal", "1"),
            ("beforeClone", "1"),
            ("afterOriginal", "0"),
        ],
    );
}

#[test]
fn official_costume_name_number_and_dropdown_object_are_distinct() {
    let (native, mut engine) = load("costume");
    advance(&mut engine, 10);
    expect(
        &engine,
        &[
            ("nameA", "蓝色方块"),
            ("nameB", "第二个造型"),
            ("numberA", "1"),
            ("numberB", "2"),
            ("literalA", "[object Object]"),
            ("literalB", "[object Object]"),
            ("literalText", "[object Object]"),
            ("done", "1"),
        ],
    );
    let canonical = kitten4::to_neko(&native).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    let cell = nekoc::engine::Cell::Costume("costume-b".into());
    assert_eq!(
        serde_json::to_value(cell).unwrap(),
        serde_json::json!({"style_id":"costume-b"})
    );
}

#[test]
fn official_held_concrete_key_repeats_only_on_original_not_empty_code_mirror() {
    let (_, mut engine) = load("keys");
    advance(&mut engine, 30);
    expect(&engine, &[("cloneStarted", "1")]);
    engine.key_event("65", true);
    advance(&mut engine, 42);
    let first: usize = engine.variable_text("originalEnter").parse().unwrap();
    let exited: usize = engine.variable_text("originalExit").parse().unwrap();
    assert!(first > 1);
    assert!(first == exited || first == exited + 1);
    advance(&mut engine, 30);
    let second: usize = engine.variable_text("originalEnter").parse().unwrap();
    assert!(second > first);
    engine.key_event("65", false);
    advance(&mut engine, 18);
    assert_eq!(engine.variable_text("originalEnter"), second.to_string());
    assert_eq!(engine.variable_text("originalExit"), second.to_string());
    expect(&engine, &[("cloneEnter", "0"), ("cloneExit", "0")]);
}

#[test]
fn official_single_text_index_is_one_based_character_with_empty_out_of_range() {
    let (_, mut engine) = load("text");
    advance(&mut engine, 10);
    expect(
        &engine,
        &[
            ("index-1", ""),
            ("index0", ""),
            ("index1", "a"),
            ("index2", "b"),
            ("index4", "d"),
            ("index5", ""),
            ("unicode", "猫"),
            ("empty", ""),
            ("done", "1"),
        ],
    );
}

#[test]
fn split_clone_fixtures_explicitly_report_unsupported_instead_of_claiming_parity() {
    for name in ["when-split", "keys-split"] {
        let native: Value = serde_json::from_str(
            &std::fs::read_to_string(format!("tests/fixtures/kitten4/semantics-{name}.bcm"))
                .unwrap(),
        )
        .unwrap();
        let report = kitten4::coverage(&native, 60);
        assert_eq!(report["stage"], "compile");
        assert!(report["error"].as_str().unwrap().contains("kitten4::clone"));
        println!("{name}: {report}");
    }
}
