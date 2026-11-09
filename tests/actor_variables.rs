use nekoc::engine::{Engine, Program};
use serde_json::{Value, json};
use std::time::Duration;

const ACTOR: &str = "20000000-0000-4000-8000-000000000001";
const OTHER: &str = "20000000-0000-4000-8000-000000000002";
const PRIVATE: &str = "30000000-0000-4000-8000-000000000001";

fn fixture(k4: bool, deleted: bool) -> Value {
    let text = match (k4, deleted) {
        (true, false) => include_str!("fixtures/kitten4/actor-variables.bcm"),
        (true, true) => include_str!("fixtures/kitten4/actor-variables-deleted.bcm"),
        (false, false) => include_str!("fixtures/actor-variables.bcmkn"),
        (false, true) => include_str!("fixtures/actor-variables-deleted.bcmkn"),
    };
    let source: Value = serde_json::from_str(text).unwrap();
    if k4 {
        let canonical = nekoc::kitten4::to_neko(&source).unwrap();
        assert_eq!(nekoc::kitten4::from_neko(&canonical).unwrap(), source);
        canonical.into_value()
    } else {
        let (imported, report) = nekoc::bcmkn::import(source.clone()).unwrap();
        assert_eq!(
            *imported, source,
            "KN import must preserve private metadata"
        );
        assert_eq!(report["fast_runtime_ready"], true);
        imported.into_value()
    }
}

fn run(vm: &mut Engine, frames: usize) -> anyhow::Result<()> {
    for _ in 0..frames {
        let frame = vm.advance(1.0 / 60.0, 1_000_000, Duration::from_secs(2))?;
        vm.recycle_lines(frame.lines);
    }
    Ok(())
}

#[test]
fn official_scalar_inheritance_isolation_and_cross_actor_read() {
    for k4 in [false, true] {
        for jit in [false, true] {
            let project = fixture(k4, false);
            let original = project.clone();
            let mut vm = Engine::new(Program::compile(&project).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            run(&mut vm, 90).unwrap();
            for (id, expected) in [
                ("inherited", "41"),
                ("cloneChanged", "99"),
                ("original", "41"),
                ("cloneRead", "99"),
                ("otherRead", "other-value"),
                ("done", "1"),
            ] {
                assert_eq!(vm.variable_text(id), expected, "k4={k4}, jit={jit}, {id}");
            }
            assert!(!vm.program.variable_names.iter().any(|id| id == PRIVATE));
            assert_eq!(project, original, "compilation must not mutate export data");
        }
    }
}

#[test]
fn deleted_clone_read_matches_each_official_runtime() {
    for k4 in [false, true] {
        for jit in [false, true] {
            let mut vm = Engine::new(Program::compile(&fixture(k4, true)).unwrap());
            if !jit {
                vm.disable_jit();
            }
            vm.start();
            let result = run(&mut vm, 90);
            if k4 {
                assert!(result.unwrap_err().to_string().contains("clone_not_found"));
            } else {
                result.unwrap();
                assert_eq!(vm.variable_text("afterDelete"), "NaN");
                assert_eq!(vm.variable_text("done"), "1");
            }
        }
    }
}

fn set(id: &str, value: Value) -> Value {
    json!({"type":"variables_set","fields":{"variable":id},"inputs":{"value":value}})
}
fn num(value: i32) -> Value {
    json!({"type":"math_number","fields":{"NUM":value}})
}
fn get(id: &str) -> Value {
    json!({"type":"variables_get","fields":{"variable":id}})
}
fn chain(items: Vec<Value>) -> Value {
    items
        .into_iter()
        .rev()
        .reduce(|next, mut item| {
            item["next"] = next;
            item
        })
        .unwrap()
}

#[test]
fn actor_changes_tell_context_nested_lists_and_restart_are_independent() {
    let mut project = fixture(false, false);
    project["variables"]["variablesDict"][PRIVATE]["value"] = json!([[7]]);
    project["actors"]["actorsDict"][OTHER]["nekoBlockJsonList"] = json!([]);
    project["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next": chain(vec![
            json!({"type":"mirror","fields":{"sprite":"--self"}}),
            json!({"type":"wait","inputs":{"time":num(1)}}),
            set("original", get(PRIVATE)),
        ])},
        {"type":"start_as_a_mirror","statements":{"DO":chain(vec![
            json!({"type":"list_append","inputs":{"list":{"type":"list_item","fields":{"item":"any"},"inputs":{"list":get(PRIVATE),"list_index":num(1)}},"list_item_value":num(8)}}),
            set("cloneRead", get(PRIVATE)),
        ])}}
    ]);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    for _ in 0..2 {
        vm.start();
        run(&mut vm, 90).unwrap();
        assert_eq!(vm.variable_text("original"), "7");
        assert_eq!(vm.variable_text("cloneRead"), "7,8");
    }
    // Tell uses the target entity's live cells, not the caller's cells or globals.
    let private_other = "30000000-0000-4000-8000-000000000002";
    project["variables"]["variablesDict"][private_other]["value"] = json!(10);
    project["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":chain(vec![
            json!({"type":"sync_tell","fields":{"sprite":OTHER},"statements":{"DO":chain(vec![
                json!({"type":"change_variables","fields":{"variable":private_other,"method":"increase"},"inputs":{"value":num(3)}}),
                set("otherRead", get(private_other))
            ])}}),
            set("done", num(1))
        ])}
    ]);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    run(&mut vm, 90).unwrap();
    assert_eq!(vm.variable_text("otherRead"), "13");
    assert_eq!(vm.variable_text("done"), "1");
}

#[test]
fn wrong_entity_cannot_access_or_create_another_actors_private_cell() {
    for write in [false, true] {
        let mut project = fixture(false, false);
        project["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([]);
        project["actors"]["actorsDict"][OTHER]["nekoBlockJsonList"] = json!([
            {"type":"on_running_group_activated","next":if write { set(PRIVATE, num(55)) } else { set("done", get(PRIVATE)) }}
        ]);
        let mut vm = Engine::new(Program::compile(&project).unwrap());
        vm.start();
        assert!(
            run(&mut vm, 2)
                .unwrap_err()
                .to_string()
                .contains("entity_variable_operation_out_of_scope")
        );
    }
}

#[test]
fn private_numeric_loop_and_global_loop_agree_with_and_without_jit() {
    let mut project = fixture(false, false);
    project["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":{"type":"warp","statements":{"DO":chain(vec![
            set(PRIVATE, num(0)),
            { let mut repeat = json!({"type":"repeat_n_times","inputs":{"times":num(10000)},"statements":{"DO":chain(vec![
                json!({"type":"change_variables","fields":{"variable":PRIVATE},"inputs":{"value":num(2)}}),
                set("inherited", json!({"type":"math_arithmetic","fields":{"type":"add"},"inputs":{"A":get(PRIVATE),"B":num(1)}})),
                json!({"type":"change_variables","fields":{"variable":"done"},"inputs":{"value":num(1)}})
            ])}}); repeat["id"] = json!("private-loop"); repeat },
            set("original", get(PRIVATE))
        ])}}}
    ]);
    let mut snapshots = vec![];
    for jit in [false, true] {
        let mut vm = Engine::new(Program::compile(&project).unwrap());
        if !jit {
            vm.disable_jit();
        }
        vm.start();
        run(&mut vm, 5).unwrap();
        assert_eq!(vm.variable_text("original"), "20000");
        assert_eq!(vm.variable_text("inherited"), "20001");
        assert_eq!(vm.variable_text("done"), "10000");
        snapshots.push(vm.debug_snapshot());
    }
    assert_eq!(snapshots[0], snapshots[1]);
}

#[test]
fn reference_interpreter_also_isolates_private_scalars() {
    let project = fixture(false, false);
    let mut vm = nekoc::runtime::Runtime::from_project(&project).unwrap();
    vm.set_cooperative(true);
    vm.start();
    vm.run_ticks(90).unwrap();
    let snapshot = vm.snapshot();
    assert_eq!(
        snapshot.variables["inherited"],
        nekoc::runtime::RuntimeValue::Number(41.0)
    );
    assert_eq!(
        snapshot.variables["cloneChanged"],
        nekoc::runtime::RuntimeValue::Number(99.0)
    );
    assert_eq!(
        snapshot.variables["original"],
        nekoc::runtime::RuntimeValue::Number(41.0)
    );
    assert_eq!(
        snapshot.variables["otherRead"],
        nekoc::runtime::RuntimeValue::String("other-value".into())
    );
    assert!(!snapshot.variables.contains_key(PRIVATE));
}

#[test]
fn deleted_clone_slots_are_reinitialized_from_the_new_source() {
    let mut project = fixture(false, false);
    project["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":chain(vec![
            set(PRIVATE, num(1)),
            json!({"type":"repeat_n_times","inputs":{"times":num(20)},"statements":{"DO":chain(vec![
                json!({"type":"mirror","fields":{"sprite":"--self"}}),
                json!({"type":"wait","inputs":{"time":{"type":"math_number","fields":{"NUM":0.05}}}}),
                json!({"type":"change_variables","fields":{"variable":PRIVATE},"inputs":{"value":num(1)}})
            ])}}),
            set("original", get(PRIVATE))
        ])},
        {"type":"start_as_a_mirror","statements":{"DO":chain(vec![
            json!({"type":"change_variables","fields":{"variable":"done"},"inputs":{"value":get(PRIVATE)}}),
            set(PRIVATE, num(-100)),
            json!({"type":"dispose_clone"})
        ])}}
    ]);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    run(&mut vm, 180).unwrap();
    assert_eq!(vm.variable_text("done"), "210");
    assert_eq!(vm.variable_text("original"), "21");
    assert_eq!(vm.debug_snapshot()["actors"].as_object().unwrap().len(), 2);
}

#[test]
fn cloning_a_clone_inherits_that_clones_current_private_value() {
    let mut project = fixture(false, false);
    let index = || json!({"type":"get_current_clone_index"});
    project["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":chain(vec![
            set(PRIVATE, num(41)), json!({"type":"mirror","fields":{"sprite":"--self"}})
        ])},
        {"type":"start_as_a_mirror","statements":{"DO":{
            "type":"controls_if","inputs":{"IF0":{"type":"logic_compare","fields":{"OP":"EQ"},"inputs":{"A":index(),"B":num(1)}}},
            "statements":{
                "DO0":chain(vec![set(PRIVATE,num(99)), json!({"type":"mirror","fields":{"sprite":"--self"}})]),
                "ELSE":set("inherited",get(PRIVATE))
            }
        }}}
    ]);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    run(&mut vm, 10).unwrap();
    assert_eq!(vm.variable_text("inherited"), "99");
    assert_eq!(
        vm.debug_snapshot()["actors"][ACTOR]["variables"][PRIVATE],
        json!(41.0)
    );
}

#[test]
fn private_initial_types_and_named_list_operations_preserve_cells() {
    for initial in [json!(true), json!(null), json!("text"), json!(12.5)] {
        let mut project = fixture(false, false);
        project["variables"]["variablesDict"][PRIVATE]["value"] = initial.clone();
        project["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
            {"type":"on_running_group_activated","next":set("original", get(PRIVATE))}
        ]);
        let mut vm = Engine::new(Program::compile(&project).unwrap());
        vm.start();
        run(&mut vm, 2).unwrap();
        assert_eq!(vm.debug_snapshot()["variables"]["original"], initial);
    }

    let mut project = fixture(false, false);
    project["variables"]["variablesDict"][PRIVATE]["type"] = json!("list");
    project["variables"]["variablesDict"][PRIVATE]["value"] = json!([1]);
    let list = || json!({"type":"pure_list_get","fields":{"list":PRIVATE}});
    project["actors"]["actorsDict"][ACTOR]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":chain(vec![
            json!({"type":"mirror","fields":{"sprite":"--self"}}),
            json!({"type":"wait","inputs":{"time":num(1)}}),
            set("original", get(PRIVATE))
        ])},
        {"type":"start_as_a_mirror","statements":{"DO":chain(vec![
            json!({"type":"list_append","inputs":{"list":list(),"list_item_value":num(2)}}),
            set("cloneRead", get(PRIVATE))
        ])}}
    ]);
    let mut vm = Engine::new(Program::compile(&project).unwrap());
    vm.start();
    run(&mut vm, 90).unwrap();
    assert_eq!(vm.variable_text("original"), "1");
    assert_eq!(vm.variable_text("cloneRead"), "1,2");
    assert!(!vm.program.list_names.iter().any(|id| id == PRIVATE));
}
