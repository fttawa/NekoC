use nekoc::{
    engine::{Engine, Program},
    kitten4,
};
use serde_json::Value;
use std::{collections::BTreeMap, fs, time::Duration};

const NAMES: &[&str] = &[
    "speed",
    "default",
    "gravity",
    "flags",
    "properties",
    "force",
    "timed",
    "fractional",
    "boundary",
    "collision",
    "bounce",
    "friction",
    "rotation",
];
fn native(name: &str) -> Value {
    serde_json::from_slice(&fs::read(format!("tests/fixtures/kitten4/physics-{name}.bcm")).unwrap())
        .unwrap()
}
fn run(name: &str, jit: bool, dt: f64) -> BTreeMap<String, f64> {
    let source = native(name);
    let canonical = kitten4::to_neko(&source).unwrap();
    assert_eq!(kitten4::from_neko(&canonical).unwrap(), source);
    let mut e = Engine::new(Program::compile(&canonical).unwrap());
    if !jit {
        e.disable_jit();
    }
    e.start();
    for _ in 0..(5.0 / dt) as usize {
        e.advance(dt, 1_000_000, Duration::from_secs(2)).unwrap();
    }
    e.program
        .variable_names
        .iter()
        .enumerate()
        .map(|(i, k)| (k.clone(), e.numeric_variables()[i]))
        .collect()
}
fn close(value: f64, expected: f64, tolerance: f64) {
    assert!(
        (value - expected).abs() <= tolerance,
        "{value} != {expected} ± {tolerance}"
    );
}

#[test]
fn physics_fixture_properties_and_jit_match() {
    for name in NAMES {
        let v = run(name, true, 1.0 / 60.0);
        println!("{name}: {v:?}");
        assert_eq!(v, run(name, false, 1.0 / 60.0), "{name}: JIT/interpreter");
        assert_eq!(v["done"], 1.0, "{name} must finish");
        verify(name, &v, false);
    }
}

fn verify(name: &str, v: &BTreeMap<String, f64>, official: bool) {
    match name {
        "speed" => {
            close(v["initialSpeed"], 12.0, 0.01);
            close(v["movingSpeed"], 12.0, 0.01);
            assert!(v["movingX"] > 250.0);
            close(v["verticalSpeed"], 2.0, 0.01);
            close(v["verticalDir"], -90.0, 0.01);
            assert!(v["verticalY"] < -45.0);
        }
        "default" => {
            close(v["mass"], if official { 0.33 } else { 0.4 }, 0.01);
            close(v["friction"], 0.1, 0.01);
            close(v["restitution"], 0.0, 0.01);
            assert!(v["fallingY"] < -20.0);
        }
        "gravity" => {
            assert!(v["fallingY"] < -4.0);
            assert!(v["fallingSpeed"] > 0.4);
            close(v["stoppedY"], v["fallingY"], 0.1);
            close(v["stoppedSpeed"], 0.0, 0.01);
        }
        "flags" => {
            assert!(v["sensorX"] > 45.0);
            close(v["staticX"], v["sensorX"], 0.01);
            assert!(v["againX"] > v["staticX"] + 45.0);
            close(v["disabledX"], v["againX"], 0.01);
        }
        "properties" => {
            close(v["mass"], 2.0, 0.01);
            close(v["friction"], 1.0, 0.01);
            close(v["restitution"], 0.0, 0.01);
            close(v["flexibility"], 50.0, 0.01);
        }
        "force" => {
            close(v["pushedSpeed"], 0.1, 0.02);
            assert!(v["pushedX"] > 2.0);
        }
        "timed" => {
            close(v["completeSpeed"], 0.5, 0.02);
            close(v["coastingSpeed"], v["completeSpeed"], 0.01);
            assert!(v["coastingX"] > v["completeX"] + 10.0);
        }
        "fractional" => {
            assert_eq!(v["passed"], 1.0);
            close(v["unchangedSpeed"], 0.0, 0.01);
        }
        "boundary" => {
            close(v["restingY"], -350.0, 1.0);
            close(v["restingSpeed"], 0.0, 0.1);
            assert_eq!(v["touching"], 1.0);
            assert!(v["throughY"] < -370.0);
        }
        "collision" => {
            close(v["restingY"], -60.0, 1.0);
            assert_eq!(v["touching"], 1.0);
            assert!(v["throughY"] < -80.0);
        }
        "bounce" => {
            assert!(v["bouncedY"] > -355.0);
            assert!(v["bouncedDir"] > 0.0);
        }
        "friction" => {
            assert!(v["slidingSpeed"] < 1.9);
        }
        "rotation" => {
            assert!(v["rotation"].abs() > 1.0);
        }
        _ => unreachable!(),
    }
}

#[test]
fn checked_in_official_observations_match_fixture_hashes_and_behavior() {
    use sha2::{Digest, Sha256};
    let report: Value =
        serde_json::from_slice(&fs::read("tests/fixtures/kitten4/physics-official.json").unwrap())
            .unwrap();
    assert_eq!(report["officialUrl"], "https://kitten4.codemao.cn/");
    for name in NAMES {
        let case = &report["cases"][name];
        let bytes = fs::read(format!("tests/fixtures/kitten4/physics-{name}.bcm")).unwrap();
        assert_eq!(
            case["sha256"],
            format!("{:x}", Sha256::digest(bytes)),
            "{name}: stale official evidence"
        );
        assert!(case.get("error").is_none(), "{name}: official error");
        assert_eq!(case["pageErrors"], serde_json::json!([]));
        assert_eq!(case["workspaceIssues"], serde_json::json!([]));
        assert_eq!(case["applicationVersion"], "4.11.20");
        let checkpoints = case["checkpoints"].as_array().unwrap();
        assert!(
            checkpoints
                .iter()
                .all(|p| p["state"]["error"]["show_error"] == false)
        );
        let observed: BTreeMap<String, f64> = checkpoints.last().unwrap()["state"]["variables"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(k, v)| {
                (
                    k.clone(),
                    v.as_f64()
                        .unwrap_or_else(|| if v.as_bool().unwrap() { 1.0 } else { 0.0 }),
                )
            })
            .collect();
        assert_eq!(observed["done"], 1.0);
        verify(name, &observed, true);
        let native = run(name, false, 1.0 / 60.0);
        let comparable: &[&str] = match *name {
            "speed" => &[
                "initialSpeed",
                "movingSpeed",
                "verticalSpeed",
                "verticalDir",
            ],
            "properties" => &["mass", "friction", "restitution", "flexibility"],
            "force" => &["pushedSpeed"],
            "timed" => &["completeSpeed", "coastingSpeed"],
            "flags" => &["sensorSpeed", "staticSpeed", "disabledSpeed"],
            "fractional" => &["passed", "unchangedSpeed"],
            "gravity" => &["stoppedSpeed"],
            "default" => &["friction", "restitution"],
            "boundary" | "collision" => &["restingY", "restingSpeed", "touching"],
            "bounce" => &["bouncedDir"],
            _ => &[],
        };
        for key in comparable {
            close(
                native[*key],
                observed[*key],
                if *key == "restingY" { 1.0 } else { 0.02 },
            );
        }
    }
    // A failed browser probe is deliberately retained, not represented as
    // verified soft-body behavior or folded into the successful rigid cases.
    assert!(report["cases"]["soft"].get("error").is_some());
}

#[test]
fn physics_fixed_step_accepts_different_viewer_framerates() {
    for name in ["force", "timed", "flags", "boundary", "collision"] {
        let a = run(name, false, 1.0 / 60.0);
        let b = run(name, false, 1.0 / 30.0);
        for (key, value) in a {
            if key.ends_with("Dir") && key.starts_with("resting") {
                continue;
            }
            // Wait scripts sample at the next viewer tick: allow two 60Hz
            // steps plus contact solver position slop, not equal wall-clock paths.
            let tolerance = if key.ends_with('X') || key.ends_with('Y') {
                8.0
            } else {
                0.1
            };
            close(b[&key], value, tolerance);
        }
    }
}

#[test]
fn liquidfun_soft_bodies_fall_back_to_rigid_and_are_reported() {
    let source = native("soft");
    let canonical = kitten4::to_neko(&source).unwrap();
    let mut e = Engine::new(Program::compile(&canonical).unwrap());
    e.start();
    e.advance(1.0 / 60.0, 10000, Duration::from_secs(1))
        .unwrap();
    let report = kitten4::coverage(&source, 10);
    assert_eq!(report["stage"], "ran", "{report}");
}
