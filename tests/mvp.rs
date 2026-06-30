#![recursion_limit = "512"]

use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::json;
use std::fs;
use tempfile::tempdir;

const FIXTURE: &str = r#"{
  "projectName": "fixture",
  "version": "0.27.1",
  "toolType": "KN",
  "stageSize": { "width": 562, "height": 900 },
  "scenes": {
    "scenesDict": {
      "scene-1": {
        "id": "scene-1",
        "name": "背景",
        "nekoBlockJsonList": [
          { "id": "block-1", "type": "on_running_group_activated" }
        ]
      }
    }
  },
  "actors": {
    "actorsDict": {
      "actor-1": {
        "id": "actor-1",
        "name": "角色",
        "nekoBlockJsonList": [
          { "id": "block-2", "type": "variables_set" },
          { "id": "block-3", "type": "math_number" }
        ]
      }
    }
  },
  "styles": { "stylesDict": { "style-1": { "id": "style-1" } } },
  "variables": { "variablesDict": { "var-1": { "id": "var-1" } } },
  "broadcasts": { "broadcastsDict": { "scene-1": ["Hi"] } },
  "audios": { "audiosDict": { "audio-1": { "id": "audio-1" } } },
  "procedures": { "proceduresDict": { "proc-1": { "id": "proc-1" } } }
}"#;

fn npx_command() -> &'static str {
    if cfg!(windows) { "npx.cmd" } else { "npx" }
}

#[test]
fn project_loader_rejects_invalid_json() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("invalid.bcmkn");
    fs::write(&input, "{not json").unwrap();

    let err = nekoc::project::load_project(&input).unwrap_err();

    assert!(err.to_string().contains("invalid JSON"));
}

#[test]
fn inspect_report_summarizes_fixture() {
    let value: serde_json::Value = serde_json::from_str(FIXTURE).unwrap();

    let report = nekoc::inspect::build_report(&value, 123).unwrap();

    assert_eq!(report["project_name"], "fixture");
    assert_eq!(report["version"], "0.27.1");
    assert_eq!(report["tool_type"], "KN");
    assert_eq!(report["counts"]["scenes"], 1);
    assert_eq!(report["counts"]["actors"], 1);
    assert_eq!(report["counts"]["styles"], 1);
    assert_eq!(report["counts"]["variables"], 1);
    assert_eq!(report["counts"]["broadcasts"], 1);
    assert_eq!(report["counts"]["audios"], 1);
    assert_eq!(report["counts"]["procedures"], 1);
    assert_eq!(report["blocks"]["owners"], 2);
    assert_eq!(report["blocks"]["total_top_level_items"], 3);
    assert_eq!(
        report["blocks"]["top_type_frequencies"][0],
        json!({"type": "math_number", "count": 1})
    );
}

#[test]
fn roundtrip_preserves_structural_json() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("input.bcmkn");
    let output = dir.path().join("output.bcmkn");
    fs::write(&input, FIXTURE).unwrap();

    nekoc::project::roundtrip_project(&input, &output).unwrap();

    let left = nekoc::project::load_project(&input).unwrap();
    let right = nekoc::project::load_project(&output).unwrap();
    assert_eq!(left.value, right.value);
}

#[test]
fn diff_reports_equal_and_changed_paths() {
    let equal_left: serde_json::Value = json!({"a": 1, "b": [true]});
    let equal_right: serde_json::Value = json!({"a": 1, "b": [true]});
    assert!(nekoc::diff::diff_values(&equal_left, &equal_right, 200).is_empty());

    let changed_right: serde_json::Value = json!({"a": 2, "b": []});
    let diffs = nekoc::diff::diff_values(&equal_left, &changed_right, 200);

    assert!(diffs.iter().any(|diff| diff.path == "$.a"));
    assert!(diffs.iter().any(|diff| diff.path == "$.b[0]"));
}

#[test]
fn diff_treats_roundtrip_float_rendering_as_equal() {
    let left: serde_json::Value = json!({"x": 5.684341886080803e-14});
    let right: serde_json::Value = json!({"x": 5.684341886080804e-14});

    let diffs = nekoc::diff::diff_values(&left, &right, 200);

    assert!(diffs.is_empty());
}

#[test]
fn cli_inspect_native_sample_reports_expected_counts() {
    let sample = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");
    let dir = tempdir().unwrap();
    let report = dir.path().join("native-report.json");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "inspect",
            sample.to_str().unwrap(),
            "--out",
            report.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(report).unwrap()).unwrap();
    assert_eq!(report["project_name"], "我的作品");
    assert_eq!(report["version"], "0.27.1");
    assert_eq!(report["tool_type"], "KN");
    assert_eq!(report["counts"]["scenes"], 1);
    assert_eq!(report["counts"]["actors"], 6);
    assert_eq!(report["counts"]["styles"], 7);
    assert_eq!(report["counts"]["variables"], 11);
    assert_eq!(report["counts"]["broadcasts"], 2);
    assert_eq!(report["counts"]["audios"], 0);
    assert_eq!(report["counts"]["procedures"], 0);
    assert_eq!(report["blocks"]["owners"], 7);
    assert_eq!(report["blocks"]["total_top_level_items"], 15);
}

#[test]
fn cli_roundtrip_and_diff_native_sample() {
    let sample = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");
    let dir = tempdir().unwrap();
    let output = dir.path().join("native-roundtrip.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "roundtrip",
            sample.to_str().unwrap(),
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["diff", sample.to_str().unwrap(), output.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("No structural differences"));
}

#[test]
fn decompile_report_extracts_owner_scripts_and_nested_blocks() {
    let value: serde_json::Value = json!({
        "projectName": "decompile fixture",
        "scenes": {"scenesDict": {}},
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "角色",
                    "nekoBlockJsonList": [
                        {
                            "type": "on_running_group_activated",
                            "id": "event-1",
                            "location": [10, 20],
                            "next": {
                                "type": "variables_set",
                                "id": "set-1",
                                "fields": {"variable": "var-1"},
                                "inputs": {
                                    "VALUE": {
                                        "type": "math_number",
                                        "id": "num-1",
                                        "fields": {"NUM": "42"},
                                        "is_output": true
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        }
    });

    let report = nekoc::decompile::build_report(&value).unwrap();

    assert_eq!(report["project_name"], "decompile fixture");
    assert_eq!(report["summary"]["owners"], 1);
    assert_eq!(report["summary"]["scripts"], 1);
    assert_eq!(report["summary"]["blocks"], 3);
    assert_eq!(report["owners"][0]["kind"], "actor");
    assert_eq!(report["owners"][0]["name"], "角色");
    assert_eq!(
        report["owners"][0]["scripts"][0]["entry_type"],
        "on_running_group_activated"
    );
    assert_eq!(
        report["owners"][0]["scripts"][0]["sequence_types"],
        json!(["on_running_group_activated", "variables_set"])
    );
    assert_eq!(
        report["owners"][0]["scripts"][0]["blocks"][2]["path"],
        "$.next.inputs.VALUE"
    );
}

#[test]
fn workspace_export_flattens_nested_blocks_into_connections() {
    let value: serde_json::Value = json!({
        "projectName": "workspace fixture",
        "scenes": {"scenesDict": {}},
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "角色",
                    "nekoBlockJsonList": [
                        {
                            "type": "on_running_group_activated",
                            "id": "event-1",
                            "next": {
                                "type": "variables_set",
                                "id": "set-1",
                                "inputs": {
                                    "VALUE": {
                                        "type": "math_number",
                                        "id": "num-1",
                                        "fields": {"NUM": "42"}
                                    }
                                },
                                "statements": {
                                    "DO": {
                                        "type": "wait",
                                        "id": "wait-1"
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        }
    });

    let report = nekoc::workspace::build_report(&value).unwrap();
    let data = &report["owners"][0]["workspaceData"];

    assert_eq!(report["project_name"], "workspace fixture");
    assert_eq!(report["summary"]["owners"], 1);
    assert_eq!(report["summary"]["blocks"], 4);
    assert_eq!(report["summary"]["connections"], 3);
    assert_eq!(
        data["blocks"]["event-1"]["parent_id"],
        serde_json::Value::Null
    );
    assert_eq!(data["blocks"]["set-1"]["parent_id"], "event-1");
    assert!(data["blocks"]["event-1"].get("next").is_none());
    assert!(data["blocks"]["set-1"].get("inputs").is_none());
    assert_eq!(data["connections"]["event-1"]["set-1"]["type"], "next");
    assert_eq!(data["connections"]["set-1"]["num-1"]["input_type"], "value");
    assert_eq!(data["connections"]["set-1"]["num-1"]["input_name"], "VALUE");
    assert_eq!(
        data["connections"]["set-1"]["wait-1"]["input_type"],
        "statement"
    );
    assert_eq!(data["connections"]["set-1"]["wait-1"]["input_name"], "DO");
}

#[test]
fn runtime_runs_start_variable_loop_and_wait() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-score": {
                    "id": "var-score",
                    "name": "score",
                    "value": 5
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "player",
                    "position": { "x": 0, "y": 0 },
                    "rotation": 0,
                    "scale": 100,
                    "visible": true,
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "set",
                            "type": "variables_set",
                            "fields": { "variable": "var-score" },
                            "inputs": {
                                "value": {
                                    "id": "zero",
                                    "type": "math_number",
                                    "fields": { "NUM": "0" }
                                }
                            },
                            "next": {
                                "id": "forever",
                                "type": "repeat_forever",
                                "statements": {
                                    "DO": {
                                        "id": "change",
                                        "type": "change_variables",
                                        "fields": {
                                            "variable": "var-score",
                                            "method": "increase"
                                        },
                                        "inputs": {
                                            "value": {
                                                "id": "one",
                                                "type": "math_number",
                                                "fields": { "NUM": "1" }
                                            }
                                        },
                                        "next": {
                                            "id": "wait",
                                            "type": "wait",
                                            "inputs": {
                                                "time": {
                                                    "id": "delay",
                                                    "type": "math_number",
                                                    "fields": { "NUM": "0.03" }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 3).unwrap();

    assert_eq!(snapshot.ticks, 3);
    assert_eq!(
        snapshot.variables["var-score"],
        nekoc::runtime::RuntimeValue::Number(3.0)
    );
    assert_eq!(snapshot.active_threads, 1);
}

#[test]
fn runtime_runs_three_body_sample_positions() {
    let input = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("three_body.bcmkn");
    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(input).unwrap()).unwrap();

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();

    assert_eq!(
        snapshot.variables["kn-var-phaseA"],
        nekoc::runtime::RuntimeValue::Number(3.0)
    );
    let body_a = &snapshot.actors["nekoc-actor-body-a"];
    assert!((body_a.x - 89.876_663).abs() < 0.001);
    assert!((body_a.y - 2.878_687).abs() < 0.001);
}

#[test]
fn runtime_runs_motion_actor_state_blocks() {
    let project = json!({
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "player",
                    "position": { "x": 0, "y": 0 },
                    "rotation": 0,
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "point",
                            "type": "self_point_towards",
                            "inputs": {
                                "degrees": {
                                    "id": "ninety",
                                    "type": "math_number",
                                    "fields": { "NUM": "90" }
                                }
                            },
                            "next": {
                                "id": "move",
                                "type": "self_go_forward",
                                "inputs": {
                                    "steps": {
                                        "id": "steps-10",
                                        "type": "math_number",
                                        "fields": { "NUM": "10" }
                                    }
                                },
                                "next": {
                                    "id": "change-x",
                                    "type": "self_change_coordinate_x",
                                    "fields": { "increase": "increase" },
                                    "inputs": {
                                        "value": {
                                            "id": "dx",
                                            "type": "math_number",
                                            "fields": { "NUM": "5" }
                                        }
                                    },
                                    "next": {
                                        "id": "change-y",
                                        "type": "self_change_coordinate_y",
                                        "fields": { "increase": "decrease" },
                                        "inputs": {
                                            "value": {
                                                "id": "dy",
                                                "type": "math_number",
                                                "fields": { "NUM": "3" }
                                            }
                                        },
                                        "next": {
                                            "id": "rotate",
                                            "type": "self_rotate",
                                            "inputs": {
                                                "degrees": {
                                                    "id": "turn-15",
                                                    "type": "math_number",
                                                    "fields": { "NUM": "15" }
                                                }
                                            },
                                            "next": {
                                                "id": "move-to",
                                                "type": "self_move_to",
                                                "inputs": {
                                                    "x": {
                                                        "id": "x-7",
                                                        "type": "math_number",
                                                        "fields": { "NUM": "7" }
                                                    },
                                                    "y": {
                                                        "id": "y-8",
                                                        "type": "math_number",
                                                        "fields": { "NUM": "8" }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();
    let actor = snapshot.actors.get("actor-1").unwrap();
    assert_eq!(actor.x, 7.0);
    assert_eq!(actor.y, 8.0);
    assert_eq!(actor.rotation, 105.0);
}

#[test]
fn runtime_runs_screen_switch_state_blocks() {
    let project = json!({
        "scenes": {
            "currentSceneId": "scene-menu",
            "scenesDict": {
                "scene-menu": {
                    "id": "scene-menu",
                    "name": "menu",
                    "screenName": "menu",
                    "nekoBlockJsonList": []
                },
                "scene-game": {
                    "id": "scene-game",
                    "name": "game",
                    "screenName": "game",
                    "nekoBlockJsonList": []
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "start",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "switch",
                            "type": "switch_to_screen",
                            "inputs": {
                                "screen_id": {
                                    "id": "screen-input",
                                    "type": "get_screens",
                                    "fields": { "screen_id": "scene-game" }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();

    assert_eq!(snapshot.current_scene_id.as_deref(), Some("scene-game"));
    assert_eq!(snapshot.current_scene_name.as_deref(), Some("game"));
}

#[test]
fn runtime_runs_list_state_and_expression_blocks() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "list-items": {
                    "id": "list-items",
                    "name": "items",
                    "type": "list",
                    "value": ["seed"]
                },
                "list-backup": {
                    "id": "list-backup",
                    "name": "backup",
                    "type": "list",
                    "value": []
                },
                "var-all": {"id": "var-all", "name": "all", "value": ""},
                "var-first": {"id": "var-first", "name": "first", "value": ""},
                "var-length": {"id": "var-length", "name": "length", "value": 0},
                "var-index": {"id": "var-index", "name": "index", "value": 0},
                "var-has": {"id": "var-has", "name": "has", "value": false},
                "var-temp": {"id": "var-temp", "name": "temp", "value": []}
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "player",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "append",
                            "type": "list_append",
                            "inputs": {
                                "list": {
                                    "id": "items-append",
                                    "type": "pure_list_get",
                                    "fields": { "list": "list-items" }
                                },
                                "list_item_value": {
                                    "id": "one",
                                    "type": "math_number",
                                    "fields": { "NUM": "1" }
                                }
                            },
                            "next": {
                                "id": "insert",
                                "type": "list_insert_value",
                                "inputs": {
                                    "list": {
                                        "id": "items-insert",
                                        "type": "pure_list_get",
                                        "fields": { "list": "list-items" }
                                    },
                                    "list_index": {
                                        "id": "insert-index",
                                        "type": "math_number",
                                        "fields": { "NUM": "1" }
                                    },
                                    "list_item_value": {
                                        "id": "hello",
                                        "type": "text",
                                        "fields": { "TEXT": "hello" }
                                    }
                                },
                                "next": {
                                    "id": "replace",
                                    "type": "replace_list_item",
                                    "fields": { "item": "any" },
                                    "inputs": {
                                        "list": {
                                            "id": "items-replace",
                                            "type": "pure_list_get",
                                            "fields": { "list": "list-items" }
                                        },
                                        "list_index": {
                                            "id": "replace-index",
                                            "type": "math_number",
                                            "fields": { "NUM": "2" }
                                        },
                                        "list_item_value": {
                                            "id": "two",
                                            "type": "math_number",
                                            "fields": { "NUM": "2" }
                                        }
                                    },
                                    "next": {
                                        "id": "delete",
                                        "type": "delete_list_item",
                                        "fields": { "item": "last" },
                                        "inputs": {
                                            "list": {
                                                "id": "items-delete",
                                                "type": "pure_list_get",
                                                "fields": { "list": "list-items" }
                                            },
                                            "list_index": {
                                                "id": "delete-index",
                                                "type": "math_number",
                                                "fields": { "NUM": "99" }
                                            }
                                        },
                                        "next": {
                                            "id": "copy",
                                            "type": "list_copy",
                                            "inputs": {
                                                "list": {
                                                    "id": "items-copy",
                                                    "type": "pure_list_get",
                                                    "fields": { "list": "list-items" }
                                                },
                                                "target_list": {
                                                    "id": "backup-copy",
                                                    "type": "pure_list_get",
                                                    "fields": { "list": "list-backup" }
                                                }
                                            },
                                            "next": {
                                                "id": "set-all",
                                                "type": "variables_set",
                                                "fields": { "variable": "var-all" },
                                                "inputs": {
                                                    "value": {
                                                        "id": "get-list",
                                                        "type": "list_get",
                                                        "fields": { "list": "list-items" }
                                                    }
                                                },
                                                "next": {
                                                    "id": "set-first",
                                                    "type": "variables_set",
                                                    "fields": { "variable": "var-first" },
                                                    "inputs": {
                                                        "value": {
                                                            "id": "item",
                                                            "type": "list_item",
                                                            "fields": { "item": "any" },
                                                            "inputs": {
                                                                "list": {
                                                                    "id": "items-item",
                                                                    "type": "pure_list_get",
                                                                    "fields": { "list": "list-items" }
                                                                },
                                                                "list_index": {
                                                                    "id": "item-index",
                                                                    "type": "math_number",
                                                                    "fields": { "NUM": "1" }
                                                                }
                                                            }
                                                        }
                                                    },
                                                    "next": {
                                                        "id": "set-length",
                                                        "type": "variables_set",
                                                        "fields": { "variable": "var-length" },
                                                        "inputs": {
                                                            "value": {
                                                                "id": "length",
                                                                "type": "list_length",
                                                                "inputs": {
                                                                    "list": {
                                                                        "id": "items-length",
                                                                        "type": "pure_list_get",
                                                                        "fields": { "list": "list-items" }
                                                                    }
                                                                }
                                                            }
                                                        },
                                                        "next": {
                                                            "id": "set-index",
                                                            "type": "variables_set",
                                                            "fields": { "variable": "var-index" },
                                                            "inputs": {
                                                                "value": {
                                                                    "id": "index-of",
                                                                    "type": "list_index_of",
                                                                    "inputs": {
                                                                        "list": {
                                                                            "id": "items-index",
                                                                            "type": "pure_list_get",
                                                                            "fields": { "list": "list-items" }
                                                                        },
                                                                        "list_item_value": {
                                                                            "id": "hello-index",
                                                                            "type": "text",
                                                                            "fields": { "TEXT": "hello" }
                                                                        }
                                                                    }
                                                                }
                                                            },
                                                            "next": {
                                                                "id": "set-has",
                                                                "type": "variables_set",
                                                                "fields": { "variable": "var-has" },
                                                                "inputs": {
                                                                    "value": {
                                                                        "id": "contains",
                                                                        "type": "list_is_exist",
                                                                        "inputs": {
                                                                            "list": {
                                                                                "id": "items-has",
                                                                                "type": "pure_list_get",
                                                                                "fields": { "list": "list-items" }
                                                                            },
                                                                            "list_item_value": {
                                                                                "id": "hello-has",
                                                                                "type": "text",
                                                                                "fields": { "TEXT": "hello" }
                                                                            }
                                                                        }
                                                                    }
                                                                },
                                                                "next": {
                                                                    "id": "set-temp",
                                                                    "type": "variables_set",
                                                                    "fields": { "variable": "var-temp" },
                                                                    "inputs": {
                                                                        "value": {
                                                                            "id": "temp-list",
                                                                            "type": "temporary_list",
                                                                            "inputs": {
                                                                                "ITEM0": {
                                                                                    "id": "temp-1",
                                                                                    "type": "math_number",
                                                                                    "fields": { "NUM": "1" }
                                                                                },
                                                                                "ITEM1": {
                                                                                    "id": "temp-2",
                                                                                    "type": "math_number",
                                                                                    "fields": { "NUM": "2" }
                                                                                }
                                                                            }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();

    assert_eq!(
        snapshot.variables["list-items"],
        nekoc::runtime::RuntimeValue::List(vec![
            nekoc::runtime::RuntimeValue::String("hello".to_owned()),
            nekoc::runtime::RuntimeValue::Number(2.0),
        ])
    );
    assert_eq!(
        snapshot.variables["list-backup"],
        snapshot.variables["list-items"]
    );
    assert_eq!(
        snapshot.variables["var-all"],
        snapshot.variables["list-items"]
    );
    assert_eq!(
        snapshot.variables["var-first"],
        nekoc::runtime::RuntimeValue::String("hello".to_owned())
    );
    assert_eq!(
        snapshot.variables["var-length"],
        nekoc::runtime::RuntimeValue::Number(2.0)
    );
    assert_eq!(
        snapshot.variables["var-index"],
        nekoc::runtime::RuntimeValue::Number(1.0)
    );
    assert_eq!(
        snapshot.variables["var-has"],
        nekoc::runtime::RuntimeValue::Bool(true)
    );
    assert_eq!(
        snapshot.variables["var-temp"],
        nekoc::runtime::RuntimeValue::List(vec![
            nekoc::runtime::RuntimeValue::Number(1.0),
            nekoc::runtime::RuntimeValue::Number(2.0),
        ])
    );
}

#[test]
fn runtime_runs_compiled_sensing_input_time_defaults() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("sensing-runtime.ts");
    let output = dir.path().join("sensing-runtime.bcmkn");
    fs::write(
        &input,
        r##"
onStart(() => {
  askChoice("1+1=?", "1", "2");
  ask("name?");
  timerStart();
  timerStop();
  timerReset();
  showTimer();
  setVar("key", keyPressed("65", "down"));
  setVar("mouse", mouseTrigger("down"));
  setVar("mouseX", mouseX());
  setVar("mouseY", mouseY());
  setVar("answer", answer());
  setVar("choiceText", choiceValue("content"));
  setVar("choiceIndex", choiceValue("index"));
  setVar("timer", timerValue());
  setVar("stageWidth", stageInfo("width"));
  setVar("stageHeight", stageInfo("height"));
  setVar("touching", touching("--self", "--edge"));
  setVar("touchingColor", touchingColor("--self", "#ff0000"));
  setVar("outside", outOfBoundary("0"));
  setVar("cloneCount", cloneCount("--self"));
  setVar("cloneIndex", currentCloneIndex());
  setVar("cloneX", cloneProperty("--self", 1, "x"));
  setVar("bodyTouch", touchingBodyPart("--self", "face"));
});
"##,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let project = nekoc::project::load_project(&output).unwrap();
    let snapshot = nekoc::runtime::run_project(&project.value, 1).unwrap();
    let variable_by_name = |name: &str| {
        let id = snapshot
            .variable_names
            .iter()
            .find_map(|(id, variable_name)| (variable_name == name).then_some(id))
            .unwrap_or_else(|| panic!("missing variable {name}"));
        snapshot
            .variables
            .get(id)
            .unwrap_or_else(|| panic!("missing runtime value for {name}"))
    };

    assert_eq!(
        variable_by_name("key"),
        &nekoc::runtime::RuntimeValue::Bool(false)
    );
    assert_eq!(
        variable_by_name("mouse"),
        &nekoc::runtime::RuntimeValue::Bool(false)
    );
    assert_eq!(
        variable_by_name("mouseX"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("mouseY"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("answer"),
        &nekoc::runtime::RuntimeValue::String(String::new())
    );
    assert_eq!(
        variable_by_name("choiceText"),
        &nekoc::runtime::RuntimeValue::String("1".to_owned())
    );
    assert_eq!(
        variable_by_name("choiceIndex"),
        &nekoc::runtime::RuntimeValue::Number(1.0)
    );
    assert_eq!(
        variable_by_name("timer"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("stageWidth"),
        &nekoc::runtime::RuntimeValue::Number(562.0)
    );
    assert_eq!(
        variable_by_name("stageHeight"),
        &nekoc::runtime::RuntimeValue::Number(900.0)
    );
    assert_eq!(
        variable_by_name("touching"),
        &nekoc::runtime::RuntimeValue::Bool(false)
    );
    assert_eq!(
        variable_by_name("touchingColor"),
        &nekoc::runtime::RuntimeValue::Bool(false)
    );
    assert_eq!(
        variable_by_name("outside"),
        &nekoc::runtime::RuntimeValue::Bool(false)
    );
    assert_eq!(
        variable_by_name("cloneCount"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("cloneIndex"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("cloneX"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("bodyTouch"),
        &nekoc::runtime::RuntimeValue::Bool(false)
    );
}

#[test]
fn runtime_runs_compiled_control_pen_and_display_noops() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("control-display-runtime.ts");
    let output = dir.path().join("control-display-runtime.bcmkn");
    fs::write(
        &input,
        r##"
onStart(() => {
  clearDrawing();
  penDown();
  setPenColor("#00ff88");
  setPenSize(6);
  changePenSize(-2);
  setPenEffect("hue", 50);
  changePenEffect("alpha", -10);
  stampText("hello", 20, "center");
  imageStamp();
  setPenLayer("peak", "bottom");
  penUp();
  say("hello", 2);
  think("hmm");
  closeDialog();
  stageDialog("--self", "system");
  setEffect("2", 80);
  changeEffect("2", -20);
  clearEffects();
  setText("Score");
  setTextSize(24);
  setTextColor("#ff0000");
  setLayer("peak", "bottom");
  setDraggable("1");
  setCamp("camp_red");
  stressAnimation("shake");
  globalAnimation("animation_firework");
  showVariable("fast");
  hideVariable("fast");
  warp(() => {
    setVar("fast", 1);
  });
  tell("--self", () => {
    setVar("told", 1);
  });
  tellAndWait("--self", () => {
    setVar("syncTold", 1);
  });
  stop("1");
  setVar("afterStop", 1);
});
"##,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let project = nekoc::project::load_project(&output).unwrap();
    let snapshot = nekoc::runtime::run_project(&project.value, 1).unwrap();
    let variable_by_name = |name: &str| {
        let id = snapshot
            .variable_names
            .iter()
            .find_map(|(id, variable_name)| (variable_name == name).then_some(id))
            .unwrap_or_else(|| panic!("missing variable {name}"));
        snapshot
            .variables
            .get(id)
            .unwrap_or_else(|| panic!("missing runtime value for {name}"))
    };

    assert_eq!(
        variable_by_name("fast"),
        &nekoc::runtime::RuntimeValue::Number(1.0)
    );
    assert_eq!(
        variable_by_name("told"),
        &nekoc::runtime::RuntimeValue::Number(1.0)
    );
    assert_eq!(
        variable_by_name("syncTold"),
        &nekoc::runtime::RuntimeValue::Number(1.0)
    );
    assert_eq!(
        variable_by_name("afterStop"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
}

#[test]
fn runtime_can_trigger_compiled_click_events() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("click-runtime.ts");
    let output = dir.path().join("click-runtime.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("clicked", 0);
});

onClick(() => {
  setVar("clicked", 1);
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let project = nekoc::project::load_project(&output).unwrap();
    let start_only = nekoc::runtime::run_project(&project.value, 1).unwrap();
    let with_click = nekoc::runtime::run_project_with_events(
        &project.value,
        &[nekoc::runtime::RuntimeEvent::Click { x: None, y: None }],
        1,
    )
    .unwrap();
    let value_by_name = |snapshot: &nekoc::runtime::RuntimeSnapshot, name: &str| {
        let id = snapshot
            .variable_names
            .iter()
            .find_map(|(id, variable_name)| (variable_name == name).then_some(id))
            .unwrap_or_else(|| panic!("missing variable {name}"));
        snapshot
            .variables
            .get(id)
            .unwrap_or_else(|| panic!("missing runtime value for {name}"))
            .clone()
    };

    assert_eq!(
        value_by_name(&start_only, "clicked"),
        nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        value_by_name(&with_click, "clicked"),
        nekoc::runtime::RuntimeValue::Number(1.0)
    );
}

#[test]
fn runtime_runs_compiled_motion_style_and_math_expressions() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("motion-style-runtime.ts");
    let output = dir.path().join("motion-style-runtime.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("selfX", xOf("--self"));
  setVar("selfY", yOf("--self"));
  setVar("selfDistance", distanceTo("--self"));
  setVar("orientationX", orientation("x"));
  setVar("style", styleOf("--self"));
  setVar("scale", appearanceOf("--self", "scale"));
  setVar("ghost", effectOf("--self", "2"));
  setVar("randomFixed", randInt(4, 4));
  setVar("divisible", divisibleBy(10, 2));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let project = nekoc::project::load_project(&output).unwrap();
    let actor = project.value["actors"]["actorsDict"]
        .as_object()
        .unwrap()
        .values()
        .find(|actor| {
            actor["nekoBlockJsonList"]
                .as_array()
                .is_some_and(|blocks| !blocks.is_empty())
        })
        .expect("compiled script actor");
    let expected_x = actor["position"]["x"].as_f64().unwrap_or(0.0);
    let expected_y = actor["position"]["y"].as_f64().unwrap_or(0.0);
    let expected_scale = actor["scale"].as_f64().unwrap_or(100.0);
    let expected_style = actor["currentStyleId"].as_str().unwrap().to_owned();

    let snapshot = nekoc::runtime::run_project(&project.value, 1).unwrap();
    let variable_by_name = |name: &str| {
        let id = snapshot
            .variable_names
            .iter()
            .find_map(|(id, variable_name)| (variable_name == name).then_some(id))
            .unwrap_or_else(|| panic!("missing variable {name}"));
        snapshot
            .variables
            .get(id)
            .unwrap_or_else(|| panic!("missing runtime value for {name}"))
    };

    assert_eq!(
        variable_by_name("selfX"),
        &nekoc::runtime::RuntimeValue::Number(expected_x)
    );
    assert_eq!(
        variable_by_name("selfY"),
        &nekoc::runtime::RuntimeValue::Number(expected_y)
    );
    assert_eq!(
        variable_by_name("selfDistance"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("orientationX"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("style"),
        &nekoc::runtime::RuntimeValue::String(expected_style)
    );
    assert_eq!(
        variable_by_name("scale"),
        &nekoc::runtime::RuntimeValue::Number(expected_scale)
    );
    assert_eq!(
        variable_by_name("ghost"),
        &nekoc::runtime::RuntimeValue::Number(0.0)
    );
    assert_eq!(
        variable_by_name("randomFixed"),
        &nekoc::runtime::RuntimeValue::Number(4.0)
    );
    assert_eq!(
        variable_by_name("divisible"),
        &nekoc::runtime::RuntimeValue::Bool(true)
    );
}

#[test]
fn runtime_runs_compiled_traverse_number_loops() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("range-runtime.ts");
    let output = dir.path().join("range-runtime.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("sum", 0);
  setVar("last", 0);
  forRange("n", 1, 5, 2, () => {
    setVar("sum", add(getVar("sum"), rangeValue("n")));
    setVar("last", rangeValue("n"));
  });
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let project = nekoc::project::load_project(&output).unwrap();
    let snapshot = nekoc::runtime::run_project(&project.value, 1).unwrap();
    let variable_by_name = |name: &str| {
        let id = snapshot
            .variable_names
            .iter()
            .find_map(|(id, variable_name)| (variable_name == name).then_some(id))
            .unwrap_or_else(|| panic!("missing variable {name}"));
        snapshot
            .variables
            .get(id)
            .unwrap_or_else(|| panic!("missing runtime value for {name}"))
    };

    assert_eq!(
        variable_by_name("sum"),
        &nekoc::runtime::RuntimeValue::Number(9.0)
    );
    assert_eq!(
        variable_by_name("last"),
        &nekoc::runtime::RuntimeValue::Number(5.0)
    );
}

#[test]
fn runtime_runs_compiled_script_variable_defaults() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("script-vars-runtime.ts");
    let output = dir.path().join("script-vars-runtime.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  scriptVars("localScore");
  setVar("localCopy", scriptVar("localScore"));
  setVar("sum", add(scriptVar("localScore"), 4));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let project = nekoc::project::load_project(&output).unwrap();
    let snapshot = nekoc::runtime::run_project(&project.value, 1).unwrap();
    let variable_by_name = |name: &str| {
        let id = snapshot
            .variable_names
            .iter()
            .find_map(|(id, variable_name)| (variable_name == name).then_some(id))
            .unwrap_or_else(|| panic!("missing variable {name}"));
        snapshot
            .variables
            .get(id)
            .unwrap_or_else(|| panic!("missing runtime value for {name}"))
    };

    assert_eq!(
        variable_by_name("localCopy"),
        &nekoc::runtime::RuntimeValue::Null
    );
    assert_eq!(
        variable_by_name("sum"),
        &nekoc::runtime::RuntimeValue::Number(4.0)
    );
}

#[test]
fn runtime_runs_compiled_reporter_procedure_calls() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("reporter-runtime.ts");
    let output = dir.path().join("reporter-runtime.bcmkn");
    fs::write(
        &input,
        r#"
defineReporter("double", ["x"], () => {
  returnValue(mul(param("x"), 2));
});

onStart(() => {
  setVar("answer", callReporter("double", 21));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let project = nekoc::project::load_project(&output).unwrap();
    let snapshot = nekoc::runtime::run_project(&project.value, 1).unwrap();
    let answer_id = snapshot
        .variable_names
        .iter()
        .find_map(|(id, name)| (name == "answer").then_some(id))
        .expect("missing answer variable");

    assert_eq!(
        snapshot.variables.get(answer_id),
        Some(&nekoc::runtime::RuntimeValue::Number(42.0))
    );
}

#[test]
fn runtime_runs_compiled_statement_procedure_calls() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("procedure-runtime.ts");
    let output = dir.path().join("procedure-runtime.bcmkn");
    fs::write(
        &input,
        r#"
defineProc("addScore", ["delta"], () => {
  setVar("score", add(getVar("score"), param("delta")));
});

onStart(() => {
  setVar("score", 10);
  callProc("addScore", 5);
  setVar("afterCall", add(getVar("score"), 1));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let project = nekoc::project::load_project(&output).unwrap();
    let snapshot = nekoc::runtime::run_project(&project.value, 1).unwrap();
    let variable_by_name = |name: &str| {
        let id = snapshot
            .variable_names
            .iter()
            .find_map(|(id, variable_name)| (variable_name == name).then_some(id))
            .unwrap_or_else(|| panic!("missing variable {name}"));
        snapshot
            .variables
            .get(id)
            .unwrap_or_else(|| panic!("missing runtime value for {name}"))
    };

    assert_eq!(
        variable_by_name("score"),
        &nekoc::runtime::RuntimeValue::Number(15.0)
    );
    assert_eq!(
        variable_by_name("afterCall"),
        &nekoc::runtime::RuntimeValue::Number(16.0)
    );
}

#[test]
fn cli_run_writes_runtime_snapshot() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("runtime.bcmkn");
    let output = dir.path().join("runtime.json");
    fs::write(
        &input,
        serde_json::to_string(&json!({
            "variables": {
                "variablesDict": {
                    "var-score": {
                        "id": "var-score",
                        "name": "score",
                        "value": 0
                    }
                }
            },
            "actors": {
                "actorsDict": {
                    "actor-1": {
                        "id": "actor-1",
                        "name": "player",
                        "nekoBlockJsonList": [{
                            "id": "start",
                            "type": "on_running_group_activated",
                            "next": {
                                "id": "change",
                                "type": "change_variables",
                                "fields": {
                                    "variable": "var-score",
                                    "method": "increase"
                                },
                                "inputs": {
                                    "value": {
                                        "id": "two",
                                        "type": "math_number",
                                        "fields": { "NUM": "2" }
                                    }
                                }
                            }
                        }]
                    }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run",
            input.to_str().unwrap(),
            "--ticks",
            "1",
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let snapshot: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(snapshot["ticks"], 1);
    assert_eq!(snapshot["variables"]["var-score"], 2.0);
    assert_eq!(snapshot["variable_names"]["var-score"], "score");
}

#[test]
fn cli_run_can_check_expected_runtime_snapshot() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("runtime.bcmkn");
    let expected = dir.path().join("expected.json");
    let wrong_expected = dir.path().join("wrong-expected.json");
    fs::write(
        &input,
        serde_json::to_string(&json!({
            "variables": {
                "variablesDict": {
                    "var-score": {
                        "id": "var-score",
                        "name": "score",
                        "value": 0
                    }
                }
            },
            "actors": {
                "actorsDict": {
                    "actor-1": {
                        "id": "actor-1",
                        "name": "player",
                        "nekoBlockJsonList": [{
                            "id": "start",
                            "type": "on_running_group_activated",
                            "next": {
                                "id": "change",
                                "type": "change_variables",
                                "fields": {
                                    "variable": "var-score",
                                    "method": "increase"
                                },
                                "inputs": {
                                    "value": {
                                        "id": "two",
                                        "type": "math_number",
                                        "fields": { "NUM": "2" }
                                    }
                                }
                            }
                        }]
                    }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &expected,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "current_scene_id": null,
            "current_scene_name": null,
            "variables": { "var-score": 2.0 },
            "variable_names": { "var-score": "score" },
            "actors": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "player",
                    "x": 0.0,
                    "y": 0.0,
                    "rotation": 0.0,
                    "scale": 100.0,
                    "visible": true
                }
            },
            "logs": [],
            "received_broadcasts": [],
            "message_values": {},
            "active_threads": 0
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &wrong_expected,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "current_scene_id": null,
            "current_scene_name": null,
            "variables": { "var-score": 1.0 },
            "variable_names": { "var-score": "score" },
            "actors": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "player",
                    "x": 0.0,
                    "y": 0.0,
                    "rotation": 0.0,
                    "scale": 100.0,
                    "visible": true
                }
            },
            "logs": [],
            "received_broadcasts": [],
            "message_values": {},
            "active_threads": 0
        }))
        .unwrap(),
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run",
            input.to_str().unwrap(),
            "--ticks",
            "1",
            "--expect",
            expected.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains(
            "Runtime snapshot matches expectation",
        ));

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run",
            input.to_str().unwrap(),
            "--ticks",
            "1",
            "--expect",
            wrong_expected.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("var-score"));
}

#[test]
fn cli_run_can_inject_click_events() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("runtime-click.bcmkn");
    let output = dir.path().join("runtime-click.json");
    fs::write(
        &input,
        serde_json::to_string(&json!({
            "variables": {
                "variablesDict": {
                    "var-clicked": {
                        "id": "var-clicked",
                        "name": "clicked",
                        "value": 0
                    }
                }
            },
            "actors": {
                "actorsDict": {
                    "actor-1": {
                        "id": "actor-1",
                        "name": "button",
                        "nekoBlockJsonList": [{
                            "id": "click",
                            "type": "start_on_click",
                            "next": {
                                "id": "set",
                                "type": "variables_set",
                                "fields": {
                                    "variable": "var-clicked"
                                },
                                "inputs": {
                                    "value": {
                                        "id": "one",
                                        "type": "math_number",
                                        "fields": { "NUM": "1" }
                                    }
                                }
                            }
                        }]
                    }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run",
            input.to_str().unwrap(),
            "--ticks",
            "1",
            "--event",
            "click",
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let snapshot: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(snapshot["variables"]["var-clicked"], 1.0);
}

#[test]
fn cli_run_click_event_can_update_mouse_position() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("runtime-click-position.bcmkn");
    let output = dir.path().join("runtime-click-position.json");
    fs::write(
        &input,
        serde_json::to_string(&json!({
            "variables": {
                "variablesDict": {
                    "var-clicked": { "id": "var-clicked", "name": "clicked", "value": 0 },
                    "var-x": { "id": "var-x", "name": "x", "value": 0 },
                    "var-y": { "id": "var-y", "name": "y", "value": 0 }
                }
            },
            "actors": {
                "actorsDict": {
                    "actor-1": {
                        "id": "actor-1",
                        "name": "button",
                        "nekoBlockJsonList": [{
                            "id": "click",
                            "type": "start_on_click",
                            "next": {
                                "id": "set-clicked",
                                "type": "variables_set",
                                "fields": { "variable": "var-clicked" },
                                "inputs": {
                                    "value": {
                                        "id": "one",
                                        "type": "math_number",
                                        "fields": { "NUM": "1" }
                                    }
                                },
                                "next": {
                                    "id": "set-x",
                                    "type": "variables_set",
                                    "fields": { "variable": "var-x" },
                                    "inputs": {
                                        "value": {
                                            "id": "mouse-x",
                                            "type": "get_mouse_info",
                                            "fields": { "type": "x" }
                                        }
                                    },
                                    "next": {
                                        "id": "set-y",
                                        "type": "variables_set",
                                        "fields": { "variable": "var-y" },
                                        "inputs": {
                                            "value": {
                                                "id": "mouse-y",
                                                "type": "get_mouse_info",
                                                "fields": { "type": "y" }
                                            }
                                        }
                                    }
                                }
                            }
                        }]
                    }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run",
            input.to_str().unwrap(),
            "--ticks",
            "1",
            "--event",
            "click:15,-20",
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let snapshot: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(snapshot["variables"]["var-clicked"], 1.0);
    assert_eq!(snapshot["variables"]["var-x"], 15.0);
    assert_eq!(snapshot["variables"]["var-y"], -20.0);
}

#[test]
fn cli_run_can_inject_key_events() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("runtime-key.bcmkn");
    let output = dir.path().join("runtime-key.json");
    fs::write(
        &input,
        serde_json::to_string(&json!({
            "variables": {
                "variablesDict": {
                    "var-key": {
                        "id": "var-key",
                        "name": "key",
                        "value": ""
                    }
                }
            },
            "actors": {
                "actorsDict": {
                    "actor-1": {
                        "id": "actor-1",
                        "name": "keyboard",
                        "nekoBlockJsonList": [{
                            "id": "key",
                            "type": "on_keydown",
                            "fields": {
                                "key": "81",
                                "type": "down"
                            },
                            "next": {
                                "id": "set",
                                "type": "variables_set",
                                "fields": {
                                    "variable": "var-key"
                                },
                                "inputs": {
                                    "value": {
                                        "id": "q",
                                        "type": "text",
                                        "fields": { "TEXT": "q" }
                                    }
                                }
                            }
                        }]
                    }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run",
            input.to_str().unwrap(),
            "--ticks",
            "1",
            "--event",
            "key-down:81",
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let snapshot: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(snapshot["variables"]["var-key"], "q");
}

#[test]
fn cli_run_can_inject_mouse_events() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("runtime-mouse.bcmkn");
    let output = dir.path().join("runtime-mouse.json");
    fs::write(
        &input,
        serde_json::to_string(&json!({
            "variables": {
                "variablesDict": {
                    "var-mouse": { "id": "var-mouse", "name": "mouse", "value": false },
                    "var-x": { "id": "var-x", "name": "x", "value": 0 },
                    "var-y": { "id": "var-y", "name": "y", "value": 0 }
                }
            },
            "actors": {
                "actorsDict": {
                    "actor-1": {
                        "id": "actor-1",
                        "name": "mouse",
                        "nekoBlockJsonList": [{
                            "id": "start",
                            "type": "on_running_group_activated",
                            "next": {
                                "id": "set-mouse",
                                "type": "variables_set",
                                "fields": { "variable": "var-mouse" },
                                "inputs": {
                                    "value": {
                                        "id": "mouse-down",
                                        "type": "mouse_down",
                                        "fields": { "type": "down" }
                                    }
                                },
                                "next": {
                                    "id": "set-x",
                                    "type": "variables_set",
                                    "fields": { "variable": "var-x" },
                                    "inputs": {
                                        "value": {
                                            "id": "mouse-x",
                                            "type": "get_mouse_info",
                                            "fields": { "type": "x" }
                                        }
                                    },
                                    "next": {
                                        "id": "set-y",
                                        "type": "variables_set",
                                        "fields": { "variable": "var-y" },
                                        "inputs": {
                                            "value": {
                                                "id": "mouse-y",
                                                "type": "get_mouse_info",
                                                "fields": { "type": "y" }
                                            }
                                        }
                                    }
                                }
                            }
                        }]
                    }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run",
            input.to_str().unwrap(),
            "--ticks",
            "1",
            "--event",
            "mouse-down:12,-34",
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let snapshot: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(snapshot["variables"]["var-mouse"], true);
    assert_eq!(snapshot["variables"]["var-x"], 12.0);
    assert_eq!(snapshot["variables"]["var-y"], -34.0);
}

#[test]
fn cli_run_scenario_checks_events_and_expected_snapshot_paths() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("runtime-click.bcmkn");
    let scenario = dir.path().join("runtime-click.scenario.json");
    let wrong_scenario = dir.path().join("runtime-click-wrong.scenario.json");
    fs::write(
        &input,
        serde_json::to_string(&json!({
            "variables": {
                "variablesDict": {
                    "var-clicked": {
                        "id": "var-clicked",
                        "name": "clicked",
                        "value": 0
                    }
                }
            },
            "actors": {
                "actorsDict": {
                    "actor-1": {
                        "id": "actor-1",
                        "name": "button",
                        "nekoBlockJsonList": [{
                            "id": "click",
                            "type": "start_on_click",
                            "next": {
                                "id": "set",
                                "type": "variables_set",
                                "fields": {
                                    "variable": "var-clicked"
                                },
                                "inputs": {
                                    "value": {
                                        "id": "one",
                                        "type": "math_number",
                                        "fields": { "NUM": "1" }
                                    }
                                }
                            }
                        }]
                    }
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &scenario,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "events": ["click"],
            "expect": {
                "ticks": 1,
                "variables.var-clicked": 1.0,
                "variable_names.var-clicked": "clicked",
                "actors.actor-1.x": {
                    "approx": 0.0,
                    "epsilon": 0.001
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();
    fs::write(
        &wrong_scenario,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "events": ["click"],
            "expect": {
                "variables.var-clicked": 2.0,
                "actors.actor-1.x": {
                    "approx": 10.0,
                    "epsilon": 0.001
                }
            }
        }))
        .unwrap(),
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run-scenario",
            input.to_str().unwrap(),
            scenario.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Runtime scenario matches"));

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "run-scenario",
            input.to_str().unwrap(),
            wrong_scenario.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stdout(predicate::str::contains("variables.var-clicked"))
        .stdout(predicate::str::contains("actors.actor-1.x"));
}

#[test]
fn cli_compile_ts_scenario_compiles_and_checks_runtime() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("compiled-scenario.ts");
    let scenario = dir.path().join("compiled-scenario.json");
    let output = dir.path().join("compiled-scenario.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 4);
  changeVar("score", 5);
});
"#,
    )
    .unwrap();
    fs::write(
        &scenario,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "expect": {
                "variables.kn-var-score": 9.0,
                "variable_names.kn-var-score": "score"
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-scenario",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--scenario",
            scenario.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Runtime scenario matches"));

    assert!(output.exists());
}

#[test]
fn cli_compile_ts_scenario_can_inject_key_events() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("compiled-key-scenario.ts");
    let scenario = dir.path().join("compiled-key-scenario.json");
    let output = dir.path().join("compiled-key-scenario.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("key", "");
});

onKey("81", "down", () => {
  setVar("key", "q");
});
"#,
    )
    .unwrap();
    fs::write(
        &scenario,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "events": [
                { "kind": "key-down", "key": "81" }
            ],
            "expect": {
                "variables.kn-var-key": "q"
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-scenario",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--scenario",
            scenario.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Runtime scenario matches"));
}

#[test]
fn cli_compile_ts_scenario_exposes_pressed_key_state() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("compiled-key-state.ts");
    let scenario = dir.path().join("compiled-key-state.json");
    let output = dir.path().join("compiled-key-state.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("isDown", keyPressed("81", "down"));
  setVar("isUp", keyPressed("81", "up"));
});
"#,
    )
    .unwrap();
    fs::write(
        &scenario,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "events": [
                { "kind": "key-down", "key": "81" }
            ],
            "expect": {
                "variables.kn-var-isDown": true,
                "variables.kn-var-isUp": false
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-scenario",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--scenario",
            scenario.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Runtime scenario matches"));
}

#[test]
fn cli_compile_ts_scenario_clears_key_state_on_key_up() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("compiled-key-up-state.ts");
    let scenario = dir.path().join("compiled-key-up-state.json");
    let output = dir.path().join("compiled-key-up-state.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("isDown", keyPressed("81", "down"));
});
"#,
    )
    .unwrap();
    fs::write(
        &scenario,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "events": [
                { "kind": "key-down", "key": "81" },
                { "kind": "key-up", "key": "81" }
            ],
            "expect": {
                "variables.kn-var-isDown": false
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-scenario",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--scenario",
            scenario.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Runtime scenario matches"));
}

#[test]
fn cli_compile_ts_scenario_exposes_mouse_state() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("compiled-mouse-state.ts");
    let scenario = dir.path().join("compiled-mouse-state.json");
    let output = dir.path().join("compiled-mouse-state.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("mouse", mouseTrigger("down"));
  setVar("mouseX", mouseX());
  setVar("mouseY", mouseY());
});
"#,
    )
    .unwrap();
    fs::write(
        &scenario,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "events": [
                { "kind": "mouse-down", "x": 12, "y": -34 }
            ],
            "expect": {
                "variables.kn-var-mouse": true,
                "variables.kn-var-mouseX": 12.0,
                "variables.kn-var-mouseY": -34.0
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-scenario",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--scenario",
            scenario.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Runtime scenario matches"));
}

#[test]
fn cli_compile_ts_scenario_click_updates_mouse_position() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("compiled-click-position.ts");
    let scenario = dir.path().join("compiled-click-position.json");
    let output = dir.path().join("compiled-click-position.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("clicked", 0);
});

onClick(() => {
  setVar("clicked", 1);
  setVar("mouseX", mouseX());
  setVar("mouseY", mouseY());
});
"#,
    )
    .unwrap();
    fs::write(
        &scenario,
        serde_json::to_string_pretty(&json!({
            "ticks": 1,
            "events": [
                { "kind": "click", "x": 15, "y": -20 }
            ],
            "expect": {
                "variables.kn-var-clicked": 1.0,
                "variables.kn-var-mouseX": 15.0,
                "variables.kn-var-mouseY": -20.0
            }
        }))
        .unwrap(),
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-scenario",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--scenario",
            scenario.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success()
        .stdout(predicate::str::contains("Runtime scenario matches"));
}

#[test]
fn runtime_dispatches_broadcast_listeners() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-status": {
                    "id": "var-status",
                    "name": "status",
                    "value": ""
                },
                "var-heard": {
                    "id": "var-heard",
                    "name": "heard",
                    "value": 0
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "sender",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "set",
                            "type": "variables_set",
                            "fields": { "variable": "var-status" },
                            "inputs": {
                                "value": {
                                    "id": "start-text",
                                    "type": "text",
                                    "fields": { "TEXT": "start" }
                                }
                            },
                            "next": {
                                "id": "broadcast",
                                "type": "self_broadcast",
                                "inputs": {
                                    "message": {
                                        "id": "ready-message",
                                        "type": "broadcast_input",
                                        "fields": { "message": "ready" }
                                    }
                                }
                            }
                        }
                    }]
                },
                "actor-2": {
                    "id": "actor-2",
                    "name": "receiver",
                    "nekoBlockJsonList": [{
                        "id": "listen",
                        "type": "self_listen",
                        "inputs": {
                            "message": {
                                "id": "listen-message",
                                "type": "broadcast_input",
                                "fields": { "message": "ready" }
                            }
                        },
                        "statements": {
                            "DO": {
                                "id": "heard",
                                "type": "variables_set",
                                "fields": { "variable": "var-heard" },
                                "inputs": {
                                    "value": {
                                        "id": "one",
                                        "type": "math_number",
                                        "fields": { "NUM": "1" }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 2).unwrap();

    assert_eq!(
        snapshot.variables["var-status"],
        nekoc::runtime::RuntimeValue::String("start".to_owned())
    );
    assert_eq!(
        snapshot.variables["var-heard"],
        nekoc::runtime::RuntimeValue::Number(1.0)
    );
    assert_eq!(snapshot.received_broadcasts, vec!["ready".to_owned()]);
}

#[test]
fn runtime_dispatches_parameterized_broadcast_values() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-score": {
                    "id": "var-score",
                    "name": "score",
                    "value": 0
                },
                "var-last-score": {
                    "id": "var-last-score",
                    "name": "lastScore",
                    "value": 0
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "sender",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "set-score",
                            "type": "variables_set",
                            "fields": { "variable": "var-score" },
                            "inputs": {
                                "value": {
                                    "id": "score",
                                    "type": "math_number",
                                    "fields": { "NUM": "42" }
                                }
                            },
                            "next": {
                                "id": "broadcast",
                                "type": "self_broadcast_with_param",
                                "inputs": {
                                    "message": {
                                        "id": "score-message",
                                        "type": "broadcast_input",
                                        "fields": { "message": "score:update" }
                                    },
                                    "param": {
                                        "id": "score-value",
                                        "type": "variables_get",
                                        "fields": { "variable": "var-score" }
                                    }
                                }
                            }
                        }
                    }]
                },
                "actor-2": {
                    "id": "actor-2",
                    "name": "receiver",
                    "nekoBlockJsonList": [{
                        "id": "listen",
                        "type": "self_listen_with_param",
                        "inputs": {
                            "message": {
                                "id": "listen-message",
                                "type": "broadcast_input",
                                "fields": { "message": "score:update" }
                            },
                            "param": {
                                "id": "payload-name",
                                "type": "self_listen_param",
                                "fields": { "TEXT": "payload" }
                            }
                        },
                        "statements": {
                            "DO": {
                                "id": "last-score",
                                "type": "variables_set",
                                "fields": { "variable": "var-last-score" },
                                "inputs": {
                                    "value": {
                                        "id": "payload-value",
                                        "type": "self_listen_value",
                                        "fields": { "TEXT": "payload" }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 2).unwrap();

    assert_eq!(
        snapshot.variables["var-last-score"],
        nekoc::runtime::RuntimeValue::Number(42.0)
    );
    assert_eq!(
        snapshot.message_values["payload"],
        nekoc::runtime::RuntimeValue::Number(42.0)
    );
}

#[test]
fn runtime_runs_if_with_received_broadcast_condition() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-received": {
                    "id": "var-received",
                    "name": "received",
                    "value": 0
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "sender",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "broadcast",
                            "type": "self_broadcast",
                            "inputs": {
                                "message": {
                                    "id": "ready-message",
                                    "type": "broadcast_input",
                                    "fields": { "message": "ready" }
                                }
                            },
                            "next": {
                                "id": "if",
                                "type": "controls_if",
                                "inputs": {
                                    "IF0": {
                                        "id": "received-ready",
                                        "type": "received_broadcast",
                                        "inputs": {
                                            "message": {
                                                "id": "received-message",
                                                "type": "broadcast_input",
                                                "fields": { "message": "ready" }
                                            }
                                        }
                                    }
                                },
                                "statements": {
                                    "DO0": {
                                        "id": "set-received",
                                        "type": "variables_set",
                                        "fields": { "variable": "var-received" },
                                        "inputs": {
                                            "value": {
                                                "id": "one",
                                                "type": "math_number",
                                                "fields": { "NUM": "1" }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();

    assert_eq!(
        snapshot.variables["var-received"],
        nekoc::runtime::RuntimeValue::Number(1.0)
    );
}

#[test]
fn runtime_runs_when_hat_after_condition_becomes_true() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-heard": {
                    "id": "var-heard",
                    "name": "heard",
                    "value": 0
                },
                "var-condition": {
                    "id": "var-condition",
                    "name": "condition",
                    "value": ""
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "receiver",
                    "nekoBlockJsonList": [
                        {
                            "id": "start",
                            "type": "on_running_group_activated",
                            "next": {
                                "id": "set-heard",
                                "type": "variables_set",
                                "fields": { "variable": "var-heard" },
                                "inputs": {
                                    "value": {
                                        "id": "one",
                                        "type": "math_number",
                                        "fields": { "NUM": "1" }
                                    }
                                }
                            }
                        },
                        {
                            "id": "when-heard",
                            "type": "when",
                            "inputs": {
                                "condition": {
                                    "id": "heard-eq",
                                    "type": "logic_compare",
                                    "fields": { "OP": "EQ" },
                                    "inputs": {
                                        "A": {
                                            "id": "heard-value",
                                            "type": "variables_get",
                                            "fields": { "variable": "var-heard" }
                                        },
                                        "B": {
                                            "id": "one-again",
                                            "type": "math_number",
                                            "fields": { "NUM": "1" }
                                        }
                                    }
                                }
                            },
                            "statements": {
                                "DO": {
                                    "id": "set-condition",
                                    "type": "variables_set",
                                    "fields": { "variable": "var-condition" },
                                    "inputs": {
                                        "value": {
                                            "id": "met",
                                            "type": "text",
                                            "fields": { "TEXT": "met" }
                                        }
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 2).unwrap();

    assert_eq!(
        snapshot.variables["var-condition"],
        nekoc::runtime::RuntimeValue::String("met".to_owned())
    );
}

#[test]
fn runtime_runs_repeat_times_and_breaks_to_after_loop() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-i": {
                    "id": "var-i",
                    "name": "i",
                    "value": 0
                },
                "var-done": {
                    "id": "var-done",
                    "name": "done",
                    "value": 0
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "loop",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "repeat",
                            "type": "repeat_n_times",
                            "inputs": {
                                "times": {
                                    "id": "times",
                                    "type": "math_number",
                                    "fields": { "NUM": "3" }
                                }
                            },
                            "statements": {
                                "DO": {
                                    "id": "change",
                                    "type": "change_variables",
                                    "fields": {
                                        "variable": "var-i",
                                        "method": "increase"
                                    },
                                    "inputs": {
                                        "value": {
                                            "id": "one",
                                            "type": "math_number",
                                            "fields": { "NUM": "1" }
                                        }
                                    },
                                    "next": {
                                        "id": "if-break",
                                        "type": "controls_if",
                                        "inputs": {
                                            "IF0": {
                                                "id": "i-gt-one",
                                                "type": "logic_compare",
                                                "fields": { "OP": "GT" },
                                                "inputs": {
                                                    "A": {
                                                        "id": "i-value",
                                                        "type": "variables_get",
                                                        "fields": { "variable": "var-i" }
                                                    },
                                                    "B": {
                                                        "id": "one-again",
                                                        "type": "math_number",
                                                        "fields": { "NUM": "1" }
                                                    }
                                                }
                                            }
                                        },
                                        "statements": {
                                            "DO0": {
                                                "id": "break",
                                                "type": "break"
                                            }
                                        }
                                    }
                                }
                            },
                            "next": {
                                "id": "set-done",
                                "type": "variables_set",
                                "fields": { "variable": "var-done" },
                                "inputs": {
                                    "value": {
                                        "id": "done-one",
                                        "type": "math_number",
                                        "fields": { "NUM": "1" }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();

    assert_eq!(
        snapshot.variables["var-i"],
        nekoc::runtime::RuntimeValue::Number(2.0)
    );
    assert_eq!(
        snapshot.variables["var-done"],
        nekoc::runtime::RuntimeValue::Number(1.0)
    );
}

#[test]
fn runtime_runs_repeat_until_condition() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-i": {
                    "id": "var-i",
                    "name": "i",
                    "value": 0
                },
                "var-done": {
                    "id": "var-done",
                    "name": "done",
                    "value": 0
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "until",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "repeat-until",
                            "type": "repeat_forever_until",
                            "inputs": {
                                "condition": {
                                    "id": "i-gte-three",
                                    "type": "logic_compare",
                                    "fields": { "OP": "GTE" },
                                    "inputs": {
                                        "A": {
                                            "id": "i-value",
                                            "type": "variables_get",
                                            "fields": { "variable": "var-i" }
                                        },
                                        "B": {
                                            "id": "three",
                                            "type": "math_number",
                                            "fields": { "NUM": "3" }
                                        }
                                    }
                                }
                            },
                            "statements": {
                                "DO": {
                                    "id": "change",
                                    "type": "change_variables",
                                    "fields": {
                                        "variable": "var-i",
                                        "method": "increase"
                                    },
                                    "inputs": {
                                        "value": {
                                            "id": "one",
                                            "type": "math_number",
                                            "fields": { "NUM": "1" }
                                        }
                                    }
                                }
                            },
                            "next": {
                                "id": "set-done",
                                "type": "variables_set",
                                "fields": { "variable": "var-done" },
                                "inputs": {
                                    "value": {
                                        "id": "done-one",
                                        "type": "math_number",
                                        "fields": { "NUM": "1" }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();

    assert_eq!(
        snapshot.variables["var-i"],
        nekoc::runtime::RuntimeValue::Number(3.0)
    );
    assert_eq!(
        snapshot.variables["var-done"],
        nekoc::runtime::RuntimeValue::Number(1.0)
    );
}

#[test]
fn runtime_wait_until_resumes_after_broadcast() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-waited": {
                    "id": "var-waited",
                    "name": "waited",
                    "value": 0
                }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "waiter",
                    "nekoBlockJsonList": [
                        {
                            "id": "wait-start",
                            "type": "on_running_group_activated",
                            "next": {
                                "id": "wait-until",
                                "type": "wait_until",
                                "inputs": {
                                    "condition": {
                                        "id": "received-ready",
                                        "type": "received_broadcast",
                                        "inputs": {
                                            "message": {
                                                "id": "ready-message",
                                                "type": "broadcast_input",
                                                "fields": { "message": "ready" }
                                            }
                                        }
                                    }
                                },
                                "next": {
                                    "id": "set-waited",
                                    "type": "variables_set",
                                    "fields": { "variable": "var-waited" },
                                    "inputs": {
                                        "value": {
                                            "id": "one",
                                            "type": "math_number",
                                            "fields": { "NUM": "1" }
                                        }
                                    }
                                }
                            }
                        },
                        {
                            "id": "broadcast-start",
                            "type": "on_running_group_activated",
                            "next": {
                                "id": "broadcast-ready",
                                "type": "self_broadcast",
                                "inputs": {
                                    "message": {
                                        "id": "broadcast-message",
                                        "type": "broadcast_input",
                                        "fields": { "message": "ready" }
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 3).unwrap();

    assert_eq!(
        snapshot.variables["var-waited"],
        nekoc::runtime::RuntimeValue::Number(1.0)
    );
    assert_eq!(snapshot.received_broadcasts, vec!["ready".to_owned()]);
}

#[test]
fn runtime_evaluates_binary_converter_expressions() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-decimal": { "id": "var-decimal", "name": "decimal", "value": 0 },
                "var-binary": { "id": "var-binary", "name": "binary", "value": "" },
                "var-remainder": { "id": "var-remainder", "name": "remainder", "value": 0 }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "converter",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "set-decimal",
                            "type": "variables_set",
                            "fields": { "variable": "var-decimal" },
                            "inputs": {
                                "value": { "id": "thirteen", "type": "math_number", "fields": { "NUM": "13" } }
                            },
                            "next": {
                                "id": "set-binary",
                                "type": "variables_set",
                                "fields": { "variable": "var-binary" },
                                "inputs": {
                                    "value": { "id": "empty", "type": "text", "fields": { "TEXT": "" } }
                                },
                                "next": {
                                    "id": "loop",
                                    "type": "repeat_forever_until",
                                    "inputs": {
                                        "condition": {
                                            "id": "decimal-is-zero",
                                            "type": "logic_compare",
                                            "fields": { "OP": "EQ" },
                                            "inputs": {
                                                "A": { "id": "get-decimal-condition", "type": "variables_get", "fields": { "variable": "var-decimal" } },
                                                "B": { "id": "zero", "type": "math_number", "fields": { "NUM": "0" } }
                                            }
                                        }
                                    },
                                    "statements": {
                                        "DO": {
                                            "id": "set-remainder",
                                            "type": "variables_set",
                                            "fields": { "variable": "var-remainder" },
                                            "inputs": {
                                                "value": {
                                                    "id": "mod",
                                                    "type": "math_arithmetic",
                                                    "fields": { "type": "mod" },
                                                    "inputs": {
                                                        "A": { "id": "get-decimal-mod", "type": "variables_get", "fields": { "variable": "var-decimal" } },
                                                        "B": { "id": "two-mod", "type": "math_number", "fields": { "NUM": "2" } }
                                                    }
                                                }
                                            },
                                            "next": {
                                                "id": "prepend-remainder",
                                                "type": "variables_set",
                                                "fields": { "variable": "var-binary" },
                                                "inputs": {
                                                    "value": {
                                                        "id": "join",
                                                        "type": "text_join",
                                                        "mutation": "<mutation items=\"2\"></mutation>",
                                                        "inputs": {
                                                            "ADD0": {
                                                                "id": "remainder-string",
                                                                "type": "convert_type",
                                                                "fields": { "type": "string" },
                                                                "inputs": {
                                                                    "text": { "id": "get-remainder", "type": "variables_get", "fields": { "variable": "var-remainder" } }
                                                                }
                                                            },
                                                            "ADD1": { "id": "get-binary", "type": "variables_get", "fields": { "variable": "var-binary" } }
                                                        }
                                                    }
                                                },
                                                "next": {
                                                    "id": "halve-decimal",
                                                    "type": "variables_set",
                                                    "fields": { "variable": "var-decimal" },
                                                    "inputs": {
                                                        "value": {
                                                            "id": "floor",
                                                            "type": "math_round",
                                                            "fields": { "type": "round_down" },
                                                            "inputs": {
                                                                "num": {
                                                                    "id": "divide",
                                                                    "type": "math_arithmetic",
                                                                    "fields": { "type": "divide" },
                                                                    "inputs": {
                                                                        "A": { "id": "get-decimal-divide", "type": "variables_get", "fields": { "variable": "var-decimal" } },
                                                                        "B": { "id": "two-divide", "type": "math_number", "fields": { "NUM": "2" } }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();

    assert_eq!(
        snapshot.variables["var-binary"],
        nekoc::runtime::RuntimeValue::String("1101".to_owned())
    );
    assert_eq!(
        snapshot.variables["var-decimal"],
        nekoc::runtime::RuntimeValue::Number(0.0)
    );
}

#[test]
fn runtime_evaluates_math_text_and_type_expressions() {
    let project = json!({
        "variables": {
            "variablesDict": {
                "var-x": { "id": "var-x", "name": "x", "value": 0 },
                "var-result": { "id": "var-result", "name": "result", "value": "" },
                "var-rounded": { "id": "var-rounded", "name": "rounded", "value": 0 },
                "var-char": { "id": "var-char", "name": "char", "value": "" },
                "var-power": { "id": "var-power", "name": "power", "value": 0 }
            }
        },
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "expressions",
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "set-x",
                            "type": "variables_set",
                            "fields": { "variable": "var-x" },
                            "inputs": {
                                "value": {
                                    "id": "add",
                                    "type": "math_arithmetic",
                                    "fields": { "type": "add" },
                                    "inputs": {
                                        "A": { "id": "two", "type": "math_number", "fields": { "NUM": "2" } },
                                        "B": {
                                            "id": "multiply",
                                            "type": "math_arithmetic",
                                            "fields": { "type": "multiply" },
                                            "inputs": {
                                                "A": { "id": "three", "type": "math_number", "fields": { "NUM": "3" } },
                                                "B": { "id": "four", "type": "math_number", "fields": { "NUM": "4" } }
                                            }
                                        }
                                    }
                                }
                            },
                            "next": {
                                "id": "if-result",
                                "type": "controls_if",
                                "inputs": {
                                    "IF0": {
                                        "id": "and",
                                        "type": "logic_operation",
                                        "fields": { "type": "and" },
                                        "inputs": {
                                            "A": {
                                                "id": "gte",
                                                "type": "logic_compare",
                                                "fields": { "OP": "GTE" },
                                                "inputs": {
                                                    "A": { "id": "get-x-gte", "type": "variables_get", "fields": { "variable": "var-x" } },
                                                    "B": { "id": "ten", "type": "math_number", "fields": { "NUM": "10" } }
                                                }
                                            },
                                            "B": {
                                                "id": "not-contains",
                                                "type": "logic_negate",
                                                "inputs": {
                                                    "logic": {
                                                        "id": "contains",
                                                        "type": "text_contain",
                                                        "inputs": {
                                                            "A": { "id": "hello", "type": "text", "fields": { "TEXT": "hello" } },
                                                            "B": { "id": "z", "type": "text", "fields": { "TEXT": "z" } }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                },
                                "statements": {
                                    "DO0": {
                                        "id": "set-result",
                                        "type": "variables_set",
                                        "fields": { "variable": "var-result" },
                                        "inputs": {
                                            "value": {
                                                "id": "join-result",
                                                "type": "text_join",
                                                "mutation": "<mutation items=\"2\"></mutation>",
                                                "inputs": {
                                                    "ADD0": { "id": "prefix", "type": "text", "fields": { "TEXT": "len=" } },
                                                    "ADD1": {
                                                        "id": "length-string",
                                                        "type": "convert_type",
                                                        "fields": { "type": "string" },
                                                        "inputs": {
                                                            "text": {
                                                                "id": "length",
                                                                "type": "text_length",
                                                                "inputs": {
                                                                    "text": { "id": "hello-length", "type": "text", "fields": { "TEXT": "hello" } }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                },
                                "next": {
                                    "id": "set-rounded",
                                    "type": "variables_set",
                                    "fields": { "variable": "var-rounded" },
                                    "inputs": {
                                        "value": {
                                            "id": "ceil",
                                            "type": "math_round",
                                            "fields": { "type": "round_up" },
                                            "inputs": {
                                                "num": {
                                                    "id": "minus",
                                                    "type": "math_arithmetic",
                                                    "fields": { "type": "minus" },
                                                    "inputs": {
                                                        "A": { "id": "get-x-minus", "type": "variables_get", "fields": { "variable": "var-x" } },
                                                        "B": { "id": "point-two", "type": "math_number", "fields": { "NUM": "0.2" } }
                                                    }
                                                }
                                            }
                                        }
                                    },
                                    "next": {
                                        "id": "set-char",
                                        "type": "variables_set",
                                        "fields": { "variable": "var-char" },
                                        "inputs": {
                                            "value": {
                                                "id": "select",
                                                "type": "text_select",
                                                "inputs": {
                                                    "text": { "id": "abc", "type": "text", "fields": { "TEXT": "abc" } },
                                                    "start_index": { "id": "second", "type": "math_number", "fields": { "NUM": "2" } }
                                                }
                                            }
                                        },
                                        "next": {
                                            "id": "set-power",
                                            "type": "variables_set",
                                            "fields": { "variable": "var-power" },
                                            "inputs": {
                                                "value": {
                                                    "id": "power",
                                                    "type": "math_arithmetic",
                                                    "fields": { "type": "power" },
                                                    "inputs": {
                                                        "A": { "id": "power-base", "type": "math_number", "fields": { "NUM": "2" } },
                                                        "B": { "id": "power-exp", "type": "math_number", "fields": { "NUM": "8" } }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();

    assert_eq!(
        snapshot.variables["var-result"],
        nekoc::runtime::RuntimeValue::String("len=5".to_owned())
    );
    assert_eq!(
        snapshot.variables["var-rounded"],
        nekoc::runtime::RuntimeValue::Number(14.0)
    );
    assert_eq!(
        snapshot.variables["var-char"],
        nekoc::runtime::RuntimeValue::String("b".to_owned())
    );
    assert_eq!(
        snapshot.variables["var-power"],
        nekoc::runtime::RuntimeValue::Number(256.0)
    );
}

#[test]
fn runtime_runs_appearance_actor_state_blocks() {
    let project = json!({
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "player",
                    "scale": 100,
                    "visible": true,
                    "nekoBlockJsonList": [{
                        "id": "start",
                        "type": "on_running_group_activated",
                        "next": {
                            "id": "hide",
                            "type": "self_appear",
                            "fields": { "value": "disappear" },
                            "next": {
                                "id": "set-scale",
                                "type": "set_scale",
                                "inputs": {
                                    "scale": {
                                        "id": "scale-120",
                                        "type": "math_number",
                                        "fields": { "NUM": "120" }
                                    }
                                },
                                "next": {
                                    "id": "change-scale",
                                    "type": "self_change_scale",
                                    "fields": { "increase": "decrease" },
                                    "inputs": {
                                        "scale": {
                                            "id": "scale-10",
                                            "type": "math_number",
                                            "fields": { "NUM": "10" }
                                        }
                                    }
                                }
                            }
                        }
                    }]
                }
            }
        }
    });

    let snapshot = nekoc::runtime::run_project(&project, 1).unwrap();
    let actor = snapshot.actors.get("actor-1").unwrap();
    assert!(!actor.visible);
    assert_eq!(actor.scale, 110.0);
}

#[test]
fn cli_decompile_native_sample_reports_graph_summary() {
    let sample = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");
    let dir = tempdir().unwrap();
    let report = dir.path().join("native-decompile.json");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "decompile",
            sample.to_str().unwrap(),
            "--out",
            report.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(report).unwrap()).unwrap();
    assert_eq!(report["project_name"], "我的作品");
    assert_eq!(report["summary"]["owners"], 4);
    assert_eq!(report["summary"]["scripts"], 15);
    assert_eq!(report["summary"]["blocks"], 125);
    assert_eq!(report["owners"][0]["kind"], "actor");
    assert!(report["owners"][0]["scripts"][0]["entry_type"].is_string());
}

#[test]
fn cli_workspace_native_sample_exports_workspace_data() {
    let sample = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");
    let dir = tempdir().unwrap();
    let report = dir.path().join("native-workspace.json");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "workspace",
            sample.to_str().unwrap(),
            "--out",
            report.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(report).unwrap()).unwrap();
    assert_eq!(report["project_name"], "我的作品");
    assert_eq!(report["summary"]["owners"], 4);
    assert_eq!(report["summary"]["scripts"], 15);
    assert_eq!(report["summary"]["blocks"], 125);
    assert!(report["summary"]["connections"].as_u64().unwrap() > 0);
    assert!(report["owners"][0]["workspaceData"]["blocks"].is_object());
    assert!(report["owners"][0]["workspaceData"]["connections"].is_object());
}

#[test]
fn cli_compile_ts_emits_workspace_graph_for_basic_dsl() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let output = dir.path().join("workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 0);
  wait(0.5);
  forever(() => {
    changeVar("score", 1);
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = &report["workspaceData"]["blocks"];
    let connections = &report["workspaceData"]["connections"];

    assert_eq!(report["source"], input.to_string_lossy().as_ref());
    assert_eq!(report["summary"]["scripts"], 1);
    assert_eq!(report["summary"]["blocks"], 8);
    assert_eq!(blocks["b1"]["type"], "on_running_group_activated");
    assert_eq!(blocks["b2"]["type"], "variables_set");
    assert_eq!(blocks["b3"]["type"], "math_number");
    assert_eq!(blocks["b4"]["type"], "wait");
    assert_eq!(blocks["b5"]["type"], "math_number");
    assert_eq!(blocks["b6"]["type"], "repeat_forever");
    assert_eq!(blocks["b7"]["type"], "change_variables");
    assert_eq!(blocks["b8"]["type"], "math_number");
    assert_eq!(connections["b1"]["b2"]["type"], "next");
    assert_eq!(connections["b2"]["b3"]["input_name"], "value");
    assert_eq!(connections["b4"]["b5"]["input_name"], "time");
    assert_eq!(connections["b6"]["b7"]["input_type"], "statement");
    assert_eq!(blocks["b7"]["fields"]["method"], "increase");
    assert_eq!(connections["b7"]["b8"]["input_name"], "value");
}

#[test]
fn cli_compile_ts_can_emit_conservative_ir_sidecar() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let output = dir.path().join("workspace.json");
    let ir_output = dir.path().join("program.ir.json");
    fs::write(
        &input,
        r#"
stage({
  name: "main",
  backdrop: "https://example.com/bg.png",
});

sprite("player", {
  costume: "https://example.com/player.png",
  x: 12,
  y: -34,
}, () => {
  onStart(() => {
    setVar("score", 1);
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
            "--emit-ir",
            ir_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let ir: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(ir_output).unwrap()).unwrap();

    assert_eq!(ir["format"], "nekoc-ir");
    assert_eq!(ir["version"], 1);
    assert_eq!(ir["source"], input.to_string_lossy().as_ref());
    assert_eq!(ir["summary"]["scripts"], 1);
    assert_eq!(ir["summary"]["sprites"], 1);
    assert_eq!(ir["resources"]["stage"]["name"], "main");
    assert_eq!(
        ir["resources"]["stage"]["backdrop"],
        "https://example.com/bg.png"
    );
    assert_eq!(ir["resources"]["sprites"][0]["name"], "player");
    assert_eq!(
        ir["resources"]["sprites"][0]["costume"],
        "https://example.com/player.png"
    );
    assert_eq!(ir["actors"][0]["name"], "player");
    assert_eq!(ir["actors"][0]["scripts"][0]["event"], "on_start");
    assert_eq!(
        ir["actors"][0]["scripts"][0]["entry_block_type"],
        "on_running_group_activated"
    );
}

#[test]
fn cli_compile_ts_ir_lifts_basic_statements() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let output = dir.path().join("workspace.json");
    let ir_output = dir.path().join("program.ir.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 0);
  wait(0.5);
  forever(() => {
    changeVar("score", 1);
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
            "--emit-ir",
            ir_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let ir: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(ir_output).unwrap()).unwrap();
    let body = ir["actors"][0]["scripts"][0]["body"].as_array().unwrap();

    assert_eq!(body[0]["kind"], "set_var");
    assert_eq!(body[0]["variable"], "score");
    assert_eq!(body[0]["value"], json!({"kind": "number", "value": 0.0}));
    assert_eq!(body[1]["kind"], "wait");
    assert_eq!(body[1]["seconds"], json!({"kind": "number", "value": 0.5}));
    assert_eq!(body[2]["kind"], "forever");
    assert_eq!(body[2]["body"][0]["kind"], "change_var");
    assert_eq!(body[2]["body"][0]["variable"], "score");
    assert_eq!(body[2]["body"][0]["method"], "increase");
    assert_eq!(
        body[2]["body"][0]["value"],
        json!({"kind": "number", "value": 1.0})
    );
}

#[test]
fn cli_compile_ts_ir_lifts_screen_resources() {
    let dir = tempdir().unwrap();
    let input = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("multi_screen.ts");
    let output = dir.path().join("workspace.json");
    let ir_output = dir.path().join("program.ir.json");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
            "--emit-ir",
            ir_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let ir: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(ir_output).unwrap()).unwrap();
    let screens = ir["screens"].as_array().unwrap();
    let menu = screens
        .iter()
        .find(|screen| screen["name"] == "menu")
        .unwrap();
    let game = screens
        .iter()
        .find(|screen| screen["name"] == "game")
        .unwrap();

    assert_eq!(ir["summary"]["screens"], 2);
    assert_eq!(ir["summary"]["sprites"], 2);
    assert_eq!(menu["id"], "nekoc-screen-menu");
    assert_eq!(game["id"], "nekoc-screen-game");
    assert_eq!(menu["actors"][0]["name"], "start");
    assert_eq!(game["actors"][0]["name"], "player");
    assert_eq!(menu["actors"][0]["scripts"][0]["event"], "on_start");
    let menu_body = menu["actors"][0]["scripts"][0]["body"].as_array().unwrap();
    let switch_screen = menu_body
        .iter()
        .find(|statement| statement["kind"] == "switch_screen")
        .unwrap();
    assert_eq!(switch_screen["target"], "game");
}

#[test]
fn cli_compile_ts_ir_lifts_motion_expressions() {
    let dir = tempdir().unwrap();
    let input = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("three_body.ts");
    let output = dir.path().join("workspace.json");
    let ir_output = dir.path().join("program.ir.json");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
            "--emit-ir",
            ir_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let ir: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(ir_output).unwrap()).unwrap();
    let screen = ir["screens"]
        .as_array()
        .unwrap()
        .iter()
        .find(|screen| screen["name"] == "Three Body Demo")
        .unwrap();
    let body_a = screen["actors"]
        .as_array()
        .unwrap()
        .iter()
        .find(|actor| actor["name"] == "body-a")
        .unwrap();
    let script_body = body_a["scripts"][0]["body"].as_array().unwrap();
    let loop_body = script_body
        .iter()
        .find(|statement| statement["kind"] == "forever")
        .unwrap()["body"]
        .as_array()
        .unwrap();

    let set_x = loop_body
        .iter()
        .find(|statement| statement["kind"] == "set_x")
        .unwrap();
    assert_eq!(set_x["value"]["kind"], "binary");
    assert_eq!(set_x["value"]["op"], "multiply");
    assert_eq!(
        set_x["value"]["left"],
        json!({"kind": "number", "value": 90.0})
    );
    assert_eq!(set_x["value"]["right"]["kind"], "trig");
    assert_eq!(set_x["value"]["right"]["op"], "cos");
    assert_eq!(
        set_x["value"]["right"]["value"],
        json!({"kind": "get_var", "variable": "phaseA"})
    );

    let set_y = loop_body
        .iter()
        .find(|statement| statement["kind"] == "set_y")
        .unwrap();
    assert_eq!(set_y["value"]["kind"], "binary");
    assert_eq!(set_y["value"]["op"], "multiply");
    assert_eq!(
        set_y["value"]["left"],
        json!({"kind": "number", "value": 55.0})
    );
    assert_eq!(set_y["value"]["right"]["kind"], "trig");
    assert_eq!(set_y["value"]["right"]["op"], "sin");
    assert_eq!(
        set_y["value"]["right"]["value"],
        json!({"kind": "get_var", "variable": "phaseA"})
    );
}

#[test]
fn cli_compile_ts_ir_lifts_control_flow_and_logic() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let output = dir.path().join("workspace.json");
    let ir_output = dir.path().join("program.ir.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 0);
  ifElse(and(gte(getVar("score"), 10), not(bool(false))), () => {
    setVar("state", 1);
  }, () => {
    setVar("state", 0);
  });
  repeatTimes(3, () => {
    changeVar("score", 1);
    ifThen(gt(getVar("score"), 2), () => {
      breakLoop();
    });
  });
  repeatUntil(eq(getVar("score"), 0), () => {
    changeVar("score", -1);
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
            "--emit-ir",
            ir_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let ir: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(ir_output).unwrap()).unwrap();
    let body = ir["actors"][0]["scripts"][0]["body"].as_array().unwrap();

    let branch = body
        .iter()
        .find(|statement| statement["kind"] == "if")
        .unwrap();
    assert_eq!(branch["condition"]["kind"], "logic");
    assert_eq!(branch["condition"]["op"], "and");
    assert_eq!(branch["condition"]["left"]["kind"], "compare");
    assert_eq!(branch["condition"]["left"]["op"], "GTE");
    assert_eq!(branch["condition"]["right"]["kind"], "not");
    assert_eq!(
        branch["condition"]["right"]["value"],
        json!({"kind": "boolean", "value": false})
    );
    assert_eq!(branch["then"][0]["kind"], "set_var");
    assert_eq!(branch["else"][0]["kind"], "set_var");

    let repeat = body
        .iter()
        .find(|statement| statement["kind"] == "repeat_times")
        .unwrap();
    assert_eq!(repeat["times"], json!({"kind": "number", "value": 3.0}));
    assert_eq!(repeat["body"][0]["kind"], "change_var");
    let nested_if = repeat["body"]
        .as_array()
        .unwrap()
        .iter()
        .find(|statement| statement["kind"] == "if")
        .unwrap();
    assert_eq!(nested_if["condition"]["kind"], "compare");
    assert_eq!(nested_if["condition"]["op"], "GT");
    assert_eq!(nested_if["then"][0]["kind"], "break");

    let repeat_until = body
        .iter()
        .find(|statement| statement["kind"] == "repeat_until")
        .unwrap();
    assert_eq!(repeat_until["condition"]["kind"], "compare");
    assert_eq!(repeat_until["condition"]["op"], "EQ");
    assert_eq!(repeat_until["body"][0]["kind"], "change_var");
}

#[test]
fn cli_compile_ts_ir_reports_script_variable_data_flow() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let output = dir.path().join("workspace.json");
    let ir_output = dir.path().join("program.ir.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 0);
  setVar("unused", 1);
  ifThen(gt(getVar("score"), 2), () => {
    setVar("score", add(getVar("score"), getVar("bonus")));
    setVar("state", getVar("score"));
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
            "--emit-ir",
            ir_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let ir: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(ir_output).unwrap()).unwrap();
    let data_flow = &ir["actors"][0]["scripts"][0]["data_flow"];

    assert_eq!(data_flow["reads"], json!(["bonus", "score"]));
    assert_eq!(data_flow["writes"], json!(["score", "state", "unused"]));
}

#[test]
fn cli_analyze_ir_reports_variable_usage() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let workspace_output = dir.path().join("workspace.json");
    let ir_output = dir.path().join("program.ir.json");
    let analysis_output = dir.path().join("analysis.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 0);
  setVar("unused", 1);
  setVar("result", add(getVar("score"), getVar("external")));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            workspace_output.to_str().unwrap(),
            "--emit-ir",
            ir_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "analyze-ir",
            ir_output.to_str().unwrap(),
            "--out",
            analysis_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let analysis: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(analysis_output).unwrap()).unwrap();

    assert_eq!(analysis["format"], "nekoc-analysis");
    assert_eq!(analysis["summary"]["scripts"], 1);
    assert_eq!(
        analysis["summary"]["variables"]["written_not_read"],
        json!(["result", "unused"])
    );
    assert_eq!(
        analysis["summary"]["variables"]["read_not_written"],
        json!(["external"])
    );
    assert_eq!(analysis["scripts"][0]["actor"], "main");
    assert_eq!(analysis["scripts"][0]["event"], "on_start");
    assert_eq!(
        analysis["scripts"][0]["reads"],
        json!(["external", "score"])
    );
    assert_eq!(
        analysis["scripts"][0]["writes"],
        json!(["result", "score", "unused"])
    );
    assert_eq!(
        analysis["warnings"],
        json!([
            {
                "kind": "external_read",
                "severity": "info",
                "variable": "external",
                "message": "variable is read but never written in this IR"
            },
            {
                "kind": "unused_write",
                "severity": "warning",
                "variable": "result",
                "message": "variable is written but never read"
            },
            {
                "kind": "unused_write",
                "severity": "warning",
                "variable": "unused",
                "message": "variable is written but never read"
            }
        ])
    );
}

#[test]
fn cli_compile_ts_can_emit_analysis_sidecar() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let workspace_output = dir.path().join("workspace.json");
    let ir_output = dir.path().join("program.ir.json");
    let analysis_output = dir.path().join("analysis.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("unused", 1);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            workspace_output.to_str().unwrap(),
            "--emit-ir",
            ir_output.to_str().unwrap(),
            "--emit-analysis",
            analysis_output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let ir: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(ir_output).unwrap()).unwrap();
    let analysis: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(analysis_output).unwrap()).unwrap();

    assert_eq!(ir["format"], "nekoc-ir");
    assert_eq!(analysis["format"], "nekoc-analysis");
    assert_eq!(
        analysis["warnings"],
        json!([{
            "kind": "unused_write",
            "severity": "warning",
            "variable": "unused",
            "message": "variable is written but never read"
        }])
    );
}

#[test]
fn cli_compile_ts_bcmkn_injects_nested_blocks_into_template() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let output = dir.path().join("compiled.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 0);
  wait(0.5);
  forever(() => {
    changeVar("score", 1);
  });
});
"#,
    )
    .unwrap();

    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let compiled = nekoc::project::load_project(&output).unwrap();
    let report = nekoc::decompile::build_report(&compiled.value).unwrap();
    let actor = compiled.value["actors"]["actorsDict"]
        .as_object()
        .unwrap()
        .values()
        .find(|actor| {
            actor["nekoBlockJsonList"]
                .as_array()
                .map(|blocks| !blocks.is_empty())
                .unwrap_or(false)
        })
        .unwrap();

    assert_eq!(compiled.value["projectName"], "main");
    assert!(actor["comments"].as_object().unwrap().is_empty());
    let variables = compiled.value["variables"]["variablesDict"]
        .as_object()
        .unwrap();
    assert!(
        variables
            .values()
            .any(|variable| variable["name"] == "score")
    );
    assert_eq!(report["summary"]["scripts"], 1);
    assert_eq!(report["summary"]["blocks"], 8);
    assert_eq!(
        report["owners"][0]["scripts"][0]["sequence_types"],
        json!([
            "on_running_group_activated",
            "variables_set",
            "wait",
            "repeat_forever"
        ])
    );
    let blocks = report["owners"][0]["scripts"][0]["blocks"]
        .as_array()
        .unwrap();
    assert!(
        blocks
            .iter()
            .any(|block| block["path"] == "$.next.inputs.value")
    );
    assert!(
        blocks
            .iter()
            .any(|block| block["path"] == "$.next.next.next.statements.DO.inputs.value")
    );
}

#[test]
fn validate_report_catches_dangling_comment_parent() {
    let value: serde_json::Value = json!({
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "角色",
                    "comments": {
                        "comment-1": {
                            "id": "comment-1",
                            "parent_id": "missing-block"
                        }
                    },
                    "nekoBlockJsonList": [
                        {
                            "type": "on_running_group_activated",
                            "id": "event-1",
                            "parent_id": ""
                        }
                    ]
                }
            }
        },
        "scenes": {"scenesDict": {}}
    });

    let report = nekoc::validate::build_report(&value).unwrap();

    assert_eq!(report["ok"], false);
    assert_eq!(report["issues"][0]["kind"], "dangling_comment_parent");
    assert_eq!(report["issues"][0]["owner_id"], "actor-1");
    assert_eq!(report["issues"][0]["comment_id"], "comment-1");
}

#[test]
fn validate_report_catches_screen_structure_issues() {
    let value: serde_json::Value = json!({
        "actors": {
            "actorsDict": {
                "actor-1": {
                    "id": "actor-1",
                    "name": "start",
                    "comments": {},
                    "nekoBlockJsonList": [
                        {
                            "type": "on_running_group_activated",
                            "id": "event-1",
                            "parent_id": "",
                            "next": {
                                "type": "switch_to_screen",
                                "id": "switch-1",
                                "parent_id": "event-1",
                                "inputs": {
                                    "screen_id": {
                                        "type": "get_screens",
                                        "id": "screen-input-1",
                                        "parent_id": "switch-1",
                                        "fields": {"screen_id": "missing-screen"}
                                    }
                                }
                            }
                        }
                    ]
                }
            }
        },
        "scenes": {
            "currentSceneId": "scene-1",
            "sortList": ["scene-1"],
            "scenesDict": {
                "scene-1": {
                    "id": "scene-1",
                    "name": "menu",
                    "actorIds": ["actor-1", "missing-actor"],
                    "comments": {},
                    "nekoBlockJsonList": []
                },
                "scene-2": {
                    "id": "scene-2",
                    "name": "game",
                    "actorIds": ["actor-1"],
                    "comments": {},
                    "nekoBlockJsonList": []
                }
            }
        }
    });

    let report = nekoc::validate::build_report(&value).unwrap();
    let kinds = report["issues"]
        .as_array()
        .unwrap()
        .iter()
        .map(|issue| issue["kind"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(report["ok"], false);
    assert!(kinds.contains(&"scene_missing_from_sort_list"));
    assert!(kinds.contains(&"dangling_scene_actor"));
    assert!(kinds.contains(&"actor_in_multiple_scenes"));
    assert!(kinds.contains(&"dangling_screen_reference"));
}

#[test]
fn cli_validate_compiled_basic_project_passes() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("main.ts");
    let output = dir.path().join("compiled.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 0);
  wait(0.5);
  forever(() => {
    changeVar("score", 1);
  });
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("No validation issues"));
}

#[test]
fn cli_compile_ts_supports_binary_converter_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("binary.ts");
    let output = dir.path().join("binary-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("decimal", 13);
  setVar("binary", "");
  repeatUntil(eq(getVar("decimal"), 0), () => {
    setVar("remainder", mod(getVar("decimal"), 2));
    setVar("binary", join(toString(getVar("remainder")), getVar("binary")));
    setVar("decimal", floor(div(getVar("decimal"), 2)));
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"repeat_forever_until"));
    assert!(block_types.contains(&"logic_compare"));
    assert!(block_types.contains(&"variables_get"));
    assert!(block_types.contains(&"math_modulo"));
    assert!(block_types.contains(&"text_join"));
    assert!(block_types.contains(&"convert_type"));
    assert!(block_types.contains(&"math_round"));
    assert!(block_types.contains(&"math_arithmetic"));
    assert_eq!(report["summary"]["scripts"], 1);
}

#[test]
fn cli_compile_ts_bcmkn_binary_converter_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("binary.ts");
    let output = dir.path().join("binary.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("decimal", 13);
  setVar("binary", "");
  repeatUntil(eq(getVar("decimal"), 0), () => {
    setVar("remainder", mod(getVar("decimal"), 2));
    setVar("binary", join(toString(getVar("remainder")), getVar("binary")));
    setVar("decimal", floor(div(getVar("decimal"), 2)));
  });
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_condition_math_logic_and_text_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("conditions.ts");
    let output = dir.path().join("conditions-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("x", add(2, mul(3, 4)));
  ifElse(and(gte(getVar("x"), 10), not(contains("hello", "z"))), () => {
    setVar("result", join("len=", toString(length("hello"))));
  }, () => {
    setVar("result", "small");
  });
  ifThen(or(lt(getVar("x"), 20), neq(getVar("x"), 14)), () => {
    setVar("rounded", ceil(sub(getVar("x"), 0.2)));
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"controls_if"));
    assert!(block_types.contains(&"logic_operation"));
    assert!(block_types.contains(&"logic_negate"));
    assert!(block_types.contains(&"text_length"));
    assert!(block_types.contains(&"text_contain"));
    assert_eq!(
        block_types
            .iter()
            .filter(|&&ty| ty == "controls_if")
            .count(),
        2
    );
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "logic_compare" && block["fields"]["OP"] == "GTE" })
    );
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "logic_compare" && block["fields"]["OP"] == "LT" })
    );
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "logic_compare" && block["fields"]["OP"] == "NEQ" })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "math_arithmetic" && block["fields"]["type"] == "multiply"
    }));
    assert!(
        blocks.values().any(|block| {
            block["type"] == "math_arithmetic" && block["fields"]["type"] == "minus"
        })
    );
    assert!(
        blocks.values().any(|block| {
            block["type"] == "math_round" && block["fields"]["type"] == "round_up"
        })
    );
}

#[test]
fn cli_compile_ts_bcmkn_condition_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("conditions.ts");
    let output = dir.path().join("conditions.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("x", add(2, mul(3, 4)));
  ifElse(and(gte(getVar("x"), 10), not(contains("hello", "z"))), () => {
    setVar("result", join("len=", toString(length("hello"))));
  }, () => {
    setVar("result", "small");
  });
  ifThen(or(lt(getVar("x"), 20), neq(getVar("x"), 14)), () => {
    setVar("rounded", ceil(sub(getVar("x"), 0.2)));
  });
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_events_and_broadcast_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("events.ts");
    let output = dir.path().join("events-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  broadcast("ready");
});

onClick(() => {
  broadcastAndWait("clicked");
});

onKey("81", "up", () => {
  setVar("key", "q");
});

onMessage("ready", () => {
  setVar("heard", 1);
});

when(eq(getVar("heard"), 1), () => {
  setVar("condition", "met");
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert_eq!(report["summary"]["scripts"], 5);
    assert!(block_types.contains(&"on_running_group_activated"));
    assert!(block_types.contains(&"start_on_click"));
    assert!(block_types.contains(&"on_keydown"));
    assert!(block_types.contains(&"self_listen"));
    assert!(block_types.contains(&"when"));
    assert!(block_types.contains(&"self_broadcast"));
    assert!(block_types.contains(&"self_broadcast_and_wait"));
    assert!(block_types.contains(&"broadcast_input"));
    assert!(blocks.values().any(|block| {
        block["type"] == "on_keydown"
            && block["fields"]["key"] == "81"
            && block["fields"]["type"] == "up"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "broadcast_input" && block["fields"]["message"] == "ready"
    }));
}

#[test]
fn cli_compile_ts_bcmkn_events_and_broadcast_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("events.ts");
    let output = dir.path().join("events.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  broadcast("ready");
});

onClick(() => {
  broadcastAndWait("clicked");
});

onKey("81", "up", () => {
  setVar("key", "q");
});

onMessage("ready", () => {
  setVar("heard", 1);
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let broadcast_values = project["broadcasts"]["broadcastsDict"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|value| value.as_array().unwrap().iter())
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>();
    assert!(broadcast_values.contains(&"ready"));
    assert!(broadcast_values.contains(&"clicked"));
}

#[test]
fn cli_compile_ts_supports_parameterized_broadcast_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("broadcast_param.ts");
    let output = dir.path().join("broadcast-param-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  broadcast("score:update", getVar("score"));
});

onMessage("score:update", "payload", () => {
  setVar("lastScore", messageValue("payload"));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"self_broadcast_with_param"));
    assert!(block_types.contains(&"self_listen_with_param"));
    assert!(block_types.contains(&"self_listen_param"));
    assert!(block_types.contains(&"self_listen_value"));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_listen_with_param"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>"#
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_listen_param" && block["fields"]["TEXT"] == "payload"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_listen_value" && block["fields"]["TEXT"] == "payload"
    }));
}

#[test]
fn cli_compile_ts_bcmkn_parameterized_broadcast_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("broadcast_param.ts");
    let output = dir.path().join("broadcast_param.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("score", 42);
  broadcast("score:update", getVar("score"));
});

onMessage("score:update", "payload", () => {
  setVar("lastScore", messageValue("payload"));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let broadcast_values = project["broadcasts"]["broadcastsDict"]
        .as_object()
        .unwrap()
        .values()
        .flat_map(|value| value.as_array().unwrap().iter())
        .filter_map(|value| value.as_str())
        .collect::<Vec<_>>();
    assert!(broadcast_values.contains(&"score:update"));
}

#[test]
fn cli_compile_ts_supports_received_broadcast_and_bump_actor() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("event_extra.ts");
    let output = dir.path().join("event-extra-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  broadcast("ready");
  ifThen(receivedBroadcast("ready"), () => {
    setVar("received", 1);
  });
});

onBumpActor("start", "--self", "actor", () => {
  setVar("bumped", bumpActorValue("actor", "x"));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"received_broadcast"));
    assert!(block_types.contains(&"on_bump_actor"));
    assert!(block_types.contains(&"on_bump_actor_param"));
    assert!(block_types.contains(&"on_bump_actor_value"));
    assert!(blocks.values().any(|block| {
        block["type"] == "on_bump_actor"
            && block["fields"]["type"] == "start"
            && block["fields"]["sprite"] == "--self"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>"#
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "on_bump_actor_param" && block["fields"]["TEXT"] == "actor"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "on_bump_actor_value"
            && block["fields"]["TEXT"] == "actor"
            && block["fields"]["attribute"] == "x"
    }));
}

#[test]
fn cli_compile_ts_bcmkn_received_broadcast_and_bump_actor_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("event_extra.ts");
    let output = dir.path().join("event_extra.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  broadcast("ready");
  ifThen(receivedBroadcast("ready"), () => {
    setVar("received", 1);
  });
});

onBumpActor("start", "--self", "actor", () => {
  setVar("bumped", bumpActorValue("actor", "x"));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_control_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("control.ts");
    let output = dir.path().join("control-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("i", 0);
  repeatTimes(3, () => {
    changeVar("i", 1);
    consoleLog(join("loop=", toString(getVar("i"))));
    ifThen(gt(getVar("i"), 1), () => {
      breakLoop();
    });
  });
  waitUntil(receivedBroadcast("ready"));
  warp(() => {
    setVar("fast", 1);
  });
  tell("--self", () => {
    setVar("told", 1);
  });
  tellAndWait("--self", () => {
    setVar("syncTold", 1);
  });
  stop("1");
  restart();
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"repeat_n_times"));
    assert!(block_types.contains(&"console_log"));
    assert!(block_types.contains(&"break"));
    assert!(block_types.contains(&"wait_until"));
    assert!(block_types.contains(&"warp"));
    assert!(block_types.contains(&"tell"));
    assert!(block_types.contains(&"sync_tell"));
    assert!(block_types.contains(&"stop"));
    assert!(block_types.contains(&"restart"));
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "stop" && block["fields"]["scope"] == "1" })
    );
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "tell" && block["fields"]["sprite"] == "--self" })
    );
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "sync_tell" && block["fields"]["sprite"] == "--self" })
    );
}

#[test]
fn cli_compile_ts_supports_for_range_control_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("range.ts");
    let output = dir.path().join("range-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  forRange("n", 1, 5, 1, () => {
    setVar("last", rangeValue("n"));
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();

    assert!(blocks.values().any(|block| {
        block["type"] == "traverse_number"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="2"></mutation>"#
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "traverse_number_param" && block["fields"]["TEXT"] == "n"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "traverse_number_value" && block["fields"]["TEXT"] == "n"
    }));
}

#[test]
fn cli_compile_ts_bcmkn_control_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("control.ts");
    let output = dir.path().join("control.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("i", 0);
  repeatTimes(3, () => {
    changeVar("i", 1);
    ifThen(gt(getVar("i"), 1), () => {
      breakLoop();
    });
  });
  waitUntil(receivedBroadcast("ready"));
  warp(() => {
    setVar("fast", 1);
  });
  tell("--self", () => {
    setVar("told", 1);
  });
  tellAndWait("--self", () => {
    setVar("syncTold", 1);
  });
  stop("1");
  restart();
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_motion_actor_statement_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("motion.ts");
    let output = dir.path().join("motion-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  moveSteps(10);
  moveTo(100, -50);
  glideTo(0.5, 0, 0);
  setX(12);
  setY(34);
  changeX(5);
  changeY(-6);
  glideChangeX(0.2, 7);
  glideChangeY(0.3, -8);
  turn(15);
  pointTowards(90);
  rotateAround("--self", 45);
  faceTo("--mouse");
  setFaceTo("--random");
  moveToTarget("--mouse");
  moveToTargetSprite("--random");
  bounceOffEdge();
  setRotationType("1");
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"self_go_forward"));
    assert!(block_types.contains(&"self_move_to"));
    assert!(block_types.contains(&"self_glide_to"));
    assert!(block_types.contains(&"self_set_position_x"));
    assert!(block_types.contains(&"self_set_position_y"));
    assert!(block_types.contains(&"self_change_coordinate_x"));
    assert!(block_types.contains(&"self_change_coordinate_y"));
    assert!(block_types.contains(&"self_glide_coordinate_x"));
    assert!(block_types.contains(&"self_glide_coordinate_y"));
    assert!(block_types.contains(&"self_rotate"));
    assert!(block_types.contains(&"self_point_towards"));
    assert!(block_types.contains(&"self_rotate_around"));
    assert!(block_types.contains(&"self_face_to"));
    assert!(block_types.contains(&"self_face_to_sprite"));
    assert!(block_types.contains(&"self_move_specify"));
    assert!(block_types.contains(&"self_move_specify_sprite"));
    assert!(block_types.contains(&"self_bounce_off_edge"));
    assert!(block_types.contains(&"self_set_rotation_type"));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_change_coordinate_x" && block["fields"]["increase"] == "increase"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_change_coordinate_y" && block["fields"]["increase"] == "decrease"
    }));
    let change_y_block = blocks
        .values()
        .find(|block| block["type"] == "self_change_coordinate_y")
        .expect("missing self_change_coordinate_y block");
    assert!(blocks.values().any(|block| {
        block["parent_id"] == change_y_block["id"]
            && block["type"] == "math_number"
            && block["fields"]["NUM"] == "6"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_glide_coordinate_y" && block["fields"]["increase"] == "decrease"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_set_rotation_type" && block["fields"]["rotation_type"] == "1"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_rotate_around" && block["fields"]["sprite"] == "--self"
    }));
}

#[test]
fn cli_compile_ts_supports_motion_actor_expression_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("motion_expr.ts");
    let output = dir.path().join("motion-expr-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("x", xOf("--self"));
  setVar("y", yOf("--self"));
  setVar("distance", distanceTo("--mouse"));
  setVar("tilt", orientation("x"));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();

    assert!(blocks.values().any(|block| {
        block["type"] == "coordinate_of_sprite"
            && block["fields"]["sprite"] == "--self"
            && block["fields"]["coordinate"] == "x"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "coordinate_of_sprite"
            && block["fields"]["sprite"] == "--self"
            && block["fields"]["coordinate"] == "y"
    }));
    assert!(
        blocks.values().any(|block| {
            block["type"] == "distance_to" && block["fields"]["sprite"] == "--mouse"
        })
    );
    assert!(
        blocks.values().any(|block| {
            block["type"] == "get_orientation" && block["fields"]["target"] == "x"
        })
    );
}

#[test]
fn cli_compile_ts_bcmkn_motion_actor_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("motion.ts");
    let output = dir.path().join("motion.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  moveSteps(10);
  moveTo(100, -50);
  glideTo(0.5, 0, 0);
  changeX(5);
  changeY(-6);
  turn(15);
  pointTowards(90);
  faceTo("--mouse");
  moveToTarget("--mouse");
  bounceOffEdge();
  setRotationType("1");
  setVar("distance", distanceTo("--mouse"));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_appearance_display_statement_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("appearance.ts");
    let output = dir.path().join("appearance-workspace.json");
    fs::write(
        &input,
        r##"
onStart(() => {
  show();
  hide();
  appearWith("appear", "up", "slideIn");
  fadeVisibility(0.5, "hide");
  say("hello", 2);
  think("hmm");
  closeDialog();
  stageDialog("--self", "system");
  ask("name?");
  setScale(120);
  changeScale(-10);
  setSize("width", 80);
  changeSize("height", 5);
  setEffect("2", 80);
  changeEffect("2", -20);
  clearEffects();
  setText("Score");
  setTextSize(24);
  setTextColor("#ff0000");
  setLayer("peak", "bottom");
  setDraggable("1");
  setCamp("camp_red");
  stressAnimation("shake");
  globalAnimation("animation_firework");
  showTimer();
  hideTimer();
  showVariable("score");
  hideVariable("score");
});
"##,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"self_appear"));
    assert!(block_types.contains(&"self_appear_animation"));
    assert!(block_types.contains(&"self_gradually_show_hide"));
    assert!(block_types.contains(&"self_dialog"));
    assert!(block_types.contains(&"self_dialog_wait"));
    assert!(block_types.contains(&"close_self_dialog"));
    assert!(block_types.contains(&"create_stage_dialog"));
    assert!(block_types.contains(&"self_ask"));
    assert!(block_types.contains(&"set_scale"));
    assert!(block_types.contains(&"self_change_scale"));
    assert!(block_types.contains(&"set_width_height_scale"));
    assert!(block_types.contains(&"add_width_height_scale"));
    assert!(block_types.contains(&"self_set_effect"));
    assert!(block_types.contains(&"self_change_effect"));
    assert!(block_types.contains(&"clear_all_effects"));
    assert!(block_types.contains(&"self_text_effect_text"));
    assert!(block_types.contains(&"self_text_effect_size"));
    assert!(block_types.contains(&"self_text_effect_color"));
    assert!(block_types.contains(&"set_top_bottom_layer"));
    assert!(block_types.contains(&"self_set_draggable"));
    assert!(block_types.contains(&"self_set_role_camp"));
    assert!(block_types.contains(&"self_stress_animation"));
    assert!(block_types.contains(&"global_animation"));
    assert!(block_types.contains(&"show_hide_timer"));
    assert!(block_types.contains(&"show_hide_variables"));
    assert!(
        blocks.values().any(|block| {
            block["type"] == "self_appear" && block["fields"]["value"] == "appear"
        })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "self_appear" && block["fields"]["value"] == "disappear"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_change_scale" && block["fields"]["increase"] == "decrease"
    }));
    let change_scale_block = blocks
        .values()
        .find(|block| block["type"] == "self_change_scale")
        .expect("missing self_change_scale block");
    assert!(blocks.values().any(|block| {
        block["parent_id"] == change_scale_block["id"]
            && block["type"] == "math_number"
            && block["fields"]["NUM"] == "10"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_change_effect" && block["fields"]["increase"] == "decrease"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "show_hide_timer" && block["fields"]["showHide"] == "show"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "show_hide_variables"
            && block["fields"]["show_hide"] == "hide"
            && block["fields"]["variable"] == "score"
    }));
}

#[test]
fn cli_compile_ts_supports_style_screen_and_appearance_expression_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("style_screen.ts");
    let output = dir.path().join("style-screen-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  nextStyle();
  prevStyle();
  setStyle("style-1");
  setScreenTransition("left", "slide");
  switchScreen("scene-1");
  setVar("style", styleOf("--self"));
  setVar("scale", appearanceOf("--self", "scale"));
  setVar("ghost", effectOf("--self", "2"));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();

    assert!(blocks.values().any(|block| {
        block["type"] == "self_prev_next_style" && block["fields"]["prev_next"] == "next"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_prev_next_style" && block["fields"]["prev_next"] == "prev"
    }));
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "set_sprite_style" })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "get_styles" && block["fields"]["style_id"] == "style-1"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "set_screen_transition"
            && block["fields"]["direction"] == "left"
            && block["fields"]["type"] == "slide"
    }));
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "switch_to_screen" })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "get_screens" && block["fields"]["screen_id"] == "scene-1"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "style_of_sprite" && block["fields"]["sprite"] == "--self"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "appearance_of_sprite"
            && block["fields"]["sprite"] == "--self"
            && block["fields"]["appearance"] == "scale"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "effect_of_sprite"
            && block["fields"]["sprite"] == "--self"
            && block["fields"]["effect"] == "2"
    }));
}

#[test]
fn cli_compile_ts_bcmkn_appearance_display_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("appearance.ts");
    let output = dir.path().join("appearance.bcmkn");
    fs::write(
        &input,
        r##"
onStart(() => {
  show();
  say("hello", 2);
  think("hmm");
  setScale(120);
  changeScale(-10);
  setEffect("2", 80);
  clearEffects();
  setText("Score");
  setTextColor("#ff0000");
  nextStyle();
  setScreenTransition("left", "slide");
  setVar("scale", appearanceOf("--self", "scale"));
});
"##,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_pen_and_stamp_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("pen.ts");
    let output = dir.path().join("pen-workspace.json");
    fs::write(
        &input,
        r##"
onStart(() => {
  clearDrawing();
  penDown();
  setPenColor("#00ff88");
  setPenSize(6);
  changePenSize(-2);
  setPenEffect("hue", 50);
  changePenEffect("alpha", -10);
  stampText("hello", 20, "center");
  imageStamp();
  setPenLayer("peak", "bottom");
  penUp();
});
"##,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"clear_drawing"));
    assert!(block_types.contains(&"self_pen_down"));
    assert!(block_types.contains(&"self_pen_up"));
    assert!(block_types.contains(&"self_set_pen_color"));
    assert!(block_types.contains(&"self_set_pen_size"));
    assert!(block_types.contains(&"self_change_pen_size"));
    assert!(block_types.contains(&"self_set_pen_color_property"));
    assert!(block_types.contains(&"self_change_pen_color_property"));
    assert!(block_types.contains(&"stamp"));
    assert!(block_types.contains(&"image_stamp"));
    assert!(block_types.contains(&"set_pen_layer"));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_set_pen_color" && block["fields"]["color"] == "#00ff88"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_change_pen_size" && block["fields"]["increase"] == "decrease"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "self_change_pen_color_property"
            && block["fields"]["scope"] == "alpha"
            && block["fields"]["increase"] == "decrease"
    }));
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "stamp" && block["fields"]["align"] == "center" })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "set_pen_layer"
            && block["fields"]["layer"] == "peak"
            && block["fields"]["target_layer"] == "bottom"
    }));
}

#[test]
fn cli_compile_ts_bcmkn_pen_and_stamp_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("pen.ts");
    let output = dir.path().join("pen.bcmkn");
    fs::write(
        &input,
        r##"
onStart(() => {
  clearDrawing();
  penDown();
  setPenColor("#00ff88");
  setPenSize(6);
  changePenSize(-2);
  setPenEffect("hue", 50);
  changePenEffect("alpha", -10);
  stampText("hello", 20, "center");
  imageStamp();
  setPenLayer("peak", "bottom");
  penUp();
});
"##,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_sensing_input_time_statement_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("sensing.ts");
    let output = dir.path().join("sensing-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  askChoice("1+1=?", "1", "2");
  clone("--self");
  deleteClone();
  timerStart();
  timerStop();
  timerReset();
  faceToBodyPart("face");
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"ask_and_choose"));
    assert!(block_types.contains(&"mirror"));
    assert!(block_types.contains(&"dispose_clone"));
    assert!(block_types.contains(&"set_timer_state"));
    assert!(block_types.contains(&"face_to_body_part"));
    assert!(blocks.values().any(|block| {
        block["type"] == "ask_and_choose"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="2"></mutation>"#
    }));
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "mirror" && block["fields"]["sprite"] == "--self" })
    );
    assert!(
        blocks.values().any(|block| {
            block["type"] == "set_timer_state" && block["fields"]["type"] == "reset"
        })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "face_to_body_part" && block["fields"]["body_part"] == "face"
    }));
}

#[test]
fn cli_compile_ts_supports_sensing_input_time_expression_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("sensing_expr.ts");
    let output = dir.path().join("sensing-expr-workspace.json");
    fs::write(
        &input,
        r##"
onStart(() => {
  setVar("key", keyPressed("65", "down"));
  setVar("mouse", mouseTrigger("down"));
  setVar("mouseX", mouseX());
  setVar("mouseY", mouseY());
  setVar("answer", answer());
  setVar("choiceText", choiceValue("content"));
  setVar("choiceIndex", choiceValue("index"));
  setVar("timer", timerValue());
  setVar("year", timeNow("year"));
  setVar("stageWidth", stageInfo("width"));
  setVar("touching", touching("--self", "--edge"));
  setVar("touchingColor", touchingColor("--self", "#ff0000"));
  setVar("outside", outOfBoundary("0"));
  setVar("cloneCount", cloneCount("--self"));
  setVar("cloneIndex", currentCloneIndex());
  setVar("cloneX", cloneProperty("--self", 1, "x"));
  setVar("bodyTouch", touchingBodyPart("--self", "face"));
  setVar("bodySize", bodyPartAppearance("face", "scale"));
  setVar("faceTilt", faceTiltAngle());
});
"##,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"check_key"));
    assert!(block_types.contains(&"mouse_down"));
    assert!(block_types.contains(&"get_mouse_info"));
    assert!(block_types.contains(&"get_answer"));
    assert!(block_types.contains(&"get_choice_and_index"));
    assert!(block_types.contains(&"timer"));
    assert!(block_types.contains(&"get_time"));
    assert!(block_types.contains(&"get_stage_info"));
    assert!(block_types.contains(&"bump_into"));
    assert!(block_types.contains(&"bump_into_color"));
    assert!(block_types.contains(&"out_of_boundary"));
    assert!(block_types.contains(&"get_clone_num"));
    assert!(block_types.contains(&"get_current_clone_index"));
    assert!(block_types.contains(&"get_clone_index_property"));
    assert!(block_types.contains(&"bump_into_body_part"));
    assert!(block_types.contains(&"get_appearance_of_part"));
    assert!(block_types.contains(&"get_tilt_angle_of_face"));
    assert!(blocks.values().any(|block| {
        block["type"] == "check_key"
            && block["fields"]["key"] == "65"
            && block["fields"]["type"] == "down"
    }));
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "get_mouse_info" && block["fields"]["type"] == "x" })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "get_clone_index_property"
            && block["fields"]["sprite"] == "--self"
            && block["fields"]["attribute"] == "x"
    }));
}

#[test]
fn cli_compile_ts_bcmkn_sensing_input_time_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("sensing.ts");
    let output = dir.path().join("sensing.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  askChoice("1+1=?", "1", "2");
  timerReset();
  setVar("key", keyPressed("65", "down"));
  setVar("mouseX", mouseX());
  setVar("answer", answer());
  setVar("timer", timerValue());
  setVar("year", timeNow("year"));
  setVar("touching", touching("--self", "--edge"));
  setVar("cloneCount", cloneCount("--self"));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_variable_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("variables.ts");
    let output = dir.path().join("variables-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  scriptVars("localScore", "localName");
  setVar("score", 1);
  changeVar("score", -2);
  setVar("copy", getVar("score"));
  setVar("localCopy", scriptVar("localScore"));
  showVariable("score");
  hideVariable("score");
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"script_variables"));
    assert!(block_types.contains(&"script_variables_param"));
    assert!(block_types.contains(&"script_variables_value"));
    assert!(block_types.contains(&"variables_set"));
    assert!(block_types.contains(&"change_variables"));
    assert!(block_types.contains(&"variables_get"));
    assert!(block_types.contains(&"show_hide_variables"));
    assert!(blocks.values().any(|block| {
        block["type"] == "script_variables"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="2"></mutation>"#
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "script_variables_param" && block["fields"]["TEXT"] == "localScore"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "script_variables_value" && block["fields"]["TEXT"] == "localScore"
    }));
    let change_block = blocks
        .values()
        .find(|block| block["type"] == "change_variables")
        .expect("missing change_variables block");
    assert_eq!(change_block["fields"]["method"], "decrease");
    assert!(blocks.values().any(|block| {
        block["parent_id"] == change_block["id"]
            && block["type"] == "math_number"
            && block["fields"]["NUM"] == "2"
    }));
}

#[test]
fn cli_compile_ts_bcmkn_variable_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("variables.ts");
    let output = dir.path().join("variables.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  scriptVars("localScore");
  setVar("score", 1);
  changeVar("score", -2);
  setVar("copy", getVar("score"));
  setVar("localCopy", scriptVar("localScore"));
  showVariable("score");
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_supports_list_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("lists.ts");
    let output = dir.path().join("lists-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  appendList("items", 1);
  insertList("items", 1, "hello");
  replaceListItem("items", "any", 1, 2);
  deleteListItem("items", "last", 1);
  copyList("items", "backup");
  showList("items");
  hideList("items");
  setVar("all", getList("items"));
  setVar("first", listItem("items", "any", 1));
  setVar("length", listLength("items"));
  setVar("index", listIndexOf("items", "hello"));
  setVar("has", listContains("items", "hello"));
  setVar("tmp", tempList(1, 2, 3));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"list_append"));
    assert!(block_types.contains(&"list_insert_value"));
    assert!(block_types.contains(&"replace_list_item"));
    assert!(block_types.contains(&"delete_list_item"));
    assert!(block_types.contains(&"list_copy"));
    assert!(block_types.contains(&"show_hide_list"));
    assert!(block_types.contains(&"list_get"));
    assert!(block_types.contains(&"list_item"));
    assert!(block_types.contains(&"list_length"));
    assert!(block_types.contains(&"list_index_of"));
    assert!(block_types.contains(&"list_is_exist"));
    assert!(block_types.contains(&"temporary_list"));
    assert!(block_types.contains(&"pure_list_get"));
    assert!(
        blocks.values().any(|block| {
            block["type"] == "replace_list_item" && block["fields"]["item"] == "any"
        })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "show_hide_list"
            && block["fields"]["show_hide"] == "show"
            && block["fields"]["list"] == "items"
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "temporary_list"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="3"></mutation>"#
    }));
}

#[test]
fn cli_compile_ts_bcmkn_list_sample_validates_and_registers_lists() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("lists.ts");
    let output = dir.path().join("lists.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  appendList("items", 1);
  insertList("items", 1, "hello");
  replaceListItem("items", "any", 1, 2);
  deleteListItem("items", "last", 1);
  copyList("items", "backup");
  showList("items");
  setVar("first", listItem("items", "any", 1));
  setVar("length", listLength("items"));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let variables = project["variables"]["variablesDict"].as_object().unwrap();
    assert!(
        variables
            .values()
            .any(|variable| { variable["type"] == "list" && variable["name"] == "items" })
    );
    assert!(
        variables
            .values()
            .any(|variable| { variable["type"] == "list" && variable["name"] == "backup" })
    );
    let decompiled = nekoc::decompile::build_report(&project).unwrap();
    let blocks = decompiled["owners"][0]["scripts"][0]["blocks"]
        .as_array()
        .unwrap();
    assert!(blocks.iter().any(|block| {
        block["type"] == "pure_list_get"
            && block["fields"]["list"]
                .as_str()
                .is_some_and(|value| value.starts_with("kn-list-"))
    }));
}

#[test]
fn cli_compile_ts_supports_extended_math_logic_and_value_blocks() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("math_value.ts");
    let output = dir.path().join("math-value-workspace.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("bool", bool(true));
  setVar("pow", pow(2, 8));
  setVar("random", randInt(1, 10));
  setVar("divisible", divisibleBy(10, 2));
  setVar("even", numberProperty(4, "EVEN"));
  setVar("sqrt", mathFunc("0", 16));
  setVar("sin", trig("sin", 90));
  setVar("num", toNumber("42"));
  setVar("truth", toBoolean("true"));
  setVar("joined", join("a", "b", "c"));
  setVar("slice", selectText("abcdef", 2, 4));
  setVar("tail", selectText("abcdef", 2));
  setVar("split", splitText("a,b,c", ","));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let block_types = blocks
        .values()
        .map(|block| block["type"].as_str().unwrap())
        .collect::<Vec<_>>();

    assert!(block_types.contains(&"logic_boolean"));
    assert!(block_types.contains(&"random_num"));
    assert!(block_types.contains(&"divisible_by"));
    assert!(block_types.contains(&"math_number_property"));
    assert!(block_types.contains(&"math_function"));
    assert!(block_types.contains(&"math_trig"));
    assert!(block_types.contains(&"text_select"));
    assert!(block_types.contains(&"text_split"));
    assert!(
        blocks.values().any(|block| {
            block["type"] == "math_arithmetic" && block["fields"]["type"] == "power"
        })
    );
    assert!(
        blocks.values().any(|block| {
            block["type"] == "convert_type" && block["fields"]["type"] == "number"
        })
    );
    assert!(
        blocks.values().any(|block| {
            block["type"] == "convert_type" && block["fields"]["type"] == "boolean"
        })
    );
    assert!(blocks.values().any(|block| {
        block["type"] == "text_join"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="3"></mutation>"#
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "text_select"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="1"></mutation>"#
    }));
    assert!(blocks.values().any(|block| {
        block["type"] == "text_select"
            && block["mutation"]
                == r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="0"></mutation>"#
    }));
}

#[test]
fn cli_compile_ts_bcmkn_math_value_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("math_value.ts");
    let output = dir.path().join("math_value.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  setVar("bool", bool(true));
  setVar("pow", pow(2, 8));
  setVar("random", randInt(1, 10));
  setVar("divisible", divisibleBy(10, 2));
  setVar("even", numberProperty(4, "EVEN"));
  setVar("sqrt", mathFunc("0", 16));
  setVar("sin", trig("sin", 90));
  setVar("joined", join("a", "b", "c"));
  setVar("slice", selectText("abcdef", 2, 4));
  setVar("split", splitText("a,b,c", ","));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_inlines_plain_ts_functions() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("inline_functions.ts");
    let output = dir.path().join("inline_functions.json");
    fs::write(
        &input,
        r#"
function greet(name) {
  consoleLog(join("hi ", name));
}

function double(x) {
  return mul(x, 2);
}

onStart(() => {
  greet("Kitten");
  setVar("doubled", double(21));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(report["summary"]["procedures"], 0);
    assert!(report["procedures"].as_array().unwrap().is_empty());

    let main_blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    assert!(main_blocks.values().all(|block| {
        !block["type"]
            .as_str()
            .unwrap_or("")
            .starts_with("procedures_2_")
    }));
    assert!(
        main_blocks
            .values()
            .any(|block| block["type"] == "console_log")
    );
    let set_var = main_blocks
        .values()
        .find(|block| block["type"] == "variables_set")
        .unwrap();
    let (value_block_id, value_connection) = report["workspaceData"]["connections"]
        [set_var["id"].as_str().unwrap()]
    .as_object()
    .unwrap()
    .iter()
    .find(|(_, connection)| connection["input_name"] == "value")
    .unwrap();
    assert_eq!(value_connection["input_type"], "value");
    let value_block = &main_blocks[value_block_id];
    assert_eq!(value_block["type"], "math_arithmetic");
    assert_eq!(value_block["fields"]["type"], "multiply");
}

#[test]
fn cli_compile_ts_inlines_arrow_function_constants() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("inline_arrow_functions.ts");
    let output = dir.path().join("inline_arrow_functions.json");
    fs::write(
        &input,
        r#"
const greet = (name) => {
  consoleLog(join("hi ", name));
};

const double = (x) => mul(x, 2);

onStart(() => {
  greet("Kitten");
  setVar("doubled", double(add(20, 1)));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(report["summary"]["procedures"], 0);
    assert!(report["procedures"].as_array().unwrap().is_empty());

    let main_blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    assert!(main_blocks.values().all(|block| {
        !block["type"]
            .as_str()
            .unwrap_or("")
            .starts_with("procedures_2_")
    }));
    let arithmetic_count = main_blocks
        .values()
        .filter(|block| block["type"] == "math_arithmetic")
        .count();
    assert_eq!(arithmetic_count, 2);
}

#[test]
fn cli_compile_ts_inlines_imported_functions_from_relative_modules() {
    let dir = tempdir().unwrap();
    let src_dir = dir.path().join("src");
    let lib_dir = src_dir.join("lib");
    fs::create_dir_all(&lib_dir).unwrap();
    let input = src_dir.join("main.ts");
    let output = dir.path().join("multi_file.json");
    fs::write(
        lib_dir.join("math.ts"),
        r#"
export const double = (x) => mul(x, 2);

export function greet(name) {
  consoleLog(join("hi ", name));
}
"#,
    )
    .unwrap();
    fs::write(
        &input,
        r#"
import { double, greet } from "./lib/math";

onStart(() => {
  greet("Kitten");
  setVar("doubled", double(21));
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert_eq!(report["summary"]["scripts"], 1);
    assert_eq!(report["summary"]["procedures"], 0);
    assert!(report["procedures"].as_array().unwrap().is_empty());
    let main_blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    assert!(
        main_blocks
            .values()
            .any(|block| block["type"] == "console_log")
    );
    assert!(
        main_blocks
            .values()
            .any(|block| block["type"] == "math_arithmetic")
    );
    assert!(main_blocks.values().all(|block| {
        !block["type"]
            .as_str()
            .unwrap_or("")
            .starts_with("procedures_2_")
    }));
}

#[test]
fn cli_compile_ts_inlines_expression_functions_with_local_bindings() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("inline_function_locals.ts");
    let output = dir.path().join("inline_function_locals.json");
    fs::write(
        &input,
        r#"
function scoreBonus(score) {
  const doubled = score * 2;
  let shifted = doubled + 1;
  return shifted;
}

onStart(() => {
  let result = scoreBonus(10);
  console.log(result);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();

    assert_eq!(report["summary"]["procedures"], 0);
    assert!(blocks.values().any(|block| {
        block["type"] == "math_arithmetic" && block["fields"]["type"] == "multiply"
    }));
    assert!(
        blocks.values().any(|block| {
            block["type"] == "math_arithmetic" && block["fields"]["type"] == "add"
        })
    );
    assert!(
        !blocks
            .values()
            .any(|block| block["fields"]["variable"] == "doubled")
    );
    assert!(
        !blocks
            .values()
            .any(|block| block["fields"]["variable"] == "shifted")
    );
}

#[test]
fn cli_compile_ts_bcmkn_inline_function_locals_validate() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("inline_function_locals.ts");
    let output = dir.path().join("inline_function_locals.bcmkn");
    fs::write(
        &input,
        r#"
function scoreBonus(score) {
  const doubled = score * 2;
  let shifted = doubled + 1;
  return shifted;
}

onStart(() => {
  let result = scoreBonus(10);
  console.log(result);
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_compiles_basic_variable_syntax() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("natural_ts.ts");
    let output = dir.path().join("natural_ts.json");
    fs::write(
        &input,
        r#"
let score = 0;

onStart(() => {
  score = score + 1;
  console.log(score);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let main_blocks = report["workspaceData"]["blocks"].as_object().unwrap();

    assert!(main_blocks
        .values()
        .any(|block| block["type"] == "variables_set" && block["fields"]["variable"] == "score"));
    assert!(main_blocks
        .values()
        .any(|block| block["type"] == "variables_get" && block["fields"]["variable"] == "score"));
    assert!(
        main_blocks.values().any(|block| {
            block["type"] == "math_arithmetic" && block["fields"]["type"] == "add"
        })
    );
    assert!(
        main_blocks
            .values()
            .any(|block| block["type"] == "console_log")
    );
}

#[test]
fn cli_compile_ts_supports_sprite_self_api() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("self_api.ts");
    let output = dir.path().join("self_api.json");
    fs::write(
        &input,
        r#"
sprite("player", { costume: "https://example.com/player.png" }, self => {
  self.onStart(() => {
    self.x = 100;
    self.y = 50;
    self.scale = 120;
    self.move(10);
    self.turn(15);
    self.pointTowards(90);
    self.show();
    self.hide();
    self.say("hello", 2);
    self.think("hmm");
    self.ask("name?");
    self.wait(0.2);
    self.broadcast("ready");
    self.broadcast("score:update", 1);
    self.broadcastAndWait("clicked");
    self.repeat(3, () => {
      self.move(1);
    });
    self.forever(() => {
      self.wait(0.03);
    });
    self.setVar("score", 1);
    self.changeVar("score", 2);
    self.showVariable("score");
    self.hideVariable("score");
    self.setVar("copy", self.getVar("score"));
    self.var("combo").set(self.var("score").get());
    self.var("combo").change(3);
    self.list("items").add(1);
    self.list("items").insert(1, "hello");
    self.list("items").replace("any", 1, 2);
    self.list("items").delete("last", 1);
    self.list("items").copyTo("backup");
    self.list("items").show();
    self.list("items").hide();
    self.setVar("allItems", self.list("items").get());
    self.setVar("firstItem", self.list("items").item("any", 1));
    self.setVar("itemCount", self.list("items").length());
    self.setVar("itemIndex", self.list("items").indexOf("hello"));
    self.setVar("hasItem", self.list("items").contains("hello"));
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let sprite = &report["resources"]["sprites"][0];
    let blocks = sprite["workspaceData"]["blocks"].as_object().unwrap();

    assert_eq!(sprite["name"], "player");
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "on_running_group_activated")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "self_set_position_x")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "self_set_position_y")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "self_go_forward")
    );
    assert!(blocks.values().any(|block| block["type"] == "self_rotate"));
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "self_point_towards")
    );
    assert!(blocks.values().any(|block| block["type"] == "self_appear"));
    assert!(blocks.values().any(|block| block["type"] == "self_dialog"));
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "self_dialog_wait")
    );
    assert!(blocks.values().any(|block| block["type"] == "self_ask"));
    assert!(blocks.values().any(|block| block["type"] == "set_scale"));
    assert!(blocks.values().any(|block| block["type"] == "wait"));
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "self_broadcast")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "self_broadcast_with_param")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "self_broadcast_and_wait")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "repeat_n_times")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "repeat_forever")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "variables_set")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "change_variables")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "variables_get")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "show_hide_variables")
    );
    assert!(blocks.values().any(|block| block["type"] == "list_append"));
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "list_insert_value")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "replace_list_item")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "delete_list_item")
    );
    assert!(blocks.values().any(|block| block["type"] == "list_copy"));
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "show_hide_list")
    );
    assert!(blocks.values().any(|block| block["type"] == "list_get"));
    assert!(blocks.values().any(|block| block["type"] == "list_item"));
    assert!(blocks.values().any(|block| block["type"] == "list_length"));
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "list_index_of")
    );
    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "list_is_exist")
    );
}

#[test]
fn ts_definitions_cover_sprite_self_api() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("typed_self_api.ts");
    fs::write(
        &input,
        r#"
sprite("player", { costume: "https://example.com/player.png" }, self => {
  self.onStart(() => {
    self.x = 100;
    self.y = 50;
    self.scale = 120;
    self.move(10);
    self.turn(15);
    self.pointTowards(90);
    self.show();
    self.hide();
    self.say("hello", 2);
    self.think("hmm");
    self.ask("name?");
    self.wait(0.2);
    self.broadcast("ready");
    self.broadcast("score:update", 1);
    self.broadcastAndWait("clicked");
    self.repeat(3, () => self.move(1));
    self.forever(() => self.wait(0.03));
    self.setVar("score", 1);
    self.changeVar("score", 2);
    self.showVariable("score");
    self.hideVariable("score");
    self.setVar("copy", self.getVar("score"));
    self.var("combo").set(self.var("score").get());
    self.var("combo").change(3);
    self.list("items").add(1);
    self.list("items").insert(1, "hello");
    self.list("items").replace("any", 1, 2);
    self.list("items").delete("last", 1);
    self.list("items").copyTo("backup");
    self.list("items").show();
    self.list("items").hide();
    self.setVar("allItems", self.list("items").get());
    self.setVar("firstItem", self.list("items").item("any", 1));
    self.setVar("itemCount", self.list("items").length());
    self.setVar("itemIndex", self.list("items").indexOf("hello"));
    self.setVar("hasItem", self.list("items").contains("hello"));
  });
});
"#,
    )
    .unwrap();

    Command::new(npx_command())
        .args([
            "tsc",
            "--noEmit",
            "--strict",
            "--lib",
            "es2020",
            "ts/nekoc.d.ts",
            input.to_str().unwrap(),
        ])
        .assert()
        .success();
}

#[test]
fn cli_test_runs_passing_ts_unit_tests() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("unit_test.ts");
    fs::write(
        &input,
        r#"
function double(x: number) {
  return x * 2;
}

test("double", () => {
  expect(double(21)).toBe(42);
  expect([1, 2, 3]).toContain(2);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["test", input.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("1 passed"));
}

#[test]
fn cli_test_reports_failing_ts_unit_tests() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("unit_test.ts");
    fs::write(
        &input,
        r#"
function double(x: number) {
  return x * 2;
}

test("double", () => {
  expect(double(20)).toBe(42);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["test", input.to_str().unwrap()])
        .assert()
        .failure()
        .stderr(predicate::str::contains("Expected 40 to be 42"));
}

#[test]
fn cli_test_supports_relative_imports() {
    let dir = tempdir().unwrap();
    let lib = dir.path().join("math.ts");
    let input = dir.path().join("unit_test.ts");
    fs::write(
        &lib,
        r#"
export function double(x: number) {
  return x * 2;
}
"#,
    )
    .unwrap();
    fs::write(
        &input,
        r#"
import { double } from "./math";

test("imported double", () => {
  expect(double(21)).toBe(42);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["test", input.to_str().unwrap()])
        .assert()
        .success()
        .stdout(predicate::str::contains("1 passed"));
}

#[test]
fn cli_compile_ts_ignores_top_level_unit_tests() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("compile_with_tests.ts");
    let output = dir.path().join("compile_with_tests.json");
    fs::write(
        &input,
        r#"
function double(x: number) {
  return x * 2;
}

test("double", () => {
  expect(double(21)).toBe(42);
});

onStart(() => {
  consoleLog("ready");
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    assert!(blocks.values().any(|block| block["type"] == "console_log"));
}

#[test]
fn cli_compile_ts_bcmkn_basic_variable_syntax_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("natural_ts.ts");
    let output = dir.path().join("natural_ts.bcmkn");
    fs::write(
        &input,
        r#"
let score = 0;

onStart(() => {
  score = score + 1;
  console.log(score);
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let variables = project["variables"]["variablesDict"].as_object().unwrap();
    assert!(
        variables
            .values()
            .any(|variable| variable["name"] == "score")
    );
}

#[test]
fn cli_compile_ts_compiles_native_if_else() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_if.ts");
    let output = dir.path().join("native_if.json");
    fs::write(
        &input,
        r#"
let score = 0;

onStart(() => {
  if (score > 10) {
    console.log("win");
  } else {
    console.log("keep going");
  }
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let connections = report["workspaceData"]["connections"].as_object().unwrap();
    let if_block = blocks
        .values()
        .find(|block| block["type"] == "controls_if")
        .unwrap();
    let if_id = if_block["id"].as_str().unwrap();

    assert_eq!(
        if_block["mutation"],
        r#"<mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>"#
    );
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "logic_compare" && block["fields"]["OP"] == "GT" })
    );
    assert_eq!(
        connections[if_id]
            .as_object()
            .unwrap()
            .values()
            .filter(|connection| connection["input_name"] == "DO0"
                || connection["input_name"] == "ELSE")
            .count(),
        2
    );
}

#[test]
fn cli_compile_ts_bcmkn_native_if_else_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_if.ts");
    let output = dir.path().join("native_if.bcmkn");
    fs::write(
        &input,
        r#"
let score = 0;

onStart(() => {
  if (score > 10) {
    console.log("win");
  } else {
    console.log("keep going");
  }
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_compiles_native_while() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_while.ts");
    let output = dir.path().join("native_while.json");
    fs::write(
        &input,
        r#"
let count = 0;

onStart(() => {
  while (count < 3) {
    console.log(count);
    count = count + 1;
  }
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let connections = report["workspaceData"]["connections"].as_object().unwrap();
    let while_block = blocks
        .values()
        .find(|block| block["type"] == "repeat_forever_until")
        .unwrap();
    let while_id = while_block["id"].as_str().unwrap();
    let while_connections = connections[while_id].as_object().unwrap();

    assert!(blocks.values().any(|block| block["type"] == "logic_negate"));
    assert!(
        blocks
            .values()
            .any(|block| { block["type"] == "logic_compare" && block["fields"]["OP"] == "LT" })
    );
    assert!(
        while_connections
            .values()
            .any(|connection| connection["input_name"] == "condition")
    );
    assert!(
        while_connections
            .values()
            .any(|connection| connection["input_name"] == "DO")
    );
    assert!(blocks
        .values()
        .any(|block| block["type"] == "variables_set" && block["fields"]["variable"] == "count"));
}

#[test]
fn cli_compile_ts_bcmkn_native_while_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_while.ts");
    let output = dir.path().join("native_while.bcmkn");
    fs::write(
        &input,
        r#"
let count = 0;

onStart(() => {
  while (count < 3) {
    console.log(count);
    count = count + 1;
  }
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_compiles_native_break() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_break.ts");
    let output = dir.path().join("native_break.json");
    fs::write(
        &input,
        r#"
let count = 0;

onStart(() => {
  while (true) {
    count = count + 1;
    if (count > 3) {
      break;
    }
    console.log(count);
  }
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();

    assert!(blocks.values().any(|block| block["type"] == "break"));
    assert!(blocks.values().any(|block| {
        block["type"] == "controls_if" && block["parent_id"].as_str().unwrap_or("").starts_with('b')
    }));
}

#[test]
fn cli_compile_ts_rejects_native_break_outside_loop() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_break_outside_loop.ts");
    let output = dir.path().join("native_break_outside_loop.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  break;
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "break can only be used inside loops",
        ));
}

#[test]
fn cli_compile_ts_bcmkn_native_break_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_break.ts");
    let output = dir.path().join("native_break.bcmkn");
    fs::write(
        &input,
        r#"
let count = 0;

onStart(() => {
  while (true) {
    count = count + 1;
    if (count > 3) {
      break;
    }
    console.log(count);
  }
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_compiles_native_for_loop() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_for.ts");
    let output = dir.path().join("native_for.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  for (let i = 0; i < 3; i = i + 1) {
    console.log(i);
  }
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let for_block = blocks
        .values()
        .find(|block| block["type"] == "traverse_number")
        .unwrap();

    assert_eq!(
        for_block["mutation"],
        r#"<mutation xmlns="http://www.w3.org/1999/xhtml" items="2"></mutation>"#
    );
    assert!(blocks
        .values()
        .any(|block| block["type"] == "traverse_number_param" && block["fields"]["TEXT"] == "i"));
    assert!(blocks
        .values()
        .any(|block| block["type"] == "traverse_number_value" && block["fields"]["TEXT"] == "i"));
    assert!(blocks.values().any(|block| block["type"] == "console_log"));
}

#[test]
fn cli_compile_ts_bcmkn_native_for_loop_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_for.ts");
    let output = dir.path().join("native_for.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  for (let i = 0; i < 3; i = i + 1) {
    console.log(i);
  }
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_compiles_block_let_variables() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("block_let.ts");
    let output = dir.path().join("block_let.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  let total = 0;
  for (let i = 0; i < 3; i = i + 1) {
    total = total + i;
  }
  console.log(total);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();

    assert!(blocks
        .values()
        .any(|block| block["type"] == "variables_set" && block["fields"]["variable"] == "total"));
    assert!(blocks
        .values()
        .any(|block| block["type"] == "variables_get" && block["fields"]["variable"] == "total"));
    assert!(blocks
        .values()
        .any(|block| block["type"] == "traverse_number_value" && block["fields"]["TEXT"] == "i"));
    assert!(
        blocks.values().any(|block| {
            block["type"] == "math_arithmetic" && block["fields"]["type"] == "add"
        })
    );
}

#[test]
fn cli_compile_ts_rejects_block_let_shadowing() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("block_let_shadow.ts");
    let output = dir.path().join("block_let_shadow.json");
    fs::write(
        &input,
        r#"
let total = 0;

onStart(() => {
  let total = 1;
  console.log(total);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "Variable shadowing is not supported",
        ));
}

#[test]
fn cli_compile_ts_bcmkn_block_let_variables_validate() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("block_let.ts");
    let output = dir.path().join("block_let.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  let total = 0;
  for (let i = 0; i < 3; i = i + 1) {
    total = total + i;
  }
  console.log(total);
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let variables = project["variables"]["variablesDict"].as_object().unwrap();
    assert!(
        variables
            .values()
            .any(|variable| variable["name"] == "total")
    );
}

#[test]
fn cli_compile_ts_compiles_compound_assignments_and_updates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("assignment_sugar.ts");
    let output = dir.path().join("assignment_sugar.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  let total = 0;
  total += 2;
  total++;
  total--;
  console.log(total);
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();
    let arithmetic_count = blocks
        .values()
        .filter(|block| block["type"] == "math_arithmetic")
        .count();
    let set_count = blocks
        .values()
        .filter(|block| block["type"] == "variables_set" && block["fields"]["variable"] == "total")
        .count();

    assert_eq!(set_count, 4);
    assert!(arithmetic_count >= 3);
    assert!(
        blocks.values().any(|block| {
            block["type"] == "math_arithmetic" && block["fields"]["type"] == "minus"
        })
    );
}

#[test]
fn cli_compile_ts_compiles_native_for_update_expression() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("native_for_update.ts");
    let output = dir.path().join("native_for_update.json");
    fs::write(
        &input,
        r#"
onStart(() => {
  for (let i = 0; i < 3; i++) {
    console.log(i);
  }
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let blocks = report["workspaceData"]["blocks"].as_object().unwrap();

    assert!(
        blocks
            .values()
            .any(|block| block["type"] == "traverse_number" && block["parent_id"].is_string())
    );
    assert!(blocks
        .values()
        .any(|block| block["type"] == "traverse_number_value" && block["fields"]["TEXT"] == "i"));
}

#[test]
fn cli_compile_ts_bcmkn_assignment_sugar_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("assignment_sugar.ts");
    let output = dir.path().join("assignment_sugar.bcmkn");
    fs::write(
        &input,
        r#"
onStart(() => {
  let total = 0;
  total += 2;
  total++;
  total--;
  console.log(total);
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();
}

#[test]
fn cli_compile_ts_bcmkn_inline_function_sample_validates() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("inline_functions.ts");
    let output = dir.path().join("inline_functions.bcmkn");
    fs::write(
        &input,
        r#"
function greet(name) {
  consoleLog(join("hi ", name));
}

function double(x) {
  return mul(x, 2);
}

onStart(() => {
  greet("Kitten");
  setVar("doubled", double(21));
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let procedures = project["procedures"]["proceduresDict"].as_object().unwrap();
    assert!(procedures.is_empty());
}

#[test]
fn cli_compile_ts_bcmkn_multi_file_project_sample_validates() {
    let dir = tempdir().unwrap();
    let output = dir.path().join("project.bcmkn");
    let samples_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("samples");
    let input = samples_dir.join("project").join("main.ts");
    let template = samples_dir.join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    assert!(
        project["procedures"]["proceduresDict"]
            .as_object()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn cli_compile_ts_reports_stage_and_sprite_resources() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("resources.ts");
    let output = dir.path().join("resources.json");
    fs::write(
        &input,
        r#"
stage({
  name: "main",
  backdrop: "https://example.com/bg.png",
});

sprite("player", {
  costume: "https://example.com/player.png",
  x: 12,
  y: -34,
  scale: 80,
  visible: false,
  centerX: 60,
  centerY: 60,
}, () => {
  onStart(() => {
    console.log("ready");
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let sprite = &report["resources"]["sprites"][0];
    let sprite_blocks = sprite["workspaceData"]["blocks"].as_object().unwrap();

    assert_eq!(report["resources"]["stage"]["name"], "main");
    assert_eq!(
        report["resources"]["stage"]["backdrop"],
        "https://example.com/bg.png"
    );
    assert_eq!(sprite["name"], "player");
    assert_eq!(sprite["costume"], "https://example.com/player.png");
    assert_eq!(sprite["x"], 12);
    assert_eq!(sprite["y"], -34);
    assert_eq!(sprite["scale"], 80);
    assert_eq!(sprite["visible"], false);
    assert_eq!(sprite["centerX"], 60);
    assert_eq!(sprite["centerY"], 60);
    assert!(
        sprite_blocks
            .values()
            .any(|block| block["type"] == "on_running_group_activated")
    );
    assert!(
        sprite_blocks
            .values()
            .any(|block| block["type"] == "console_log")
    );
}

#[test]
fn cli_compile_ts_reports_screen_resources() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("screens.ts");
    let output = dir.path().join("screens.json");
    fs::write(
        &input,
        r#"
screen("menu", {
  backdrop: "https://example.com/menu.png",
}, () => {
  sprite("start", {
    costume: "https://example.com/start.png",
  }, () => {
    onStart(() => {
      switchScreen("game");
    });
  });
});
"#,
    )
    .unwrap();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts",
            input.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let screen = &report["resources"]["screens"][0];
    let sprite = &screen["sprites"][0];

    assert_eq!(screen["id"], "nekoc-screen-menu");
    assert_eq!(screen["name"], "menu");
    assert_eq!(screen["backdrop"], "https://example.com/menu.png");
    assert_eq!(sprite["name"], "start");
    assert_eq!(sprite["costume"], "https://example.com/start.png");
    assert!(
        sprite["workspaceData"]["blocks"]
            .as_object()
            .unwrap()
            .values()
            .any(|block| block["type"] == "switch_to_screen")
    );
}

#[test]
fn cli_compile_ts_bcmkn_registers_stage_and_sprite_resources() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("resources.ts");
    let output = dir.path().join("resources.bcmkn");
    fs::write(
        &input,
        r#"
stage({
  name: "main",
  backdrop: "https://example.com/bg.png",
});

sprite("player", {
  costume: "https://example.com/player.png",
  x: 12,
  y: -34,
  scale: 80,
  visible: false,
  centerX: 60,
  centerY: 60,
}, () => {
  onStart(() => {
    console.log("ready");
  });
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let current_scene_id = project["scenes"]["currentSceneId"].as_str().unwrap();
    let current_scene = &project["scenes"]["scenesDict"][current_scene_id];
    let actors = project["actors"]["actorsDict"].as_object().unwrap();
    let styles = project["styles"]["stylesDict"].as_object().unwrap();
    let player = actors
        .values()
        .find(|actor| actor["name"] == "player")
        .unwrap();
    let player_id = player["id"].as_str().unwrap();

    assert_eq!(current_scene["name"], "main");
    assert_eq!(current_scene["screenName"], "main");
    assert_eq!(actors.len(), 1);
    assert!(
        current_scene["actorIds"]
            .as_array()
            .unwrap()
            .iter()
            .any(|id| id.as_str() == Some(player_id))
    );
    assert!(
        styles
            .values()
            .any(|style| style["url"] == "https://example.com/bg.png")
    );
    assert!(
        styles
            .values()
            .any(|style| style["url"] == "https://example.com/player.png")
    );
    assert_eq!(player["position"]["x"].as_f64().unwrap(), 12.0);
    assert_eq!(player["position"]["y"].as_f64().unwrap(), -34.0);
    assert_eq!(player["scale"].as_f64().unwrap(), 80.0);
    assert_eq!(player["visible"], false);
    let style_id = player["currentStyleId"].as_str().unwrap();
    assert_eq!(styles[style_id]["centerPoint"]["x"].as_f64().unwrap(), 60.0);
    assert_eq!(styles[style_id]["centerPoint"]["y"].as_f64().unwrap(), 60.0);
    assert!(
        player["nekoBlockJsonList"]
            .as_array()
            .unwrap()
            .iter()
            .any(|block| block["type"] == "on_running_group_activated")
    );
}

#[test]
fn cli_compile_ts_bcmkn_three_body_sample_validates() {
    let dir = tempdir().unwrap();
    let output = dir.path().join("three_body.bcmkn");
    let samples_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("samples");
    let input = samples_dir.join("three_body.ts");
    let template = samples_dir.join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let scene_id = project["scenes"]["currentSceneId"].as_str().unwrap();
    let scene = &project["scenes"]["scenesDict"][scene_id];
    let stage_style_id = scene["currentStyleId"].as_str().unwrap();
    let styles = project["styles"]["stylesDict"].as_object().unwrap();
    let stage_url = styles[stage_style_id]["url"].as_str().unwrap();
    let actors = project["actors"]["actorsDict"].as_object().unwrap();
    let variables = project["variables"]["variablesDict"].as_object().unwrap();
    assert!(!stage_url.starts_with("data:image"));
    assert!(
        styles
            .values()
            .all(|style| !style["url"].as_str().unwrap_or("").starts_with("data:"))
    );
    assert_eq!(actors.len(), 3);
    assert_eq!(variables.len(), 3);
    let mut block_ids = std::collections::BTreeSet::new();
    for name in ["body-a", "body-b", "body-c"] {
        let actor = actors
            .values()
            .find(|actor| actor["name"] == name)
            .unwrap_or_else(|| panic!("missing {name}"));
        assert_eq!(actor["nekoBlockJsonList"].as_array().unwrap().len(), 1);
        collect_nested_block_ids(actor["nekoBlockJsonList"].as_array().unwrap(), &mut |id| {
            assert!(block_ids.insert(id.to_owned()), "duplicate block id {id}");
        });
    }
}

fn collect_nested_block_ids<'a>(blocks: &'a [serde_json::Value], visit: &mut impl FnMut(&'a str)) {
    for block in blocks {
        collect_nested_block_id(block, visit);
    }
}

fn collect_nested_block_id<'a>(block: &'a serde_json::Value, visit: &mut impl FnMut(&'a str)) {
    if let Some(id) = block.get("id").and_then(serde_json::Value::as_str) {
        visit(id);
    }
    if let Some(next) = block.get("next") {
        collect_nested_block_id(next, visit);
    }
    for container_name in ["inputs", "statements"] {
        if let Some(container) = block
            .get(container_name)
            .and_then(serde_json::Value::as_object)
        {
            for child in container.values() {
                collect_nested_block_id(child, visit);
            }
        }
    }
}

#[test]
fn cli_compile_ts_bcmkn_registers_multiple_screens() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("screens.ts");
    let output = dir.path().join("screens.bcmkn");
    fs::write(
        &input,
        r#"
screen("menu", {
  backdrop: "https://example.com/menu.png",
}, () => {
  sprite("start", {
    costume: "https://example.com/start.png",
  }, () => {
    onStart(() => {
      switchScreen("game");
    });
  });
});

screen("game", {
  backdrop: "https://example.com/game.png",
}, () => {
  sprite("player", {
    costume: "https://example.com/player.png",
    x: 10,
  }, () => {
    onStart(() => {
      console.log("go");
    });
  });
});
"#,
    )
    .unwrap();
    let template = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("samples")
        .join("我的作品-原生.bcmkn");

    Command::cargo_bin("nekoc")
        .unwrap()
        .args([
            "compile-ts-bcmkn",
            input.to_str().unwrap(),
            "--template",
            template.to_str().unwrap(),
            "--out",
            output.to_str().unwrap(),
        ])
        .assert()
        .success();

    Command::cargo_bin("nekoc")
        .unwrap()
        .args(["validate", output.to_str().unwrap()])
        .assert()
        .success();

    let project: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(output).unwrap()).unwrap();
    let scenes = project["scenes"]["scenesDict"].as_object().unwrap();
    let sort_list = project["scenes"]["sortList"].as_array().unwrap();
    let actors = project["actors"]["actorsDict"].as_object().unwrap();
    let styles = project["styles"]["stylesDict"].as_object().unwrap();

    assert_eq!(scenes.len(), 2);
    assert_eq!(sort_list.len(), 2);
    assert_eq!(project["scenes"]["currentSceneId"], "nekoc-screen-menu");
    assert_eq!(scenes["nekoc-screen-menu"]["name"], "menu");
    assert_eq!(scenes["nekoc-screen-game"]["screenName"], "game");
    assert_eq!(
        styles[scenes["nekoc-screen-menu"]["currentStyleId"]
            .as_str()
            .unwrap()]["url"],
        "https://example.com/menu.png"
    );
    assert_eq!(
        styles[scenes["nekoc-screen-game"]["currentStyleId"]
            .as_str()
            .unwrap()]["url"],
        "https://example.com/game.png"
    );
    assert_eq!(
        scenes["nekoc-screen-menu"]["actorIds"],
        json!(["nekoc-actor-start"])
    );
    assert_eq!(
        scenes["nekoc-screen-game"]["actorIds"],
        json!(["nekoc-actor-player"])
    );
    assert_eq!(actors["nekoc-actor-start"]["name"], "start");
    assert_eq!(actors["nekoc-actor-player"]["position"]["x"], 10.0);

    let start_blocks = actors["nekoc-actor-start"]["nekoBlockJsonList"]
        .as_array()
        .unwrap();
    let start_script = &start_blocks[0];
    assert_eq!(
        start_script["next"]["inputs"]["screen_id"]["fields"]["screen_id"],
        "nekoc-screen-game"
    );
}
