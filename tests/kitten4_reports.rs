use serde_json::json;

#[test]
fn native_inspection_counts_flat_workspaces_and_keeps_numeric_version() {
    let project = json!({"version":25,"work_type":"KITTEN","project_name":"test",
        "size":{"width":900,"height":620},"variables":{},"audio":{},
        "theatre":{"scenes":{"s":{"id":"s","actors":["a"],"block_data_json":{"blocks":{},"connections":{}}}},
        "actors":{"a":{"id":"a","block_data_json":{"blocks":{
            "hat":{"id":"hat","type":"on_running_group_activated"},
            "move":{"id":"move","type":"self_go_forward"}},
            "connections":{"hat":{"move":{"type":"next"}}}}}},"styles":{}}});
    let report = nekoc::inspect::build_report(&project, 123).unwrap();
    assert_eq!(report["format"], "kitten4-bcm-json");
    assert_eq!(report["version"], 25);
    assert_eq!(report["counts"]["actors"], 1);
    assert_eq!(report["blocks"]["total_blocks"], 2);
    assert_eq!(report["blocks"]["total_top_level_items"], 1);
    assert_eq!(report["byte_len"], 123);
}

#[test]
fn native_validation_does_not_silently_accept_an_incomplete_project() {
    for project in [
        json!({"work_type":"KITTEN","version":25,"theatre":{}}),
        json!({"work_type":"KITTEN","version":25}),
    ] {
        let report = nekoc::validate::build_report(&project).unwrap();
        assert_eq!(report["ok"], false, "{report}");
    }
}
