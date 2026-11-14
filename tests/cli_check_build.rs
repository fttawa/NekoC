//! `nekoc check` / `nekoc build`: the AI-friendly check loop and the
//! template-free build of a single `.nk.ts` file that declares stage and logic.
use assert_cmd::Command;
use serde_json::{Value, json};
use std::fs;
use std::path::Path;

fn nekoc() -> Command {
    let mut command = Command::cargo_bin("nekoc").unwrap();
    command.current_dir(env!("CARGO_MANIFEST_DIR"));
    command
}

fn check_json(input: &Path, extra: &[&str]) -> (bool, Value) {
    let output = nekoc()
        .arg("check")
        .arg("--json")
        .args(extra)
        .arg(input)
        .output()
        .unwrap();
    let report: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "{error}: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    });
    (output.status.success(), report)
}

const STAGE: &str = r#"
const IDLE = "https://example.com/idle.png";

stage({ name: "demo" });

sprite("cat", {
  costumes: [
    { name: "idle", url: IDLE, centerX: 10, centerY: 20 },
    "https://example.com/walk.png",
  ],
  x: -50,
  y: 30,
  rotation: 45,
}, (self) => {
  self.onStart(() => {
    self.nextStyle();
    console.log("ready");
  });
});
"#;

#[test]
fn check_accepts_a_clean_stage_file_and_writes_nothing() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("demo.nk.ts");
    fs::write(&input, STAGE).unwrap();
    let (success, report) = check_json(&input, &[]);
    assert!(success, "{report}");
    assert_eq!(report, json!({ "ok": true, "diagnostics": [] }));
    let entries: Vec<_> = fs::read_dir(dir.path()).unwrap().collect();
    assert_eq!(entries.len(), 1, "check must not write output files");
}

#[test]
fn check_reports_type_and_compat_errors_with_locations() {
    let dir = tempfile::tempdir().unwrap();
    let typed = dir.path().join("typed.ts");
    fs::write(&typed, "onStart(() => {\n  say(1, 2, 3, 4);\n});\n").unwrap();
    let (success, report) = check_json(&typed, &[]);
    assert!(!success);
    let first = &report["diagnostics"][0];
    assert_eq!(first["source"], "types", "{report}");
    assert_eq!(first["severity"], "error");
    assert_eq!(first["line"], 2);
    assert!(first["code"].as_str().unwrap().starts_with("TS"));

    let unsupported = dir.path().join("unsupported.ts");
    fs::write(
        &unsupported,
        "class Foo {}\nonStart(() => { console.log(new Foo()); });\n",
    )
    .unwrap();
    let (success, report) = check_json(&unsupported, &["--no-types"]);
    assert!(!success);
    let diagnostics = report["diagnostics"].as_array().unwrap();
    assert!(
        diagnostics.iter().all(|d| d["source"] != "types"),
        "--no-types must skip the type checker: {report}"
    );
    assert!(
        diagnostics
            .iter()
            .any(|d| d["source"] == "compat" && d["line"].is_u64()),
        "{report}"
    );
}

#[test]
fn build_generates_actors_costumes_and_positions_without_a_template() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("demo.nk.ts");
    fs::write(&input, STAGE).unwrap();
    nekoc().arg("build").arg(&input).assert().success();
    // `.nk` is stripped from the project name and the default output path.
    let output = dir.path().join("demo.bcmkn");
    let project: Value = serde_json::from_str(&fs::read_to_string(&output).unwrap()).unwrap();
    assert_eq!(project["projectName"], "demo");

    let actor = project["actors"]["actorsDict"]
        .as_object()
        .unwrap()
        .values()
        .find(|actor| actor["name"] == "cat")
        .unwrap();
    assert_eq!(actor["position"], json!({ "x": -50.0, "y": 30.0 }));
    assert_eq!(actor["rotation"], 45.0);
    let styles: Vec<&Value> = actor["styles"]
        .as_array()
        .unwrap()
        .iter()
        .map(|id| &project["styles"]["stylesDict"][id.as_str().unwrap()])
        .collect();
    assert_eq!(styles.len(), 2);
    assert_eq!(styles[0]["name"], "idle");
    assert_eq!(styles[0]["url"], "https://example.com/idle.png");
    assert_eq!(styles[0]["centerPoint"], json!({ "x": 10.0, "y": 20.0 }));
    // Unnamed costumes continue the sprite's numbering.
    assert_eq!(styles[1]["name"], "cat2");
    assert_eq!(actor["currentStyleId"], actor["styles"][0]);

    let (success, report) = check_json(&output, &[]);
    assert!(success, "{report}");

    let run = nekoc()
        .args(["run", "--ticks", "5"])
        .arg(&output)
        .output()
        .unwrap();
    assert!(run.status.success());
    let run: Value = serde_json::from_slice(&run.stdout).unwrap();
    assert_eq!(run["logs"], json!(["ready"]));
}

#[test]
fn duplicate_costume_names_are_rejected() {
    let dir = tempfile::tempdir().unwrap();
    let input = dir.path().join("dup.ts");
    fs::write(
        &input,
        r#"sprite("cat", { costumes: [{ name: "a", url: "x.png" }, { name: "a", url: "y.png" }] }, (self) => {});"#,
    )
    .unwrap();
    let (success, report) = check_json(&input, &["--no-types"]);
    assert!(!success);
    assert!(
        report["diagnostics"][0]["message"]
            .as_str()
            .unwrap()
            .contains("a"),
        "{report}"
    );
}

#[test]
fn check_flags_procedure_parameters_the_official_runtime_cannot_resolve() {
    let dir = tempfile::tempdir().unwrap();
    let mut project: Value = serde_json::from_str(nekoc::bcmkn_compiler::DEFAULT_TEMPLATE).unwrap();
    project["procedures"]["proceduresDict"] = json!({
        "proc": {
            "id": "proc",
            "name": "greet",
            "params": [{ "id": "p1", "name": "who" }],
            "nekoBlockJsonList": [{
                "id": "def",
                "type": "procedures_2_defnoreturn",
                "parent_id": "",
                "inputs": { "p": { "id": "p1", "type": "procedures_2_stable_parameter", "parent_id": "def" } },
                "next": {
                    "id": "use",
                    "type": "procedures_2_parameter",
                    "parent_id": "def",
                    "fields": { "param_name": "who" }
                }
            }]
        }
    });
    let input = dir.path().join("bad.bcmkn");
    fs::write(&input, project.to_string()).unwrap();
    let (success, report) = check_json(&input, &[]);
    assert!(!success);
    let diagnostic = &report["diagnostics"][0];
    assert_eq!(diagnostic["source"], "project", "{report}");
    assert_eq!(
        diagnostic["code"], "procedure_no_such_parameter",
        "{report}"
    );

    project["procedures"]["proceduresDict"]["proc"]["nekoBlockJsonList"][0]["next"]["mutation"] =
        json!("<mutation id=\"p1\"></mutation>");
    fs::write(&input, project.to_string()).unwrap();
    let (success, report) = check_json(&input, &[]);
    assert!(success, "{report}");
}
