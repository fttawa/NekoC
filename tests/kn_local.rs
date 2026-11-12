//! Original in-memory KN projects; no third-party assets or generated bcmkn.
use nekoc::{
    engine::{Engine, Program},
    studio::document::Document,
};
use serde_json::{Value, json};
use std::time::Duration;

const ACTOR: &str = "nekoc-default-actor";
fn project(blocks: Vec<Value>) -> Value {
    let mut p = Document::blank().value().clone();
    let chain = blocks
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap();
    p["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] =
        json!([{"type":"on_running_group_activated","next":chain}]);
    p
}
fn log(v: Value) -> Value {
    json!({"type":"console_log","inputs":{"console_log":v}})
}
fn num(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}
fn alias(attribute: &str) -> Value {
    json!({"type":"get_sprite_property","fields":{"sprite":"--self","attribute":attribute}})
}
fn step(vm: &mut Engine) -> Vec<String> {
    vm.advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
        .unwrap()
        .logs
}
fn collect(vm: &mut Engine, count: usize) -> Vec<String> {
    let mut logs = vec![];
    for _ in 0..32 {
        logs.extend(step(vm));
        if logs.len() >= count {
            return logs;
        }
    }
    panic!("async microphone reporter did not complete: {logs:?}");
}
fn vm(p: &Value, jit: bool) -> Engine {
    let mut vm = Engine::new(Program::compile(p).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.start();
    vm
}

#[test]
fn code_api_aliases_are_identical_to_native_reporters() {
    let mut blocks = vec![
        json!({"type":"set_width_height_scale","fields":{"type":"width"},"inputs":{"value":num(123.456)}}),
        json!({"type":"set_width_height_scale","fields":{"type":"height"},"inputs":{"value":num(56.789)}}),
    ];
    for (attribute, kind, field) in [
        ("x", "coordinate_of_sprite", Some("coordinate")),
        ("y", "coordinate_of_sprite", Some("coordinate")),
        ("style_index", "style_of_sprite", None),
        ("scale", "appearance_of_sprite", Some("appearance")),
        ("width", "appearance_of_sprite", Some("appearance")),
        ("height", "appearance_of_sprite", Some("appearance")),
        ("direction", "appearance_of_sprite", Some("appearance")),
        ("distance", "distance_to", None),
        ("0", "effect_of_sprite", Some("effect")),
        ("1", "effect_of_sprite", Some("effect")),
        ("2", "effect_of_sprite", Some("effect")),
        ("3", "effect_of_sprite", Some("effect")),
        ("4", "effect_of_sprite", Some("effect")),
        ("5", "effect_of_sprite", Some("effect")),
        ("6", "effect_of_sprite", Some("effect")),
    ] {
        let mut native = json!({"type":kind,"fields":{"sprite":"--self"}});
        if let Some(field) = field {
            native["fields"][field] = json!(attribute);
        }
        blocks.push(log(alias(attribute)));
        blocks.push(log(native));
    }
    let mut p = project(blocks);
    p["actors"]["actorsDict"][ACTOR]["position"] = json!({"x":1.23456,"y":-2.34567});
    for jit in [false, true] {
        let logs = step(&mut vm(&p, jit));
        assert_eq!(logs.len(), 30);
        for pair in logs.as_chunks::<2>().0 {
            assert_eq!(pair[0], pair[1]);
        }
        assert_eq!(&logs[8..12], ["123.46", "123.46", "56.79", "56.79"]);
    }
}

#[test]
fn alias_rejects_properties_the_official_converter_does_not_lower() {
    for attribute in [
        "camp",
        "clone_index",
        "size",
        "style",
        "visible",
        "alpha",
        "unknown",
        "",
    ] {
        assert!(
            Program::compile(&project(vec![log(alias(attribute))])).is_err(),
            "{attribute}"
        );
    }
}

#[test]
fn named_effect_code_api_aliases_map_to_the_official_numeric_effects() {
    let mut blocks = vec![];
    for (index, name) in [
        "color",
        "opacity",
        "brightness",
        "pixelate",
        "ripple",
        "distortion",
        "grayscale",
    ]
    .into_iter()
    .enumerate()
    {
        let effect = index.to_string();
        // Distinct nonzero values prevent a swapped mapping passing because
        // every effect happened to be its default zero.
        blocks.push(json!({"type":"self_set_effect","fields":{"scope":effect},"inputs":{"value":num(10.0 + index as f64)}}));
        blocks.push(log(alias(name)));
        blocks.push(log(alias(&effect)));
        blocks.push(log(
            json!({"type":"effect_of_sprite","fields":{"sprite":"--self","effect":effect}}),
        ));
    }
    let p = project(blocks);
    for jit in [false, true] {
        let logs = step(&mut vm(&p, jit));
        assert_eq!(logs.len(), 21);
        for (index, triple) in logs.as_chunks::<3>().0.iter().enumerate() {
            assert_eq!(triple[0], triple[1], "named effect {index}");
            assert_eq!(triple[0], triple[2], "native effect {index}");
            assert_ne!(triple[0], "0", "effect {index} must not be the default");
        }
    }
}

#[test]
fn microphone_is_host_backed_not_a_constant_and_keeps_numeric_type() {
    let voice = || json!({"type":"get_voice_volume"});
    let p = project(vec![
        log(voice()),
        log(
            json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":voice(),"B":num(1.0)}}),
        ),
        log(
            json!({"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":voice(),"B":num(37.0)}}),
        ),
    ]);
    for jit in [false, true] {
        let mut e = vm(&p, jit);
        e.set_kn_voice_volume(Some(37.0)).unwrap();
        assert_eq!(collect(&mut e, 3), ["37", "38", "true"]);
        let mut e = vm(&p, jit);
        for _ in 0..3 {
            assert!(
                step(&mut e).is_empty(),
                "default microphone must remain pending"
            );
        }
        e.set_kn_voice_volume(None).unwrap();
        assert_eq!(collect(&mut e, 3), ["NaN", "NaN", "false"]);
        let mut e = vm(&p, jit);
        e.set_kn_voice_volume(Some(0.0)).unwrap();
        assert_eq!(collect(&mut e, 3), ["0", "1", "false"]);
    }
}

#[test]
fn microphone_updates_each_frame_validates_samples_and_clears_on_restart() {
    let p = project(vec![
        json!({"type":"repeat_n_times","inputs":{"times":num(3.0)},"statements":{"DO":log(json!({"type":"get_voice_volume"}))}}),
    ]);
    for jit in [false, true] {
        let mut e = vm(&p, jit);
        e.set_kn_voice_volume(Some(25.0)).unwrap();
        assert_eq!(collect(&mut e, 1), ["25"]);
        e.set_kn_voice_pending();
        for _ in 0..3 {
            assert!(step(&mut e).is_empty());
        }
        e.set_kn_voice_volume(Some(100.0)).unwrap();
        assert_eq!(collect(&mut e, 1), ["100"]);
        e.set_kn_voice_volume(None).unwrap();
        assert_eq!(collect(&mut e, 1), ["NaN"]);
        for n in [-1.0, 101.0, f64::NAN, f64::INFINITY] {
            assert!(e.set_kn_voice_volume(Some(n)).is_err());
        }
        e.set_kn_voice_volume(Some(75.0)).unwrap();
        e.start();
        for _ in 0..3 {
            assert!(
                step(&mut e).is_empty(),
                "restart must clear the settled sample"
            );
        }
        e.set_kn_voice_volume(None).unwrap();
        assert_eq!(collect(&mut e, 1), ["NaN"]);
    }
}

#[test]
fn hot_loop_reads_current_host_sample_instead_of_hoisting_or_reusing_it() {
    let p = project(vec![
        json!({"type":"repeat_n_times","inputs":{"times":num(80.0)},"statements":{"DO":log(json!({"type":"get_voice_volume"}))}}),
    ]);
    for jit in [false, true] {
        let mut e = vm(&p, jit);
        for n in 0..80 {
            e.set_kn_voice_volume(Some(n as f64)).unwrap();
            assert_eq!(collect(&mut e, 1), [n.to_string()]);
        }
    }
}
