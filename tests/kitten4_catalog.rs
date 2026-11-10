//! Synthetic legacy-alias probes, not downloaded projects or a second runtime oracle.
//! Source oracle: read-only official player_v2.2d180c468559fbd29528.js.orig
//! (Kitten4播放器/resources/app/src/player/build). Offsets below are zero-based
//! Unicode character offsets in that exact file, not byte offsets. These are
//! source-derived assertions; no browser execution is claimed.
use nekoc::{
    engine::{Engine, Frame, Program, Sprite},
    kitten4,
};
use serde_json::{Map, Value, json};
use std::time::Duration;

const ACTOR: &str = "nekoc-pen-actor";
const OTHER: &str = "alias-other-actor";
const STYLE_A: &str = "alias-style-a";
const STYLE_B: &str = "alias-style-b";
const STYLE_C: &str = "alias-style-c";

#[derive(Clone, Copy, Debug)]
enum Source {
    Workspace,
    Published,
}
const SOURCES: [Source; 2] = [Source::Workspace, Source::Published];

fn block(kind: &str, fields: Value, inputs: Value) -> Value {
    json!({"type":kind,"fields":fields,"inputs":inputs})
}
fn number(n: f64) -> Value {
    block("math_number", json!({"NUM":n}), json!({}))
}
fn set(name: &str, value: Value) -> Value {
    block("variables_set", json!({"VAR":name}), json!({"VALUE":value}))
}
fn get(attribute: &str) -> Value {
    block(
        "get",
        json!({"sprite":"__self","attribute":attribute}),
        json!({}),
    )
}

// Both serializers consume the same native sockets. In particular, fields stay
// scalar published params; do not silently turn a dropdown literal into text.
fn published(node: &Value) -> Value {
    let mut params = node["fields"].as_object().cloned().unwrap_or_default();
    for (name, child) in node["inputs"].as_object().into_iter().flatten() {
        params.insert(name.clone(), published(child));
    }
    let mut result = json!({"id":node["id"],"kind":"domain_block",
        "type":node["type"],"params":params,"child_block":[]});
    if let Some(next) = node.get("next") {
        result["next_block"] = published(next);
    }
    result
}

fn identify(node: &mut Value, serial: &mut usize) {
    if node.get("id").is_none() {
        node["id"] = json!(format!("alias-node-{serial}"));
        *serial += 1;
    }
    for child in node["inputs"]
        .as_object_mut()
        .into_iter()
        .flat_map(Map::values_mut)
    {
        identify(child, serial);
    }
    if let Some(next) = node.get_mut("next") {
        identify(next, serial);
    }
}

fn flatten(node: &Value, blocks: &mut Map<String, Value>, edges: &mut Map<String, Value>) {
    let id = node["id"].as_str().unwrap();
    let mut flat = node.clone();
    let object = flat.as_object_mut().unwrap();
    object.remove("inputs");
    object.remove("next");
    object.insert("shadows".into(), json!({}));
    // Unknown source metadata must survive alias normalization at the VM boundary.
    object.insert("alias_fixture_metadata".into(), json!({"preserve":true}));
    blocks.insert(id.into(), flat);
    let mut connections = Map::new();
    for (name, child) in node["inputs"].as_object().into_iter().flatten() {
        connections.insert(
            child["id"].as_str().unwrap().into(),
            json!({"type":"input","input_name":name,"input_type":"value"}),
        );
        flatten(child, blocks, edges);
    }
    if let Some(next) = node.get("next") {
        connections.insert(next["id"].as_str().unwrap().into(), json!({"type":"next"}));
        flatten(next, blocks, edges);
    }
    if !connections.is_empty() {
        edges.insert(id.into(), Value::Object(connections));
    }
}

fn project(source: Source, statements: Vec<Value>) -> Value {
    let mut native: Value =
        serde_json::from_str(include_str!("../samples/kitten4-public-pen.bcm")).unwrap();
    let actor = &mut native["theatre"]["actors"][ACTOR];
    actor["x"] = json!(17);
    actor["y"] = json!(-11);
    actor["scale"] = json!(125);
    actor["visible"] = json!(true);
    actor["styles"] = json!([STYLE_A, STYLE_B, STYLE_C]);
    actor["current_style_id"] = json!(STYLE_A);
    let prototype = native["theatre"]["styles"]["nekoc-pen-style"].clone();
    for (id, name) in [(STYLE_A, "first"), (STYLE_B, "second"), (STYLE_C, "third")] {
        let mut style = prototype.clone();
        style["id"] = json!(id);
        style["name"] = json!(name);
        native["theatre"]["styles"][id] = style;
    }
    native["variables"] = json!({});
    for (id, value) in [("after", json!(0)), ("result", json!(0))] {
        native["variables"][id] = json!({"id":id,"name":id,"type":"any",
            "value":value,"is_global":true});
    }
    let mut next = set("after", number(1.0));
    for mut statement in statements.into_iter().rev() {
        statement["next"] = next;
        next = statement;
    }
    let mut root = block("start_on_click", json!({}), json!({}));
    root["id"] = json!("alias-hat");
    root["next"] = next;
    let mut serial = 0;
    identify(&mut root, &mut serial);
    match source {
        Source::Workspace => {
            let (mut blocks, mut connections) = (Map::new(), Map::new());
            flatten(&root, &mut blocks, &mut connections);
            native["theatre"]["actors"][ACTOR]["block_data_json"] =
                json!({"blocks":blocks,"connections":connections,"comments":{}});
        }
        Source::Published => {
            for section in ["actors", "scenes"] {
                for entity in native["theatre"][section]
                    .as_object_mut()
                    .unwrap()
                    .values_mut()
                {
                    entity.as_object_mut().unwrap().remove("block_data_json");
                }
            }
            native["compile_result"] = json!([{"id":ACTOR,"procedures":{},
                "compiled_block_map":{"alias-hat":published(&root)}}]);
        }
    }
    native
}

fn probe(kind: &str, fields: Value, inputs: Value) -> Value {
    let mut node = block(kind, fields, inputs);
    node["id"] = json!("alias-probe");
    node
}
fn find<'a>(value: &'a Value, id: &str) -> &'a Value {
    fn visit<'a>(value: &'a Value, id: &str) -> Option<&'a Value> {
        match value {
            Value::Object(object) => {
                if object.get("id").and_then(Value::as_str) == Some(id) {
                    return Some(value);
                }
                object.values().find_map(|child| visit(child, id))
            }
            Value::Array(items) => items.iter().find_map(|child| visit(child, id)),
            _ => None,
        }
    }
    visit(value, id).unwrap_or_else(|| panic!("missing block {id}"))
}
fn imported(native: &Value, lowered_kind: &str) -> nekoc::json::Json {
    let canonical = kitten4::to_neko(native).unwrap();
    assert!(
        find(&canonical["actors"], "alias-probe")["type"]
            .as_str()
            .unwrap()
            .starts_with("kitten4::"),
        "legacy source spelling must stay opaque in the editable AST"
    );
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), *native);
    let saved = canonical.clone();
    let lowered = kitten4::lower_for_vm(&canonical);
    assert_eq!(
        find(&lowered["actors"], "alias-probe")["type"],
        lowered_kind
    );
    assert_eq!(canonical, saved, "VM lowering must not edit the source AST");
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), *native);
    canonical
}
fn tick(engine: &mut Engine) -> Frame {
    engine
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(1))
        .unwrap()
}
fn engine(canonical: &Value, interpreted: bool) -> Engine {
    let mut result = Engine::new(Program::compile(canonical).unwrap());
    result.use_virtual_clock();
    if interpreted {
        result.disable_jit();
    }
    result.start();
    result
}
fn run(canonical: &Value, interpreted: bool) -> (Engine, Sprite, Vec<String>) {
    let saved = canonical.clone();
    let mut vm = engine(canonical, interpreted);
    let mut actor = None;
    let mut order = vec![];
    for _ in 0..90 {
        let frame = tick(&mut vm);
        if let Some(sprite) = frame.sprites.into_iter().find(|s| s.id == ACTOR) {
            actor = Some(sprite);
        }
        if let Some(next) = frame.order {
            order = next;
        }
    }
    assert_eq!(
        vm.variable_text("after"),
        "1",
        "alias must run its continuation"
    );
    assert_eq!(
        *canonical, saved,
        "compilation/execution must not edit the source AST"
    );
    assert_eq!(
        kitten4::from_neko(canonical).unwrap(),
        canonical["_nekocKitten4"]["source"],
        "execution must preserve the native roundtrip"
    );
    (vm, actor.unwrap(), order)
}
fn close(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 1e-9,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn legacy_coordinate_aliases_match_official_parameter_rewrites() {
    // Tn6a/F aliases at 591109..591879: change/glide force axis + increase;
    // self_set_x at 591529 / self_set_y at 591617 assign value=x/y;
    // self_change_position at 591705 delegates to *set*, not add;
    // glide_position forces increase but retains coordinary and value.
    let cases = [
        (
            "self_change_x",
            "self_change_coordinate_x",
            json!({"value":number(7.0)}),
            "y",
            24.0,
            -11.0,
        ),
        (
            "self_change_y",
            "self_change_coordinate_y",
            json!({"value":number(7.0)}),
            "x",
            17.0,
            -4.0,
        ),
        (
            "self_glide_x",
            "self_glide_coordinate",
            json!({"value":number(7.0),"time":number(0.05)}),
            "y",
            24.0,
            -11.0,
        ),
        (
            "self_glide_y",
            "self_glide_coordinate",
            json!({"value":number(7.0),"time":number(0.05)}),
            "x",
            17.0,
            -4.0,
        ),
        (
            "self_set_x",
            "self_set_position_x",
            json!({"x":number(7.0),"value":number(999.0)}),
            "y",
            7.0,
            -11.0,
        ),
        (
            "self_set_y",
            "self_set_position_y",
            json!({"y":number(7.0),"value":number(999.0)}),
            "x",
            17.0,
            7.0,
        ),
        (
            "self_change_position",
            "self_set_position_y",
            json!({"value":number(7.0)}),
            "y",
            17.0,
            7.0,
        ),
        (
            "self_glide_position",
            "self_glide_coordinate",
            json!({"value":number(7.0),"time":number(0.05)}),
            "y",
            17.0,
            -4.0,
        ),
    ];
    for source in SOURCES {
        for (alias, lowered, inputs, axis, x, y) in &cases {
            let native = project(
                source,
                vec![probe(
                    alias,
                    json!({"coordinary":axis,"increase":"decrease"}),
                    inputs.clone(),
                )],
            );
            let canonical = imported(&native, lowered);
            let lowered = kitten4::lower_for_vm(&canonical);
            let node = find(&lowered["actors"], "alias-probe");
            if alias.contains("glide")
                || alias.starts_with("self_change_") && *alias != "self_change_position"
            {
                assert_eq!(node["fields"]["increase"], "increase", "{source:?} {alias}");
            }
            for interpreted in [true, false] {
                let (_, actor, _) = run(&canonical, interpreted);
                close(actor.x, *x);
                close(actor.y, *y);
            }
        }
    }
}

#[test]
fn legacy_fades_force_visibility_direction_and_block_their_continuation() {
    // Tn6a/lt at 608818/608912: force is_show=show/hide. lt/f at 599869
    // starts a blocking task, restores alpha=1 after hiding, and does nothing
    // for positive-duration show on an already-visible actor.
    for source in SOURCES {
        for (alias, show) in [
            ("self_gradually_appear", true),
            ("self_gradually_disappear", false),
        ] {
            let mut native = project(
                source,
                vec![probe(
                    alias,
                    json!({"is_show":if show {"hide"} else {"show"}}),
                    json!({"time":number(0.1)}),
                )],
            );
            native["theatre"]["actors"][ACTOR]["visible"] = json!(!show);
            let canonical = imported(&native, "self_gradually_show_hide");
            let lowered = kitten4::lower_for_vm(&canonical);
            assert_eq!(
                find(&lowered["actors"], "alias-probe")["fields"]["is_show"],
                if show { "show" } else { "hide" }
            );
            for interpreted in [true, false] {
                let mut vm = engine(&canonical, interpreted);
                tick(&mut vm);
                assert_eq!(
                    vm.variable_text("after"),
                    "0",
                    "{source:?} {alias} must block"
                );
                let (_, actor, _) = run(&canonical, interpreted);
                assert_eq!(actor.visible, show);
                close(actor.opacity, 1.0);
            }
        }
    }
}

#[test]
fn legacy_appear_on_visible_actor_is_immediate_and_does_not_reset_alpha() {
    // Tn6a/lt/f at 599869: positive duration runs only when !show || !visible.
    // An existing opacity must not be replaced by a new 0 -> 1 fade.
    for source in SOURCES {
        let native = project(
            source,
            vec![
                block(
                    "self_set_effect_2",
                    json!({"scope":"1"}),
                    json!({"val":number(40.0)}),
                ),
                probe(
                    "self_gradually_appear",
                    json!({}),
                    json!({"time":number(1.0)}),
                ),
            ],
        );
        let canonical = imported(&native, "self_gradually_show_hide");
        for interpreted in [true, false] {
            let mut vm = engine(&canonical, interpreted);
            let frame = tick(&mut vm);
            assert_eq!(vm.variable_text("after"), "1");
            let actor = frame.sprites.iter().find(|s| s.id == ACTOR).unwrap();
            assert!(actor.visible);
            close(actor.opacity, 0.6);
        }
    }
}

#[test]
fn legacy_disappear_restores_full_alpha_instead_of_the_previous_alpha() {
    // Tn6a/lt/f at 599869: the hide task's on_end is explicitly
    // c.set_alpha(1), then set_visibility(false), not restore(saved_alpha).
    for source in SOURCES {
        let native = project(
            source,
            vec![
                block(
                    "self_set_effect_2",
                    json!({"scope":"1"}),
                    json!({"val":number(40.0)}),
                ),
                probe(
                    "self_gradually_disappear",
                    json!({}),
                    json!({"time":number(0.1)}),
                ),
            ],
        );
        let canonical = imported(&native, "self_gradually_show_hide");
        for interpreted in [true, false] {
            let (_, actor, _) = run(&canonical, interpreted);
            assert!(!actor.visible);
            close(actor.opacity, 1.0);
        }
    }
}

#[test]
fn legacy_zero_duration_visibility_does_not_change_existing_alpha() {
    // Tn6a/lt/f at 599869: time === 0 calls set_visibility directly,
    // bypassing fade setup and the positive-duration alpha-reset callback.
    for source in SOURCES {
        for (alias, show) in [
            ("self_gradually_appear", true),
            ("self_gradually_disappear", false),
        ] {
            let mut native = project(
                source,
                vec![
                    block(
                        "self_set_effect_2",
                        json!({"scope":"1"}),
                        json!({"val":number(40.0)}),
                    ),
                    probe(alias, json!({}), json!({"time":number(0.0)})),
                ],
            );
            native["theatre"]["actors"][ACTOR]["visible"] = json!(!show);
            let canonical = imported(&native, "self_gradually_show_hide");
            for interpreted in [true, false] {
                let mut vm = engine(&canonical, interpreted);
                let frame = tick(&mut vm);
                assert_eq!(vm.variable_text("after"), "1");
                let actor = frame.sprites.iter().find(|s| s.id == ACTOR).unwrap();
                assert_eq!(actor.visible, show);
                close(actor.opacity, 0.6);
            }
        }
    }
}

#[test]
fn legacy_scale_aliases_force_addition_and_preserve_the_other_axis() {
    // Tn6a/lt at 609077 and 609316: force increase and delegate to
    // self_change_scale_2/add_width_height_scale_2 (606253/606782).
    for source in SOURCES {
        for (alias, fields, inputs, width, height) in [
            (
                "self_change_scale",
                json!({"increase":"decrease"}),
                json!({"scale":number(20.0)}),
                145.0,
                145.0,
            ),
            (
                "add_width_height_scale",
                json!({"increase":"decrease","type":"width"}),
                json!({"value":number(20.0)}),
                145.0,
                125.0,
            ),
            (
                "add_width_height_scale",
                json!({"increase":"decrease","type":"height"}),
                json!({"value":number(20.0)}),
                125.0,
                145.0,
            ),
        ] {
            let native = project(source, vec![probe(alias, fields, inputs)]);
            let canonical = imported(&native, alias);
            let lowered = kitten4::lower_for_vm(&canonical);
            assert_eq!(
                find(&lowered["actors"], "alias-probe")["fields"]["increase"],
                "increase"
            );
            for interpreted in [true, false] {
                let (_, actor, _) = run(&canonical, interpreted);
                close(actor.scale * actor.size_x / 100.0, width);
                close(actor.scale * actor.size_y / 100.0, height);
            }
        }
    }
}

#[test]
fn legacy_effect_aliases_use_steps_for_change_and_val_for_set() {
    // Tn6a/lt at 609416, 609508, 609602: both change aliases force increase;
    // set delegates unchanged. lt/p,m at 598754/600387 distinguish scope 1
    // (transparency), scope 0 (hue), scope 2 (brightness); no numeric coercion
    // or alternate legacy sockets are inferred here.
    for source in SOURCES {
        for alias in [
            "self_change_effect",
            "self_change_effect_2",
            "self_set_effect",
        ] {
            for (scope, attribute, initial) in
                [("0", "7", 20.0), ("1", "8", 20.0), ("2", "9", 70.0)]
            {
                let change = alias != "self_set_effect";
                let expected = if change { initial + 15.0 } else { 15.0 };
                let inputs = if change {
                    json!({"steps":number(15.0)})
                } else {
                    json!({"val":number(15.0)})
                };
                let native = project(
                    source,
                    vec![
                        block(
                            "self_set_effect_2",
                            json!({"scope":scope}),
                            json!({"val":number(initial)}),
                        ),
                        probe(alias, json!({"scope":scope,"increase":"decrease"}), inputs),
                        set("result", get(attribute)),
                    ],
                );
                let canonical = imported(
                    &native,
                    if change {
                        "self_change_effect"
                    } else {
                        "self_set_effect"
                    },
                );
                let lowered = kitten4::lower_for_vm(&canonical);
                if change {
                    assert_eq!(
                        find(&lowered["actors"], "alias-probe")["fields"]["increase"],
                        "increase"
                    );
                }
                for interpreted in [true, false] {
                    let (vm, actor, _) = run(&canonical, interpreted);
                    close(vm.variable_text("result").parse().unwrap(), expected);
                    match scope {
                        "1" => close(actor.opacity, 1.0 - expected / 100.0),
                        "0" => close(actor.effects[0], expected),
                        "2" => close(actor.effects[2], expected - 100.0),
                        _ => unreachable!(),
                    }
                }
            }
        }
    }
}

#[test]
fn legacy_set_top_overrides_layer_and_moves_the_actor_to_the_front() {
    // Tn6a/lt at 609167: set_top sets layer=peak before set_theatre_layer;
    // set_theatre_layer at 607148 uses actor z order (not an arbitrary index).
    for source in SOURCES {
        let mut native = project(
            source,
            vec![probe("set_top", json!({"layer":"bottom"}), json!({}))],
        );
        let mut other = native["theatre"]["actors"][ACTOR].clone();
        other["id"] = json!(OTHER);
        other["name"] = json!("other");
        other.as_object_mut().unwrap().remove("block_data_json");
        native["theatre"]["actors"][OTHER] = other;
        native["theatre"]["groups"]["nekoc-pen-group"]["actors"] = json!([ACTOR, OTHER]);
        let scene = native["theatre"]["scenes_order"][0]
            .as_str()
            .unwrap()
            .to_owned();
        native["theatre"]["scenes"][&scene]["actors"] = json!([ACTOR, OTHER]);
        let canonical = imported(&native, "self_change_layer");
        let lowered = kitten4::lower_for_vm(&canonical);
        assert_eq!(
            find(&lowered["actors"], "alias-probe")["fields"]["layer"],
            "peak"
        );
        for interpreted in [true, false] {
            let (_, _, order) = run(&canonical, interpreted);
            assert_eq!(order, vec![OTHER.to_owned(), ACTOR.to_owned()]);
        }
    }
}

#[test]
fn legacy_next_style_and_index_aliases_use_official_costume_order() {
    // Tn6a/lt at 609819: next_style overrides prev_or_next=next.
    // At 609756 index delegates unchanged; set_costume at 608109 subtracts
    // one, rounds, then wraps via lt/_ at 598621.
    for source in SOURCES {
        for (alias, fields, inputs, expected) in [
            (
                "self_next_style",
                json!({"prev_or_next":"prev"}),
                json!({}),
                STYLE_B,
            ),
            (
                "set_costume_by_index",
                json!({}),
                json!({"index":number(2.0)}),
                STYLE_B,
            ),
            (
                "set_costume_by_index",
                json!({}),
                json!({"index":number(4.0)}),
                STYLE_A,
            ),
        ] {
            let native = project(source, vec![probe(alias, fields, inputs)]);
            let canonical = imported(
                &native,
                if alias == "self_next_style" {
                    "self_prev_next_style"
                } else {
                    "set_sprite_style"
                },
            );
            for interpreted in [true, false] {
                let (_, actor, _) = run(&canonical, interpreted);
                assert_eq!(actor.style.as_deref(), Some(expected));
            }
        }
    }
}

#[test]
fn legacy_costume_id_literal_is_a_tagged_id_not_a_name_or_index() {
    // Tn6a/lt at 609666: index={style_id:t.style_id}. At 608109 the tagged
    // object takes the ID branch. STYLE_B deliberately differs from name "second".
    // Workspace fields and published scalar params must both reach that branch.
    for source in SOURCES {
        let native = project(
            source,
            vec![probe(
                "set_costume_by_id",
                json!({"style_id":STYLE_B}),
                json!({}),
            )],
        );
        let canonical = imported(&native, "set_sprite_style");
        let lowered = kitten4::lower_for_vm(&canonical);
        let literal = &find(&lowered["actors"], "alias-probe")["inputs"]["style_id"];
        assert_eq!(literal["type"], "kitten4_costume_literal");
        assert_eq!(literal["fields"]["style_id"], STYLE_B);
        for interpreted in [true, false] {
            let (_, actor, _) = run(&canonical, interpreted);
            assert_eq!(actor.style.as_deref(), Some(STYLE_B));
        }
    }
}

#[test]
fn unsupported_dynamic_legacy_costume_id_is_not_silently_lowered_to_an_empty_id() {
    // Tn6a/lt 609666 wraps the evaluated style_id in an object. The current
    // VM costume-literal expression only accepts fields.style_id, so this
    // reporter form is intentionally unsupported rather than a claimed match.
    // Editor reachability/browser execution of this synthetic form is unverified.
    for source in SOURCES {
        let value = block("text", json!({"TEXT":STYLE_B}), json!({}));
        let native = project(
            source,
            vec![probe(
                "set_costume_by_id",
                json!({}),
                json!({"style_id":value}),
            )],
        );
        let canonical = imported(&native, "kitten4::set_costume_by_id");
        let error = match Program::compile(&canonical) {
            Err(error) => error,
            Ok(_) => panic!("unsupported alias must not pretend to execute"),
        };
        assert!(
            format!("{error:#}").contains("set_costume_by_id"),
            "{error}"
        );
        assert_eq!(kitten4::from_neko(&canonical).unwrap(), native);
    }
}

#[test]
fn legacy_get_returns_the_delegated_reporter_result() {
    // Tn6a sensing factory at 618387: get returns h.get_3(t,e,n,i), unlike
    // lt/get_choice (609920), whose wrapper deliberately discards its result.
    // get_3 at 614280 resolves __self then reads the selected native property.
    for source in SOURCES {
        for (attribute, lowered, expected) in [
            ("0", "coordinate_of_sprite", "17"),
            ("1", "coordinate_of_sprite", "-11"),
            ("4", "kitten4_costume_name", "first"),
        ] {
            let native = project(
                source,
                vec![set(
                    "result",
                    probe(
                        "get",
                        json!({"sprite":"__self","attribute":attribute}),
                        json!({}),
                    ),
                )],
            );
            let canonical = imported(&native, lowered);
            for interpreted in [true, false] {
                let (vm, _, _) = run(&canonical, interpreted);
                assert_eq!(vm.variable_text("result"), expected);
            }
        }
    }
}

#[test]
fn legacy_multiline_text_is_verbatim_including_unicode_and_line_endings() {
    // oiyH at 1650710: multiline_text returns t.TEXT without numeric parsing,
    // trimming, joining lines or normalizing CRLF. It is not default_value.
    for source in SOURCES {
        for value in ["猫\nsecond\r\n\tline", "0012", "", "  leading\ntrailing  "] {
            let native = project(
                source,
                vec![set(
                    "result",
                    probe("multiline_text", json!({"TEXT":value}), json!({})),
                )],
            );
            let canonical = imported(&native, "text");
            let lowered = kitten4::lower_for_vm(&canonical);
            assert_eq!(
                find(&lowered["actors"], "alias-probe")["fields"]["TEXT"],
                value
            );
            for interpreted in [true, false] {
                let (vm, _, _) = run(&canonical, interpreted);
                assert_eq!(vm.variable_text("result"), value);
            }
        }
    }
}
