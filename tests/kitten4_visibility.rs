use nekoc::{engine::Engine, engine::Program, kitten4};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::time::Duration;

struct Vm {
    engine: Engine,
    sprites: BTreeMap<String, (bool, f64)>,
}

impl Vm {
    fn after(&self) -> String {
        self.engine.variable_text("after")
    }
}

fn project(mode: &str, target: &str, time: Option<f64>) -> Value {
    let mut params = json!({"type":mode,"sprite":target});
    if let Some(time) = time {
        params["time"] = json!({"id":"duration","type":"math_number","params":{"NUM":time}});
    }
    json!({"version":25,"work_type":"KITTEN","size":{"width":640,"height":360},
        "variables":{"after":{"id":"after","name":"after","is_global":true,"value":0}},
        "audio":{},"theatre":{"current_scene":"s","scenes_order":["s"],
            "scenes":{"s":{"id":"s","actors":["a","b","c"]}},
            "actors":{"a":{"id":"a","visible":true},"b":{"id":"b","visible":false},"c":{"id":"c","visible":true}},
            "styles":{},"groups":{"g":{"id":"g","actors":["b","c"]}}},
        "compile_result":[{"id":"a","compiled_block_map":{"hat":{
            "id":"hat","type":"start_on_click","params":{},"next_block":{
                "id":"visibility","type":"set_entity_show_hide","params":params,
                "next_block":{"id":"after-set","type":"variables_set","params":{
                    "VAR":"after","VALUE":{"id":"one","type":"math_number","params":{"NUM":1}}}}}}}}]
    })
}

fn engine(source: &Value, interpreted: bool) -> Vm {
    let canonical = kitten4::to_neko(source).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), *source);
    let mut vm = Engine::new(Program::compile(&canonical).unwrap());
    if interpreted {
        vm.disable_jit();
    }
    vm.use_virtual_clock();
    vm.start();
    Vm {
        engine: vm,
        sprites: BTreeMap::new(),
    }
}

fn tick(vm: &mut Vm) {
    let frame = vm
        .engine
        .advance(1.0 / 60.0, 100_000, Duration::from_secs(2))
        .unwrap();
    for sprite in frame.sprites {
        vm.sprites
            .insert(sprite.id, (sprite.visible, sprite.opacity));
    }
}

fn sprite(vm: &Vm, id: &str) -> (bool, f64) {
    vm.sprites[id]
}

// Official Tn6a/F::set_entity_show_hide resolves the group once and calls f
// for every member; f without time/with zero time calls set_visibility directly.
#[test]
fn visibility_targets_actor_group_or_scene_not_caller() {
    for interpreted in [true, false] {
        for (target, mode, affected) in [
            ("b", "show", vec!["b"]),
            ("g", "hide", vec!["b", "c"]),
            ("s", "hide", vec!["s"]),
        ] {
            let source = project(mode, target, None);
            let report = kitten4::coverage_with_seed(&source, 1, Some(1));
            assert!(report["stubbed"].get("set_entity_show_hide").is_none());
            let mut vm = engine(&source, interpreted);
            tick(&mut vm);
            assert!(sprite(&vm, "a").0);
            for id in affected {
                assert_eq!(sprite(&vm, id).0, mode == "show", "{target}/{mode}/{id}");
            }
            assert_eq!(vm.after(), "1");
        }
    }
}

// Tn6a/F::f: showing an already visible target does not block. Hidden
// Hide targets fade towards opacity 0 (native alpha), then restore opacity 1.
#[test]
fn gradual_group_visibility_blocks_caller_and_updates_members_together() {
    for interpreted in [true, false] {
        let mut vm = engine(&project("grad_hide", "g", Some(0.1)), interpreted);
        tick(&mut vm);
        assert_eq!(vm.after(), "0");
        assert!(sprite(&vm, "c").0);
        for _ in 0..3 {
            tick(&mut vm);
        }
        let (_, opacity) = sprite(&vm, "c");
        assert!(opacity > 0.0 && opacity < 1.0, "{opacity}");
        for _ in 0..10 {
            tick(&mut vm);
        }
        assert_eq!(sprite(&vm, "b"), (false, 1.0));
        assert_eq!(sprite(&vm, "c"), (false, 1.0));
        assert_eq!(vm.after(), "1");
        let mut vm = engine(&project("grad_show", "c", Some(100.0)), interpreted);
        tick(&mut vm);
        assert_eq!(vm.after(), "1");
        let mut vm = engine(&project("grad_show", "b", Some(0.1)), interpreted);
        for _ in 0..12 {
            tick(&mut vm);
        }
        assert_eq!(sprite(&vm, "b"), (true, 1.0));
        assert_eq!(vm.after(), "1");
    }
}

#[test]
fn workspace_visibility_preserves_group_and_roundtrips() {
    let mut source = project("hide", "g", None);
    source.as_object_mut().unwrap().remove("compile_result");
    source["theatre"]["actors"]["a"]["block_data_json"] = json!({
        "blocks":{
            "hat":{"id":"hat","type":"start_on_click","fields":{}},
            "visibility":{"id":"visibility","type":"set_entity_show_hide",
                "fields":{"sprite":"g","type":"hide"}}},
        "connections":{"hat":{"visibility":{"type":"next"}}}
    });
    for interpreted in [true, false] {
        let mut vm = engine(&source, interpreted);
        tick(&mut vm);
        assert_eq!(sprite(&vm, "b"), (false, 1.0));
        assert_eq!(sprite(&vm, "c"), (false, 1.0));
        assert!(sprite(&vm, "a").0);
    }
}

#[test]
fn deleted_visibility_target_keeps_existing_missing_reference_policy() {
    let source = project("hide", "deleted-target", None);
    let canonical = kitten4::to_neko(&source).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), source);
    // Preserve the pre-existing generic deleted-reference lowering. Exact
    // official handling of dangling UUIDs is not established by this probe.
    let mut vm = engine(&source, true);
    tick(&mut vm);
    assert_eq!(vm.after(), "1");
}
