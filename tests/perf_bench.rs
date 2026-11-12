use assert_cmd::Command;
use serde_json::Value;

#[test]
fn perf_bench_clock_mode_is_explicit_and_default_stays_wall_clock() {
    for deterministic in [false, true] {
        let mut command = Command::new(assert_cmd::cargo::cargo_bin!("perf-bench"));
        command.args([
            "samples/kitten-n-0.27.4.bcmkn",
            "--frames",
            "2",
            "--warmup",
            "1",
        ]);
        if deterministic {
            command.arg("--deterministic");
        }
        let output = command.assert().success().get_output().stdout.clone();
        let result: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(result["deterministic"], deterministic);
        assert_eq!(result["frame_ms"].as_array().unwrap().len(), 2);
        assert_eq!(result["warmup_ms"].as_array().unwrap().len(), 1);
        assert_eq!(result["runtime"], "nekoc");
        assert!(result["final_state"]["actors"].is_object());
    }
}
