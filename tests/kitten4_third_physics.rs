//! Self-authored published ASTs only; no downloaded projects or official code.
use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::{Value, json};
use std::time::Duration;

fn block(kind: &str, params: Value) -> Value {
    json!({"id":kind,"type":kind,"params":params})
}
fn number(n: f64) -> Value {
    block("math_number", json!({"NUM":n}))
}
fn property(name: &str) -> Value {
    block(
        "get_physics_property",
        json!({"sprite":"__self","attribute":name}),
    )
}
fn modern_property(name: &str) -> Value {
    block(
        "physics2_get_property",
        json!({"property":name,"sprite":"__self"}),
    )
}
fn store(name: &str, value: Value) -> Value {
    block("variables_set", json!({"VAR":name,"VALUE":value}))
}
fn source(commands: Vec<Value>) -> Value {
    let mut next = Value::Null;
    for (i, mut b) in commands.into_iter().enumerate().rev() {
        b["id"] = json!(format!("command-{i}"));
        if !next.is_null() {
            b["next_block"] = next;
        }
        next = b;
    }
    let mut variables = json!({});
    for name in [
        "speed",
        "density",
        "friction",
        "restitution",
        "flexibility",
        "after",
    ] {
        variables[name] = json!({"id":name,"name":name,"value":0,"is_global":true});
    }
    json!({"version":25,"work_type":"KITTEN","size":{"width":640,"height":360},
        "variables":variables,"audio":{},"theatre":{"current_scene":"s","scenes_order":["s"],
        "scenes":{"s":{"id":"s","actors":["a"]}},
        "actors":{"a":{"id":"a","visible":true}},"styles":{},"groups":{}},
        "compile_result":[{"id":"a","compiled_block_map":{"hat":{
            "id":"hat","type":"start_on_click","params":{},"next_block":next}}}]})
}
fn run(source: &Value, interpreted: bool) -> Engine {
    let canonical = kitten4::to_neko(source).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), *source);
    let mut engine = Engine::new(Program::compile(&canonical).unwrap());
    if interpreted {
        engine.disable_jit();
    }
    engine.use_virtual_clock();
    engine.start();
    for _ in 0..30 {
        engine
            .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
            .unwrap();
    }
    engine
}
fn value(engine: &Engine, name: &str) -> f64 {
    engine.variable_text(name).parse().unwrap()
}
fn base() -> Vec<Value> {
    vec![
        block("self_enable_physics", json!({})),
        block(
            "set_gravity",
            json!({"value":number(0.0),"dir":number(0.0)}),
        ),
    ]
}

#[test]
fn legacy_texture_presets_change_three_real_material_properties() {
    for interpreted in [true, false] {
        for (texture, density, friction, restitution) in [
            ("elastic", 1.0, 0.1, 1.0),
            ("iron", 8.0, 0.2, 0.1),
            ("wood", 0.8, 0.4, 0.2),
            ("other", 1.0, 0.1, 0.5),
        ] {
            let mut commands = base();
            commands.push(block("self_texture", json!({"texture_type":texture})));
            for name in ["density", "friction", "restitution"] {
                commands.push(store(name, property(name)));
            }
            let e = run(&source(commands), interpreted);
            assert_eq!(value(&e, "density"), density);
            assert_eq!(value(&e, "friction"), friction);
            assert_eq!(value(&e, "restitution"), restitution);
        }
    }
}

#[test]
fn legacy_force_polar_and_vector_accumulate_once_not_as_velocity_or_persistent_force() {
    for interpreted in [true, false] {
        for command in [
            block("set_force", json!({"value":number(12.0),"dir":number(0.0)})),
            block(
                "set_force_by_vector",
                json!({"x_axis":number(12.0),"y_axis":number(0.0)}),
            ),
        ] {
            let mut commands = base();
            commands.extend([
                block("self_set_mass", json!({"mass":number(2.0)})),
                command,
                block("wait", json!({"time":number(0.1)})),
                store("speed", property("speed")),
                block("wait", json!({"time":number(0.1)})),
                store("after", property("speed")),
            ]);
            let e = run(&source(commands), interpreted);
            assert!((value(&e, "speed") - 0.1).abs() <= 0.01);
            assert_eq!(value(&e, "speed"), value(&e, "after"));
        }
    }
}

#[test]
fn legacy_vector_velocity_preserves_components_and_rejects_numeric_strings() {
    for interpreted in [true, false] {
        let mut commands = base();
        commands.extend([
            block(
                "set_velocity_by_vector",
                json!({"x_axis":number(3.0),"y_axis":number(4.0)}),
            ),
            store("speed", property("speed")),
            block(
                "set_velocity_by_vector",
                json!({"x_axis":block("text",json!({"TEXT":"9"})),"y_axis":number(0.0)}),
            ),
            store("after", property("speed")),
        ]);
        let e = run(&source(commands), interpreted);
        assert_eq!(value(&e, "speed"), 5.0);
        assert_eq!(value(&e, "after"), 5.0);
    }
}

#[test]
fn orientation_gravity_without_events_clears_existing_gravity() {
    for interpreted in [true, false] {
        let e = run(
            &source(vec![
                block("self_enable_physics", json!({})),
                block(
                    "set_gravity",
                    json!({"value":number(100.0),"dir":number(-90.0)}),
                ),
                block("set_gravity_by_orientation", json!({"value":number(2.0)})),
                block("wait", json!({"time":number(0.1)})),
                store("speed", property("speed")),
                store("after", number(1.0)),
            ]),
            interpreted,
        );
        assert_eq!(value(&e, "speed"), 0.0);
        assert_eq!(value(&e, "after"), 1.0);
    }
}

#[test]
fn legacy_gravity_accelerates_and_all_numeric_legacy_vectors_reject_strings() {
    for interpreted in [true, false] {
        let e = run(
            &source(vec![
                block("self_enable_physics", json!({})),
                block(
                    "set_gravity",
                    json!({"value":number(3.0),"dir":number(90.0)}),
                ),
                block("wait", json!({"time":number(0.2)})),
                store("speed", property("speed")),
            ]),
            interpreted,
        );
        assert!(value(&e, "speed") >= 0.5);

        for command in [
            block(
                "set_force",
                json!({"value":block("text",json!({"TEXT":"12"})),"dir":number(0.0)}),
            ),
            block(
                "set_force_by_vector",
                json!({"x_axis":number(0.0),"y_axis":block("text",json!({"TEXT":"12"}))}),
            ),
            block(
                "set_gravity",
                json!({"value":block("text",json!({"TEXT":"12"})),"dir":number(0.0)}),
            ),
            block(
                "set_gravity_by_orientation",
                json!({"value":block("text",json!({"TEXT":"12"}))}),
            ),
        ] {
            let mut commands = base();
            commands.extend([
                command,
                block("wait", json!({"time":number(0.1)})),
                store("speed", property("speed")),
            ]);
            let e = run(&source(commands), interpreted);
            assert_eq!(value(&e, "speed"), 0.0);
        }
    }
}

#[test]
fn rigid_flexibility_reports_clamped_strength_but_does_not_fake_material_elasticity() {
    for interpreted in [true, false] {
        for (input, expected) in [(-1.0, 1.0), (27.4, 27.0), (200.0, 100.0)] {
            let e = run(
                &source(vec![
                    block("physics2_set_texture", json!({"texture_type":"hard"})),
                    block("physics2_set_flexibility", json!({"value":number(input)})),
                    store("flexibility", modern_property("flexibility")),
                    store("restitution", modern_property("restitution")),
                ]),
                interpreted,
            );
            assert_eq!(value(&e, "flexibility"), expected);
            assert_eq!(value(&e, "restitution"), 0.0);
        }
        let e = run(
            &source(vec![
                block(
                    "physics2_set_flexibility",
                    json!({"value":block("text",json!({"TEXT":"99"}))}),
                ),
                store("flexibility", modern_property("flexibility")),
            ]),
            interpreted,
        );
        assert_eq!(value(&e, "flexibility"), 50.0);
    }
}
