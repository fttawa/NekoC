//! Original in-memory projects; no generated bcmkn or third-party assets.
use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;
const ACTOR: &str = "nekoc-default-actor";
fn num(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn text(s: &str) -> Value {
    json!({"type":"text","fields":{"TEXT":s}})
}
fn log(v: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":v}})
}
fn chain(blocks: Vec<Value>) -> Value {
    blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap()
}
fn project(blocks: Vec<Value>) -> Value {
    let mut p = Document::blank().value().clone();
    p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] =
        json!([{"type":"on_running_group_activated","next":chain(blocks)}]);
    p
}
fn vm(p: &Value, jit: bool) -> Engine {
    let mut e = Engine::new(Program::compile(p).unwrap());
    if !jit {
        e.disable_jit();
    }
    e.start();
    e
}
fn step(e: &mut Engine) -> Vec<String> {
    e.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
        .unwrap()
        .logs
}
fn frame(e: &mut Engine) -> nekoc::engine::Frame {
    e.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))
        .unwrap()
}
fn run(p: &Value, jit: bool) -> Vec<String> {
    let mut e = vm(p, jit);
    (0..10).flat_map(|_| step(&mut e)).collect()
}
fn appearance(name: &str) -> Value {
    json!({"type":"appearance_of_sprite","fields":{"sprite":"--self","appearance":name}})
}
fn axis(name: &str, value: f64) -> Value {
    json!({"type":"set_width_height_scale","fields":{"type":name},"inputs":{"value":num(value)}})
}
#[test]
fn appearance_is_independent_axis_percentage_rounded_not_pixels() {
    let p = project(vec![
        json!({"type":"set_scale","inputs":{"scale":num(200.0)}}),
        axis("width", 123.456),
        axis("height", 56.789),
        log(appearance("scale")),
        log(appearance("width")),
        log(appearance("height")),
        json!({"type":"self_point_towards","inputs":{"degrees":num(25.7142857)}}),
        log(appearance("direction")),
        json!({"type":"set_scale","inputs":{"scale":num(75.0)}}),
        log(appearance("width")),
        log(appearance("height")),
    ]);
    for jit in [false, true] {
        assert_eq!(
            run(&p, jit),
            ["123.46", "123.46", "56.79", "25.71", "75", "75"]
        );
    }
}
#[test]
fn appearance_changes_both_actual_axes_and_enforces_official_limits() {
    let p = project(vec![
        axis("width", 150.0),
        axis("height", 50.0),
        json!({"type":"self_change_scale","fields":{"increase":"increase"},"inputs":{"scale":num(25.0)}}),
        log(appearance("width")),
        log(appearance("height")),
        json!({"type":"add_width_height_scale","fields":{"type":"height","increase":"increase"},"inputs":{"value":num(0.005)}}),
        log(appearance("height")),
        axis("width", 0.0),
        axis("height", 10000.0),
        log(appearance("width")),
        log(appearance("height")),
    ]);
    for jit in [false, true] {
        assert_eq!(run(&p, jit), ["175", "75", "75.01", "1", "9999"]);
    }
}
#[test]
fn dialog_wait_is_nonblocking_indefinite_and_formats_like_official_helper() {
    for jit in [false, true] {
        let p = project(vec![
            json!({"type":"self_dialog_wait","fields":{"type":"think"},"inputs":{"text":text("a b")}}),
            log(text("continued")),
        ]);
        let mut e = vm(&p, jit);
        let first = frame(&mut e);
        assert_eq!(first.logs, ["continued"]);
        let actor = first.sprites.iter().find(|s| s.id == ACTOR).unwrap();
        let d = actor.dialog.as_ref().unwrap();
        assert_eq!(d.text, "a\u{a0}b");
        assert!(d.think);
        for _ in 0..200 {
            assert!(
                frame(&mut e)
                    .sprites
                    .iter()
                    .all(|s| s.id != ACTOR || s.dialog.is_some())
            );
        }
        let p = project(vec![
            json!({"type":"self_dialog_wait","fields":{"type":"talk"},"inputs":{"text":text(&"界".repeat(91))}}),
        ]);
        let mut e = vm(&p, jit);
        let first = frame(&mut e);
        assert_eq!(
            first
                .sprites
                .iter()
                .find(|s| s.id == ACTOR)
                .unwrap()
                .dialog
                .as_ref()
                .unwrap()
                .text,
            format!("{}...", "界".repeat(90))
        );
    }
}
#[test]
fn hidden_dialog_is_ignored_empty_dialog_is_valid_and_close_clears() {
    for jit in [false, true] {
        let p = project(vec![
            json!({"type":"self_dialog_wait","fields":{"type":"talk"},"inputs":{"text":text("")}}),
        ]);
        let mut e = vm(&p, jit);
        let first = frame(&mut e);
        assert_eq!(
            first
                .sprites
                .iter()
                .find(|s| s.id == ACTOR)
                .unwrap()
                .dialog
                .as_ref()
                .unwrap()
                .text,
            ""
        );
        let mut hidden = p.clone();
        hidden["actors"]["actorsDict"][ACTOR]["visible"] = json!(false);
        let mut e = vm(&hidden, jit);
        let first = frame(&mut e);
        assert!(
            first
                .sprites
                .iter()
                .find(|s| s.id == ACTOR)
                .unwrap()
                .dialog
                .is_none()
        );
        let p = project(vec![
            json!({"type":"self_dialog_wait","inputs":{"text":text("hello")}}),
            json!({"type":"close_self_dialog"}),
        ]);
        let mut e = vm(&p, jit);
        let first = frame(&mut e);
        assert!(
            first
                .sprites
                .iter()
                .find(|s| s.id == ACTOR)
                .unwrap()
                .dialog
                .is_none()
        );
    }
}
fn actor_report(attribute: &str, id: &str) -> Value {
    json!({"type":"procedures_2_actor_param","id":"actor-report","mutation":format!("<mutation id=\"{id}\" type=\"Actor\"></mutation>"),"fields":{"param_name":"stale display name","attribute":attribute}})
}
fn actor_project(report: Value) -> Value {
    let mut p = project(vec![
        json!({"type":"procedures_2_callnoreturn","fields":{"NAME":"actor-proc","target":ACTOR}}),
    ]);
    p["actors"]["actorsDict"][ACTOR]["position"] = json!({"x":1.23456,"y":-2.34567});
    p["procedures"] = json!({"proceduresDict":{"actor-proc":{"id":"actor-proc","name":"probe","params":[{"id":"target","name":"actor","type":"Actor"}],"nekoBlockJsonList":[{"type":"procedures_2_defnoreturn","statements":{"STACK":log(report)}}]}}});
    p
}
#[test]
fn procedure_actor_property_uses_mutation_id_and_actor_field_argument() {
    for (attribute, expected) in [
        ("x", "1.23"),
        ("y", "-2.35"),
        ("width", "100"),
        ("height", "100"),
        ("camp", "0"),
        ("distance", "0"),
    ] {
        let p = actor_project(actor_report(attribute, "target"));
        for jit in [false, true] {
            assert_eq!(run(&p, jit), [expected], "{attribute}");
        }
    }
    let mut p = actor_project(actor_report("x", "target"));
    p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"][0]["next"]["fields"]["target"] =
        json!("missing-actor");
    for jit in [false, true] {
        assert_eq!(run(&p, jit), ["NaN"]);
    }
}
#[test]
fn procedure_actor_property_rejects_missing_ids_and_unimplemented_official_attributes() {
    for id in ["", "wrong-id"] {
        assert!(Program::compile(&actor_project(actor_report("x", id))).is_err());
    }
    assert!(Program::compile(&actor_project(actor_report("clone_index", "target"))).is_err());
}
#[test]
fn get_sprite_property_code_api_alias_reuses_appearance_getter() {
    for jit in [false, true] {
        assert_eq!(
            run(
                &project(vec![log(
                    json!({"type":"get_sprite_property","fields":{"sprite":"--self","attribute":"height"}})
                )]),
                jit
            ),
            ["100"]
        );
    }
}
#[test]
fn clone_named_appearance_properties_reuse_official_axis_getter() {
    let clone = |attribute: &str| json!({"type":"get_clone_index_property","fields":{"sprite":"--self","attribute":attribute},"inputs":{"index":num(1.0)}});
    let p = project(vec![
        axis("width", 123.456),
        axis("height", 56.789),
        json!({"type":"mirror","fields":{"sprite":"--self"}}),
        log(clone("scale")),
        log(clone("width")),
        log(clone("height")),
    ]);
    for jit in [false, true] {
        assert_eq!(run(&p, jit), ["123.46", "123.46", "56.79"]);
    }
}
