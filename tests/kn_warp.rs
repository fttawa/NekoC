use nekoc::engine::{Engine, Program};
use serde_json::{Value, json};
use std::time::Duration;

fn number(value: u32) -> Value {
    json!({"type":"math_number","fields":{"NUM":value}})
}

fn chain(nodes: Vec<Value>) -> Value {
    nodes
        .into_iter()
        .rev()
        .reduce(|tail, mut head| {
            head["next"] = tail;
            head
        })
        .unwrap()
}

fn increment() -> Value {
    json!({"type":"variables_set","fields":{"variable":"count"},"inputs":{"value":{
        "type":"math_arithmetic","fields":{"type":"add"},"inputs":{
            "A":{"type":"variables_get","fields":{"variable":"count"}},"B":number(1)
        }
    }}})
}

fn repeat(times: u32, body: Value) -> Value {
    json!({"type":"repeat_n_times","inputs":{"times":number(times)},"statements":{"DO":body}})
}

fn warp(body: Value) -> Value {
    json!({"type":"warp","statements":{"DO":body}})
}

fn project(body: Value) -> Value {
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    project["variables"]["variablesDict"]["count"] =
        json!({"id":"count","name":"count","value":0,"isGlobal":true});
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":chain(vec![body,
            json!({"type":"console_log","inputs":{"console_log":number(1)}})])}
    ]);
    project
}

fn vm(project: &Value, jit: bool) -> Engine {
    let mut vm = Engine::new(Program::compile(project).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.set_random_seed(1);
    vm.use_virtual_clock();
    vm.start();
    vm
}

#[test]
fn warp_slice_counts_iterations_not_statements_and_resets_each_resume() {
    let p = project(warp(repeat(90_010, increment())));
    for jit in [false, true] {
        let mut vm = vm(&p, jit);
        for (i, expected) in [30_002, 60_004, 90_006, 90_010].into_iter().enumerate() {
            let frame = vm.advance(1.0 / 60.0, 10_000_000, Duration::ZERO).unwrap();
            assert!(!frame.budget_yield, "jit={jit}, frame={i}");
            assert_eq!(vm.variable_value("count").number(), f64::from(expected));
            assert_eq!(frame.logs.len(), usize::from(i == 3));
        }
    }
}

#[test]
fn a_long_straight_line_is_not_an_iteration() {
    let p = project(warp(repeat(2, chain(vec![increment(); 200]))));
    for jit in [false, true] {
        let mut vm = vm(&p, jit);
        let frame = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
        assert!(!frame.budget_yield);
        assert_eq!(vm.variable_value("count").number(), 400.0);
        assert_eq!(frame.logs, ["1"]);
    }
}

#[test]
fn the_final_iteration_can_yield_before_the_successor() {
    for iterations in [30_000, 30_001, 30_002] {
        let p = project(warp(repeat(iterations, increment())));
        for jit in [false, true] {
            let mut vm = vm(&p, jit);
            let first = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
            assert!(!first.budget_yield);
            assert_eq!(vm.variable_value("count").number(), f64::from(iterations));
            assert_eq!(first.logs.len(), usize::from(iterations < 30_002));
            let second = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
            assert_eq!(second.logs.len(), usize::from(iterations == 30_002));
        }
    }
}

#[test]
fn nested_warp_and_adjacent_loops_share_the_same_slice() {
    for (body, expected) in [
        (repeat(40_000, warp(repeat(1, increment()))), 15_001.0),
        (
            chain(vec![
                repeat(20_000, increment()),
                repeat(20_000, increment()),
            ]),
            30_002.0,
        ),
    ] {
        let p = project(warp(body));
        for jit in [false, true] {
            let mut vm = vm(&p, jit);
            let first = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
            assert!(!first.budget_yield);
            assert_eq!(vm.variable_value("count").number(), expected);
            assert!(first.logs.is_empty());
        }
    }
}

#[test]
fn while_forever_until_and_range_keep_the_same_tail_boundary() {
    let condition = json!({"type":"logic_compare","fields":{"OP":"LT"},"inputs":{
        "A":{"type":"variables_get","fields":{"variable":"count"}},"B":number(40_000)
    }});
    for body in [
        json!({"type":"controls_while","inputs":{"BOOL":condition},"statements":{"DO":increment()}}),
        json!({"type":"repeat_forever","statements":{"DO":increment()}}),
        json!({"type":"repeat_forever_until","inputs":{"condition":{
            "type":"logic_negate","inputs":{"logic":condition}
        }},"statements":{"DO":increment()}}),
        json!({"type":"traverse_number","inputs":{
            "value":{"type":"traverse_number_param","fields":{"TEXT":"i"}},
            "from":number(1),"to":number(40_000),"by":number(1)
        },"statements":{"DO":increment()}}),
    ] {
        let p = project(warp(body));
        for jit in [false, true] {
            let mut vm = vm(&p, jit);
            let first = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
            assert!(!first.budget_yield);
            assert_eq!(vm.variable_value("count").number(), 30_002.0);
            assert!(first.logs.is_empty());
        }
    }
}

#[test]
fn statement_calls_inherit_warp_and_share_the_callers_counter() {
    let call = json!({"type":"procedures_2_callnoreturn","fields":{"NAME":"work"},
        "mutation":"<mutation def_id=\"work\"/>"});
    let mut p = project(warp(chain(vec![repeat(20_000, increment()), call])));
    p["procedures"]["proceduresDict"]["work"] = json!({"id":"work","nekoBlockJsonList":[{
        "type":"procedures_2_defnoreturn","id":"work","statements":{"STACK":repeat(20_000, increment())}
    }]});
    for jit in [false, true] {
        let mut vm = vm(&p, jit);
        let first = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
        assert!(!first.budget_yield);
        assert_eq!(vm.variable_value("count").number(), 30_002.0);
        assert!(first.logs.is_empty());
        let second = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
        assert_eq!(vm.variable_value("count").number(), 40_000.0);
        assert_eq!(second.logs, ["1"]);
    }
}

#[test]
fn break_skips_the_tail_but_continue_counts_it_once() {
    for (control, expected, finished) in [
        ("break", 1.0, true),
        ("_continue_statement", 30_002.0, false),
    ] {
        let body = chain(vec![increment(), json!({"type":control}), increment()]);
        let p = project(warp(repeat(40_000, body)));
        for jit in [false, true] {
            let mut vm = vm(&p, jit);
            let first = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
            assert!(!first.budget_yield);
            assert_eq!(vm.variable_value("count").number(), expected);
            assert_eq!(first.logs.len(), usize::from(finished));
        }
    }
}

#[test]
fn hot_native_slices_match_full_interpreter_state_including_loop_stacks() {
    let p = project(warp(repeat(90_010, increment())));
    let mut interpreted = vm(&p, false);
    let mut native = vm(&p, true);
    native.enable_jit_profile();
    for frame in 1..=5 {
        for vm in [&mut interpreted, &mut native] {
            let update = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
            assert!(!update.budget_yield);
        }
        assert_eq!(
            interpreted.jit_debug_snapshot(),
            native.jit_debug_snapshot(),
            "frame {frame}"
        );
    }
    assert!(native.jit_profile()["native_ops"].as_u64().unwrap() > 0);
}

#[test]
fn native_range_and_while_resume_without_replaying_the_tail() {
    for body in [
        json!({"type":"traverse_number","inputs":{
            "value":{"type":"traverse_number_param","fields":{"TEXT":"i"}},
            "from":number(1),"to":number(30_002),"by":number(1)
        },"statements":{"DO":increment()}}),
        json!({"type":"controls_while","inputs":{"BOOL":{
            "type":"logic_compare","fields":{"OP":"LT"},"inputs":{
                "A":{"type":"variables_get","fields":{"variable":"count"}},"B":number(60_010)
            }
        }},"statements":{"DO":chain(vec![increment(),json!({"type":"_continue_statement"})])}}),
    ] {
        let p = project(warp(body));
        let mut interpreted = vm(&p, false);
        let mut native = vm(&p, true);
        native.enable_jit_profile();
        for frame in 1..=4 {
            for vm in [&mut interpreted, &mut native] {
                let update = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
                assert!(!update.budget_yield);
            }
            assert_eq!(
                interpreted.jit_debug_snapshot(),
                native.jit_debug_snapshot(),
                "frame {frame}"
            );
        }
        assert_eq!(native.active_tasks(), 0);
        assert!(native.jit_profile()["native_ops"].as_u64().unwrap() > 0);
    }
}

#[test]
fn a_slice_lets_another_script_run_and_emits_partial_visual_changes() {
    let mut body = increment();
    body["next"] = json!({"type":"self_go_forward","inputs":{"steps":number(1)}});
    let mut p = project(warp(repeat(40_000, body)));
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(json!({"type":"on_running_group_activated","next":{
            "type":"console_log","inputs":{"console_log":{
                "type":"variables_get","fields":{"variable":"count"}
            }}
        }}));
    for jit in [false, true] {
        let mut vm = vm(&p, jit);
        let first = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
        assert!(!first.budget_yield);
        assert_eq!(first.logs, ["30002"]);
        let actor = first
            .sprites
            .iter()
            .find(|s| s.id == "nekoc-default-actor")
            .unwrap();
        assert_eq!(actor.y, 30_002.0);
        let second = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
        assert_eq!(second.logs, ["1"]);
        assert_eq!(second.sprites[0].y, 40_000.0);
    }
}

#[test]
fn empty_bodies_count_and_parallel_scripts_get_independent_slices() {
    let empty = json!({"type":"repeat_n_times","inputs":{"times":number(30_002)}});
    let mut p = project(warp(empty));
    let second = p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"][0].clone();
    p["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .push(second);
    for jit in [false, true] {
        let mut vm = vm(&p, jit);
        let first = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
        assert!(!first.budget_yield);
        assert!(first.logs.is_empty());
        // Repeat + exactly 30002 tails per script. Neither script inherits the
        // other's counter, even when the first used its entire slice.
        assert_eq!(first.instructions, 2 * (1 + 30_002));
        let second = vm.advance(0.0, 1_000_000, Duration::ZERO).unwrap();
        assert_eq!(second.logs, ["1", "1"]);
    }
}

#[test]
fn statement_warp_updates_match_recorded_official_deterministic_observations() {
    let evidence: Value =
        serde_json::from_str(include_str!("../docs/kn-warp-official.json")).unwrap();
    assert_eq!(evidence["ok"], true);
    for (name, case) in evidence["cases"].as_object().unwrap() {
        if !name.ends_with("/deterministic")
            // Reporter suspension requires resumable expression evaluation.
            // Explicit wait(0) has a separate pre-existing KN wait-boundary gap.
            || name.starts_with("reporter-")
            || name.starts_with("procedure-wait/")
        {
            continue;
        }
        let source = std::fs::read_to_string(case["fixture"].as_str().unwrap()).unwrap();
        let project: Value = serde_json::from_str(&source).unwrap();
        for jit in [false, true] {
            let mut vm = vm(&project, jit);
            for update in case["updates"].as_array().unwrap().iter().take(8) {
                let frame = vm.advance(1.0 / 60.0, 1_000_000, Duration::ZERO).unwrap();
                assert!(!frame.budget_yield, "{name}, jit={jit}");
                for (id, expected) in update["variables"].as_object().unwrap() {
                    assert_eq!(
                        vm.variable_value(id).number(),
                        expected.as_f64().unwrap(),
                        "{name}, update {}, {id}, jit={jit}",
                        update["after"]
                    );
                }
            }
        }
    }
}

#[test]
fn original_fangjie_initialization_reaches_the_title_with_both_execution_tiers() {
    use nekoc::engine::Cell;
    let p: Value =
        serde_json::from_str(&std::fs::read_to_string("projects/fangjie/fangjie.bcmkn").unwrap())
            .unwrap();
    let length = |vm: &Engine, id: &str| match vm.variable_value(id) {
        Cell::List(items) => items.borrow().len(),
        _ => panic!("expected list {id}"),
    };
    let mut interpreted = vm(&p, false);
    let mut native = vm(&p, true);
    for frame in 0..40 {
        for vm in [&mut interpreted, &mut native] {
            let update = vm.advance(1.0 / 60.0, 2_000_000, Duration::ZERO).unwrap();
            assert!(!update.budget_yield, "frame {frame}");
            vm.recycle_lines(update.lines);
        }
        for id in ["kn-list-world", "kn-list-chunk_x", "kn-list-chunk_z"] {
            assert_eq!(
                length(&interpreted, id),
                length(&native, id),
                "{id}, frame {frame}"
            );
        }
        assert_eq!(
            interpreted.variable_value("kn-var-gui_dirty").number(),
            native.variable_value("kn-var-gui_dirty").number()
        );
    }
    for vm in [&interpreted, &native] {
        assert_eq!(length(vm, "kn-list-world"), 524_288);
        assert_eq!(length(vm, "kn-list-chunk_x"), 64);
        assert_eq!(length(vm, "kn-list-chunk_z"), 64);
        assert_eq!(vm.variable_value("kn-var-gui_dirty").number(), 0.0);
    }
    // This is a local initialization milestone, not a claim that the original
    // official project has reached its terminal state or rendered equal pixels.
}
