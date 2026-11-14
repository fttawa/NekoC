use nekoc::{bcmkn_compiler, project, runtime, validate};
use serde_json::json;
use std::fs;
use tempfile::tempdir;

#[test]
fn statement_argument_helpers_return_before_resuming_caller_loops() {
    let dir = tempdir().unwrap();
    let input = dir.path().join("statement-loop.ts");
    let output = dir.path().join("statement-loop.bcmkn");
    fs::write(
        &input,
        r#"
let out=0; let value=1;
function add(x:number) { if(x>0) out+=x; }
onStart(()=>{for(let i=0;i<3;i++){add(value);value++;}out+=100;});
"#,
    )
    .unwrap();
    bcmkn_compiler::compile_ts_bcmkn(
        input,
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("samples/kitten-n-0.27.4.bcmkn"),
        &output,
    )
    .unwrap();
    let p = project::load_project(output).unwrap().value;
    assert_eq!(validate::build_report(&p).unwrap()["ok"], true);
    let reference = runtime::run_project(&p, 1).unwrap();
    assert_eq!(
        serde_json::to_value(reference).unwrap()["variables"]["kn-var-out"],
        106.0
    );
}

#[test]
fn fast_display_compiles_and_draws_only_queued_rectangles() {
    let dir = tempdir().unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    fs::create_dir(dir.path().join("modules")).unwrap();
    for name in [
        "math",
        "config",
        "stats",
        "state",
        "color",
        "display",
        "fast",
        "paint",
        "raster",
        "direct",
        "raster28",
        "raster-border",
    ] {
        fs::copy(
            root.join(format!("modules/pen-display/{name}.ts")),
            dir.path().join(format!("modules/{name}.ts")),
        )
        .unwrap();
    }
    let input = dir.path().join("fast.ts");
    let output = dir.path().join("fast.bcmkn");
    fs::write(
        &input,
        r#"
import { displayInit } from "./modules/display";
import { displayFastInit, displayQueueRect, displayPresentFast } from "./modules/fast";
import { displayUseConstantColor, displayRectBounds } from "./modules/direct";
import { pfRaster } from "./modules/raster";
import { rgb } from "./modules/state";
defineProc("draw", [], () => { pfRaster(); });
onStart(() => {
    displayInit(4, 3, 2, 0, 6, 60);
    displayFastInit();
    displayQueueRect(-1, 0, 2, 3, 16711680);
    displayQueueRect(1, 1, 3, 1, 255);
    displayQueueRect(8, 0, 2, 1, 65280);
    displayPresentFast();
    displayPresentFast();
    displayQueueRect(0, 0, 4, 3, 65280);
    displayPresentFast();
    displayUseConstantColor(rgb(8, 12, 24));
    displayRectBounds(0, 0, 4, 3);
    callProc("draw");
});
"#,
    )
    .unwrap();
    bcmkn_compiler::compile_ts_bcmkn(input, root.join("samples/kitten-n-0.27.4.bcmkn"), &output)
        .unwrap();
    let p = project::load_project(output).unwrap().value;
    assert_eq!(validate::build_report(&p).unwrap()["ok"], true);
    let snapshot = runtime::run_project(&p, 1).unwrap();
    let strokes = &snapshot.actors["nekoc-default-actor"].pen.strokes;
    assert!(strokes.len() > 2);
    assert_eq!(strokes[0].color, "#ff0000");
    assert_eq!(strokes[1].color, "#0000ff");
    assert!(strokes[2..].iter().any(|s| s.color == "#00ff00"));
    assert_eq!(strokes.last().unwrap().color, "#080c18");
    assert_eq!(strokes[0].size, 2.0);
    let state = serde_json::to_value(snapshot).unwrap();
    assert_eq!(state["variables"]["kn-list-__pf_commands"], json!([]));
    assert_eq!(state["variables"]["kn-var-__pd_frames"], 3.0);
}

#[test]
fn column_actors_have_independent_colors_and_a_frame_barrier() {
    let dir = tempdir().unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    fs::create_dir(dir.path().join("modules")).unwrap();
    for name in [
        "math",
        "config",
        "stats",
        "state",
        "color",
        "framebuffer",
        "display",
        "columns",
    ] {
        fs::copy(
            root.join(format!("modules/pen-display/{name}.ts")),
            dir.path().join(format!("modules/{name}.ts")),
        )
        .unwrap();
    }
    let mut source = String::from(
        r#"
import { displayInit } from "./modules/display";
import { displayPixel } from "./modules/framebuffer";
import { displayPresentColumns, displayRenderColumn } from "./modules/columns";
sprite("Controller", { visible: false }, () => {
    onStart(() => {
        displayInit(2, 2, 2, -2, 2, 30);
        displayPixel(0, 0, 16711680);
        displayPixel(0, 1, 16711680);
        displayPixel(1, 0, 255);
        displayPixel(1, 1, 255);
        displayPresentColumns();
        setVar("after_barrier", 1);
        displayPixel(0, 0, 0);
        displayPresentColumns();
    });
});
"#,
    );
    for col in 0..2 {
        let names = [
            "y", "end", "color", "r", "g", "b", "max", "min", "delta", "hue", "sat", "extend",
        ]
        .map(|name| format!("\"__pc_{col}_{name}\""))
        .join(", ");
        source.push_str(&format!(
            r#"sprite("Column {col}", {{ visible: false }}, () => {{
            onMessage("__pd_render_columns", () => {{ displayRenderColumn({col}, {names}); }});
        }});"#
        ));
    }
    let input = dir.path().join("columns.ts");
    let output = dir.path().join("columns.bcmkn");
    fs::write(&input, source).unwrap();
    bcmkn_compiler::compile_ts_bcmkn(input, root.join("samples/kitten-n-0.27.4.bcmkn"), &output)
        .unwrap();
    let p = project::load_project(output).unwrap().value;
    assert_eq!(validate::build_report(&p).unwrap()["ok"], true);
    let snapshot = runtime::run_project(&p, 20).unwrap();
    let col0 = snapshot
        .actors
        .values()
        .find(|a| a.name == "Column 0")
        .unwrap();
    let col1 = snapshot
        .actors
        .values()
        .find(|a| a.name == "Column 1")
        .unwrap();
    assert_eq!(col0.pen.strokes.len(), 4); // merged red run, then black erasure
    assert_eq!(col1.pen.strokes.len(), 2); // unchanged blue column skipped in frame two
    assert_eq!(col0.pen.strokes[0].color, "#ff0000");
    assert_eq!(col0.pen.strokes[2].color, "#000000");
    assert!(col1.pen.strokes.iter().all(|s| s.color == "#0000ff"));
    assert!(col0.pen.strokes.iter().all(|s| s.x1 < 0.0 && s.x2 < 0.0));
    assert!(col1.pen.strokes.iter().all(|s| s.x1 > 0.0 && s.x2 > 0.0));
    let state = serde_json::to_value(snapshot).unwrap();
    assert_eq!(state["variables"]["kn-var-__pd_frames"], 2.0);
    assert_eq!(state["variables"]["kn-var-after_barrier"], 1.0);
    assert_eq!(
        state["variables"]["kn-list-__pd_front"],
        json!([0.0, 255.0, 16711680.0, 255.0])
    );
}

#[test]
fn pen_display_compiles_import_graph_and_renders_rgb_strokes() {
    let dir = tempdir().unwrap();
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let module = root.join("modules/pen-display");
    let source = r#"
import { displayInit, displayPresent } from "./modules/display";
import { displayPixel } from "./modules/framebuffer";
import { rgb } from "./modules/state";
onStart(() => {
  displayInit(3, 1, 2, 0, 0, 30);
  displayPixel(0, 0, rgb(255, 0, 0));
  displayPixel(1, 0, rgb(0, 255, 0));
  displayPixel(2, 0, rgb(0, 0, 255));
  displayPresent();
});
"#;
    // Copy modules alongside the test source (portable across Windows drives).
    fs::create_dir(dir.path().join("modules")).unwrap();
    for name in [
        "math",
        "state",
        "color",
        "framebuffer",
        "display",
        "config",
        "stats",
    ] {
        fs::copy(
            module.join(format!("{name}.ts")),
            dir.path().join(format!("modules/{name}.ts")),
        )
        .unwrap();
    }
    let input = dir.path().join("display.ts");
    fs::write(&input, source).unwrap();
    let output = dir.path().join("display.bcmkn");
    bcmkn_compiler::compile_ts_bcmkn(input, root.join("samples/kitten-n-0.27.4.bcmkn"), &output)
        .unwrap();
    let p = project::load_project(output).unwrap().value;
    assert_eq!(validate::build_report(&p).unwrap()["ok"], true);
    let snapshot = runtime::run_project(&p, 1).unwrap();
    let strokes = &snapshot.actors["nekoc-default-actor"].pen.strokes;
    assert_eq!(strokes.len(), 6);
    assert_eq!(strokes[0].color, "#ff0000");
    assert_eq!(strokes[2].color, "#00ff00");
    assert_eq!(strokes[4].color, "#0000ff");
    let state = serde_json::to_value(snapshot).unwrap();
    assert_eq!(
        state["variables"]["kn-list-__pd_front"],
        json!([16711680.0, 65280.0, 255.0])
    );
}
