use nekoc::{bcmkn_compiler, project, ts_frontend};
use serde_json::{Value, json};
use std::fs;
use tempfile::tempdir;

fn template() -> Value {
    project::load_project("samples/kitten-n-0.27.4.bcmkn")
        .unwrap()
        .value
        .into_value()
}

fn with_existing() -> Value {
    let mut p = template();
    p["variables"]["variablesDict"] = json!({
        "native-variable-id": {"id":"native-variable-id", "name":"shared", "type":"number", "value":17},
        "native-list-id": {"id":"native-list-id", "name":"shared", "type":"list", "value":[23]},
        "other-variable-id": {"id":"other-variable-id", "name":"native-variable-id", "type":"number", "value":99},
        "other-list-id": {"id":"other-list-id", "name":"native-list-id", "type":"list", "value":[99]}
    });
    p
}

fn compile(source: &str, base: &Value, module: &str) -> (Value, Value) {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let workspace = dir.path().join("workspace.json");
    let template_path = dir.path().join("template.bcmkn");
    let output = dir.path().join("output.bcmkn");
    fs::write(&input, source).unwrap();
    fs::write(dir.path().join("helpers.ts"), module).unwrap();
    fs::write(&template_path, base.to_string()).unwrap();
    ts_frontend::compile_ts(&input, &workspace).unwrap();
    let report = serde_json::from_slice(&fs::read(workspace).unwrap()).unwrap();
    bcmkn_compiler::compile_workspace_bcmkn(&report, input, template_path, &output).unwrap();
    (
        report,
        project::load_project(output).unwrap().value.into_value(),
    )
}

fn fields<'a>(value: &'a Value, field: &str) -> Vec<&'a str> {
    let mut result = Vec::new();
    match value {
        Value::Object(map) => {
            if let Some(text) = value["fields"][field].as_str() {
                result.push(text);
            }
            for child in map.values() {
                result.extend(fields(child, field));
            }
        }
        Value::Array(items) => {
            for child in items {
                result.extend(fields(child, field));
            }
        }
        _ => {}
    }
    result
}

#[test]
fn literal_id_paths_preserve_existing_typed_ids_before_names() {
    // Each API copies its string argument to a field, including list shadows.
    let variable_calls = [
        "setVar(REF, 1)",
        "setVar(REF, getVar(REF))",
        "changeVar(REF, 2)",
        "changeVar(REF, -2)",
        "changeVar(REF, getVar(REF))",
        "showVariable(REF)",
        "hideVariable(REF)",
        "self.setVar(REF, self.getVar(REF))",
        "self.changeVar(REF, 1)",
        "self.showVariable(REF)",
        "self.hideVariable(REF)",
        "self.var(REF).set(self.var(REF).get())",
        "self.var(REF).change(1)",
        "self.var(REF).show()",
        "self.var(REF).hide()",
    ];
    let list_calls = [
        "showList(REF)",
        "hideList(REF)",
        "setVar(\"result\", getList(REF))",
        "appendList(REF, 1)",
        "insertList(REF, 1, 2)",
        "replaceListItem(REF, \"index\", 1, 2)",
        "deleteListItem(REF, \"index\", 1)",
        "copyList(REF, REF)",
        "setVar(\"result\", listItem(REF, \"index\", 1))",
        "setVar(\"result\", listLength(REF))",
        "setVar(\"result\", listIndexOf(REF, 1))",
        "setVar(\"result\", listContains(REF, 1))",
        "self.list(REF).show()",
        "self.list(REF).hide()",
        "self.list(REF).add(1)",
        "self.list(REF).append(1)",
        "self.list(REF).insert(1, 2)",
        "self.list(REF).replace(\"index\", 1, 2)",
        "self.list(REF).delete(\"index\", 1)",
        "self.list(REF).remove(\"index\", 1)",
        "self.list(REF).copyTo(REF)",
        "setVar(\"result\", self.list(REF).get())",
        "setVar(\"result\", self.list(REF).item(\"index\", 1))",
        "setVar(\"result\", self.list(REF).length())",
        "setVar(\"result\", self.list(REF).indexOf(1))",
        "setVar(\"result\", self.list(REF).contains(1))",
    ];
    for (field, id, calls) in [
        ("variable", "native-variable-id", variable_calls.as_slice()),
        ("list", "native-list-id", list_calls.as_slice()),
    ] {
        for call in calls {
            let source = format!(
                "onStart(() => {{ {}; }});",
                call.replace("REF", &format!("{id:?}"))
            );
            let (report, p) = compile(&source, &with_existing(), "");
            assert!(fields(&report, field).contains(&id), "{source}");
            let resolved = fields(&p, field);
            assert!(resolved.contains(&id), "{source}: {resolved:?}");
            assert!(
                !resolved.contains(&if field == "list" {
                    "other-list-id"
                } else {
                    "other-variable-id"
                }),
                "{source}"
            );
            let dict = p["variables"]["variablesDict"].as_object().unwrap();
            assert!(!dict.contains_key(&format!("kn-var-{id}")), "{source}");
            assert!(!dict.contains_key(&format!("kn-list-{id}")), "{source}");
            assert_eq!(dict[id], with_existing()["variables"]["variablesDict"][id]);
        }
    }
}

#[test]
fn ids_without_name_aliases_do_not_create_phantom_entries() {
    let mut base = with_existing();
    let dict = base["variables"]["variablesDict"].as_object_mut().unwrap();
    dict.remove("other-variable-id");
    dict.remove("other-list-id");
    let (_, p) = compile(
        r#"onStart(() => { repeat(2, () => {
            setVar("native-variable-id", getVar("native-variable-id"));
            appendList("native-list-id", 1);
        }); });"#,
        &base,
        "",
    );
    assert_eq!(
        p["variables"]["variablesDict"],
        base["variables"]["variablesDict"]
    );
    assert!(
        fields(&p, "variable")
            .iter()
            .all(|id| *id == "native-variable-id")
    );
    assert!(fields(&p, "list").iter().all(|id| *id == "native-list-id"));
}

#[test]
fn ids_with_duplicate_names_are_all_recognized() {
    let mut base = with_existing();
    base["variables"]["variablesDict"]["other-variable-id"]["name"] = json!("shared");
    base["variables"]["variablesDict"]["other-list-id"]["name"] = json!("shared");
    let (_, p) = compile(
        r#"onStart(() => {
            setVar("native-variable-id", getVar("other-variable-id"));
            copyList("native-list-id", "other-list-id");
        });"#,
        &base,
        "",
    );
    assert_eq!(
        p["variables"]["variablesDict"],
        base["variables"]["variablesDict"]
    );
    for id in ["native-variable-id", "other-variable-id"] {
        assert!(fields(&p, "variable").contains(&id));
    }
    for id in ["native-list-id", "other-list-id"] {
        assert!(fields(&p, "list").contains(&id));
    }
}

#[test]
fn names_are_typed_and_hyphens_are_not_id_heuristics() {
    let (_, p) = compile(
        r#"onStart(() => {
            setVar("shared", getVar("shared")); showList("shared");
            setVar("ordinary-multi-hyphen-name", 1);
            showList("ordinary-multi-hyphen-name");
            setVar("native-list-id", 2); showList("native-variable-id");
        });"#,
        &with_existing(),
        "",
    );
    let vars = fields(&p, "variable");
    let lists = fields(&p, "list");
    assert!(vars.contains(&"native-variable-id"));
    assert!(lists.contains(&"native-list-id"));
    assert!(vars.contains(&"kn-var-ordinary-multi-hyphen-name"));
    assert!(lists.contains(&"kn-list-ordinary-multi-hyphen-name"));
    assert!(vars.contains(&"kn-var-native-list-id"));
    assert!(lists.contains(&"kn-list-native-variable-id"));
}

#[test]
fn imported_functions_and_explicit_procedures_keep_template_ids() {
    let (report, p) = compile(
        r#"import { readExisting } from "./helpers";
        defineProc("use existing", [], () => {
            setVar("native-variable-id", getVar("native-variable-id"));
            showList("native-list-id");
        });
        onStart(() => { setVar("result", readExisting()); callProc("use existing"); });"#,
        &with_existing(),
        r#"export function readExisting() { return getVar("native-variable-id") + listLength("native-list-id"); }"#,
    );
    for value in [&report, &p] {
        assert!(fields(value, "variable").contains(&"native-variable-id"));
        assert!(fields(value, "list").contains(&"native-list-id"));
    }
    let procedures = &p["procedures"]["proceduresDict"];
    assert!(fields(procedures, "variable").contains(&"native-variable-id"));
    assert!(fields(procedures, "list").contains(&"native-list-id"));
    assert!(
        !p["variables"]["variablesDict"]
            .as_object()
            .unwrap()
            .contains_key("kn-var-native-variable-id")
    );
}

#[test]
fn screen_and_sprite_callbacks_reuse_ids_created_from_initial_values() {
    // Registered resources intentionally reset template variables. Initial values
    // recreate score before global, procedure and sprite scripts are resolved.
    for wrapper in [
        "onStart(() => { BODY });",
        "sprite(\"cat\", {}, self => { onStart(() => { BODY }); });",
        "screen(\"game\", {}, () => { sprite(\"cat\", {}, self => { onStart(() => { BODY }); }); });",
    ] {
        let source = format!("let score = 17; {}", wrapper.replace("BODY", r#"setVar("score", getVar("kn-var-score")); self.var("kn-var-score").change(1); showList("local-list-with-hyphens");"#));
        let (report, p) = compile(&source, &template(), "");
        assert!(fields(&report, "variable").contains(&"kn-var-score"));
        assert!(
            fields(&p, "variable")
                .iter()
                .all(|id| *id == "kn-var-score")
        );
        assert_eq!(p["variables"]["variablesDict"]["kn-var-score"]["value"], 17);
        assert_eq!(
            p["variables"]["variablesDict"].as_object().unwrap().len(),
            2
        );
    }
}

#[test]
fn initial_value_keys_remain_names_even_when_equal_to_an_existing_id() {
    let mut base = with_existing();
    base["variables"]["variablesDict"]["native-variable-id"]["name"] = json!("score");
    base["variables"]["variablesDict"]["native_variable_id"] =
        json!({"id":"native_variable_id", "name":"different", "type":"number", "value":42});
    let (_, p) = compile("let score = 7; let native_variable_id = 9;", &base, "");
    assert_eq!(
        p["variables"]["variablesDict"]["native-variable-id"]["value"],
        7
    );
    assert_eq!(
        p["variables"]["variablesDict"]["kn-var-native_variable_id"]["value"],
        9
    );
    assert_eq!(
        p["variables"]["variablesDict"]["native_variable_id"]["value"],
        42
    );
}
