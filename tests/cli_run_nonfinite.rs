//! JSON observations, not a change to the language's numeric semantics.
use nekoc::{cli_run, cloud::CloudOptions};
use serde_json::{Value, json};

fn number(n: f64) -> Value {
    json!({"type":"math_number","fields":{"NUM":n}})
}

fn divide(a: f64, b: f64) -> Value {
    json!({"type":"math_arithmetic","fields":{"type":"divide"},
        "inputs":{"A":number(a),"B":number(b)}})
}

#[test]
fn run_json_distinguishes_nan_and_both_infinities_from_null() {
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    let values = [
        ("nan", divide(0.0, 0.0), json!("NaN")),
        ("positive", divide(1.0, 0.0), json!("Infinity")),
        ("negative", divide(-1.0, 0.0), json!("-Infinity")),
        ("finite", divide(7.0, 2.0), json!(3.5)),
        (
            "text",
            json!({"type":"text","fields":{"TEXT":"null"}}),
            json!("null"),
        ),
    ];
    let mut body = Value::Null;
    for (id, expression, _) in values.iter().rev() {
        project["variables"]["variablesDict"][id] =
            json!({"id":id,"name":id,"isGlobal":true,"value":0});
        let mut block = json!({"type":"variables_set","fields":{"variable":id},
            "inputs":{"value":expression}});
        if !body.is_null() {
            block["next"] = body;
        }
        body = block;
    }
    project["variables"]["variablesDict"]["private"] = json!({
        "id":"private","name":"private","value":0,
        "isGlobal":false,"currentEntityId":"nekoc-default-actor"
    });
    body = json!({"type":"variables_set","fields":{"variable":"private"},
        "inputs":{"value":divide(-1.0, 0.0)},"next":body});
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] =
        json!([{"type":"on_running_group_activated","next":body}]);
    let result = cli_run::run(&project, 1, &[], 1, &CloudOptions::default()).unwrap();
    let encoded = serde_json::to_string(&result).unwrap();
    let decoded: Value = serde_json::from_str(&encoded).unwrap();
    for (id, _, expected) in values {
        assert_eq!(decoded["variables"][id], expected, "{id}: {encoded}");
    }
    assert_eq!(
        decoded["actors"]["nekoc-default-actor"]["variables"]["private"], "-Infinity",
        "{encoded}"
    );
}

#[test]
fn run_json_preserves_nonfinite_numbers_in_nested_objects_and_lists() {
    let mut project = nekoc::studio::document::Document::blank().value().clone();
    project["variables"]["variablesDict"]["nested"] =
        json!({"id":"nested","value":0,"isGlobal":true});
    project["variables"]["variablesDict"]["items"] =
        json!({"id":"items","value":[],"type":"list","isGlobal":true});
    let object = json!({"type":"_object_literal","inputs":{
        "key0":{"type":"text","fields":{"TEXT":"nan"}},"value0":divide(0.0, 0.0),
        "key1":{"type":"text","fields":{"TEXT":"positive"}},"value1":divide(1.0, 0.0)
    }});
    project["actors"]["actorsDict"]["nekoc-default-actor"]["nekoBlockJsonList"] = json!([
        {"type":"on_running_group_activated","next":{
            "type":"variables_set","fields":{"variable":"nested"},"inputs":{"value":object},
            "next":{"type":"list_append","inputs":{
                "list":{"type":"pure_list_get","fields":{"list":"items"}},
                "list_item_value":{"type":"variables_get","fields":{"variable":"nested"}}
            }}
        }}
    ]);
    let result = cli_run::run(&project, 1, &[], 1, &CloudOptions::default()).unwrap();
    let expected = json!({"nan":"NaN","positive":"Infinity"});
    assert_eq!(result["variables"]["nested"], expected);
    assert_eq!(result["lists"]["items"], json!([expected]));
}
