//! Compile and check commands share source diagnostics across all targets.
use assert_cmd::Command;
use serde_json::Value;
use std::fs;

fn nekoc() -> Command {
    let mut command = Command::cargo_bin("nekoc").unwrap();
    command.current_dir(env!("CARGO_MANIFEST_DIR"));
    command
}

#[test]
fn compile_commands_match_check_diagnostics_with_one_based_locations() {
    let dir = tempfile::tempdir().unwrap();
    for (name, source, line, column) in [
        (
            "compat",
            "// heading\nonStart(() => {\n  missingApi();\n});\n",
            3,
            3,
        ),
        (
            "syntax",
            "// heading\nonStart(() => {\n  let value = ;\n});\n",
            3,
            15,
        ),
        (
            "import",
            "// heading\n  import { missing } from \"./absent\";\n",
            2,
            3,
        ),
        (
            "map-callback",
            "// comment\nonStart(() => {\n const a = [1];\n a.map(x => missingApi(x));\n});\n",
            4,
            13,
        ),
        (
            "timer-callback",
            "// comment\nonStart(() => {\n setTimeout(() => {\n  missingApi();\n }, 10);\n});\n",
            4,
            3,
        ),
    ] {
        let input = dir.path().join(format!("{name}.ts"));
        fs::write(&input, source).unwrap();
        let checked = nekoc()
            .args(["check", "--no-types", "--json"])
            .arg(&input)
            .output()
            .unwrap();
        assert!(!checked.status.success());
        let report: Value = serde_json::from_slice(&checked.stdout).unwrap();
        let diagnostic = &report["diagnostics"][0];
        assert_eq!(diagnostic["line"], line);
        assert_eq!(diagnostic["column"], column);
        let message = diagnostic["message"].as_str().unwrap();
        assert!(!message.contains("at offset"), "{report}");
        assert!(!message.contains(&format!(".ts:{line}:{column}:")));
        let expected = format!(
            "{}:{line}:{column}: error {}: {message}",
            diagnostic["file"].as_str().unwrap(),
            diagnostic["code"].as_str().unwrap(),
        );
        let checked = nekoc()
            .args(["check", "--no-types"])
            .arg(&input)
            .output()
            .unwrap();
        assert!(!checked.status.success());
        assert!(String::from_utf8_lossy(&checked.stderr).contains(&expected));
        for command in [
            "build",
            "compile-ts",
            "compile-ts-bcmkn",
            "compile-ts-kitten4",
        ] {
            let output_path = dir.path().join(format!("{name}-{command}.out"));
            let mut cli = nekoc();
            cli.arg(command).arg(&input).arg("--out").arg(&output_path);
            if command == "compile-ts-bcmkn" {
                cli.arg("--template").arg("samples/kitten-n-0.27.4.bcmkn");
            }
            let output = cli.output().unwrap();
            assert!(!output.status.success(), "{command} must reject {name}");
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(stderr.contains(&expected), "{command}: {stderr}");
            assert!(!stderr.contains("at offset"), "{command}: {stderr}");
            assert!(!output_path.exists());
        }
    }
}
