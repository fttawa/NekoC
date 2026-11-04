//! The native tier must be indistinguishable from the interpreter: same project and
//! input, byte-identical frames (minus wall-clock fields) on every update.
use nekoc::engine::{Engine, Program, encode_frame};
use serde_json::Value;
use std::time::Duration;

const FRAMES: usize = 2400;

fn engine(project: &Value, jit: bool) -> Engine {
    let mut vm = Engine::new(Program::compile(project).unwrap());
    if !jit {
        vm.disable_jit();
    }
    vm.set_random_seed(0x9E37_79B9_7F4A_7C15);
    vm.start();
    vm
}

/// Frame JSON with the fields that legitimately depend on timing removed.
fn normalized(bytes: &[u8]) -> (Value, Vec<u8>) {
    let length = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    let mut meta: Value = serde_json::from_slice(&bytes[4..4 + length]).unwrap();
    let object = meta.as_object_mut().unwrap();
    for key in ["execute_us", "budget_yield"] {
        object.remove(key);
    }
    (meta, bytes[4 + length..].to_vec())
}

fn compare(name: &str, keys: &[&str]) {
    compare_with(name, keys, &[], None);
}

fn compare_with(name: &str, keys: &[&str], tapped: &[&str], expect_positive: Option<&str>) {
    let path = name;
    let text = std::fs::read_to_string(&path).unwrap();
    let project: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap();
    let mut a = engine(&project, false);
    let mut b = engine(&project, true);
    let pressed: std::collections::BTreeSet<String> = keys.iter().map(|k| k.to_string()).collect();
    for vm in [&mut a, &mut b] {
        vm.set_pressed_keys(pressed.iter().cloned());
    }
    // A generous budget: scheduling must not depend on the host's speed here.
    let budget = Duration::from_secs(5);
    for frame in 0..FRAMES {
        if frame == 120 {
            for vm in [&mut a, &mut b] {
                vm.set_pressed_keys(tapped.iter().map(|k| k.to_string()));
                for key in tapped {
                    vm.key(key);
                }
            }
        }
        // Releasing the key is what most projects react to.
        if frame == 122 {
            for vm in [&mut a, &mut b] {
                vm.set_pressed_keys(pressed.iter().cloned());
            }
        }
        let x = a.advance(1.0 / 60.0, 200_000_000, budget);
        let y = b.advance(1.0 / 60.0, 200_000_000, budget);
        match (x, y) {
            (Ok(x), Ok(y)) => {
                let left = normalized(&encode_frame(&x).unwrap());
                let right = normalized(&encode_frame(&y).unwrap());
                if left.0 != right.0 {
                    let (l, r) = (left.0.as_object().unwrap(), right.0.as_object().unwrap());
                    let differing: Vec<_> = l.keys().filter(|k| l[*k] != r[*k]).collect();
                    let detail: Vec<String> = differing
                        .iter()
                        .take(3)
                        .map(|k| {
                            let cut = |v: &Value| v.to_string().chars().take(400).collect::<String>();
                            format!("{k}: {} <> {}", cut(&l[*k]), cut(&r[*k]))
                        })
                        .collect();
                    panic!("{name}: metadata diverged at frame {frame}: {differing:?}\n{detail:#?}");
                }
                assert!(left.1 == right.1, "{name}: pen lines diverged at frame {frame}");
                a.recycle_lines(x.lines);
                b.recycle_lines(y.lines);
            }
            (Err(x), Err(y)) => {
                assert_eq!(x.to_string(), y.to_string(), "{name}: errors differ");
                return;
            }
            (x, y) => panic!("{name}: frame {frame}: {:?} <> {:?}", x.err(), y.err()),
        }
    }
    if let Some(variable) = expect_positive {
        let id = project["variables"]["variablesDict"]
            .as_object()
            .unwrap()
            .iter()
            .find(|(_, v)| v["name"] == variable)
            .map(|(id, _)| id.as_str())
            .unwrap();
        let slot = a.program.variable_names.iter().position(|n| n == id || n == variable).unwrap();
        assert!(a.numeric_variables()[slot] > 0.0, "{name}: {variable} stayed at zero");
    }
}

#[test]
fn pencraft_matches_interpreter() {
    compare("projects/pencraft/pencraft.bcmkn", &["87", "39"]);
}
#[test]
fn polyhedron_matches_interpreter() {
    compare("samples/pen_polyhedron.bcmkn", &[]);
}
#[test]
fn pen_display_matches_interpreter() {
    compare("samples/pen_display_fast.bcmkn", &[]);
}
#[test]
fn columns_match_interpreter() {
    compare("samples/pen_display_columns.bcmkn", &[]);
}
#[test]
fn starhold_matches_interpreter() {
    compare("projects/starhold/starhold.bcmkn", &[]);
}
#[test]
fn native_studio_matches_interpreter() {
    compare("samples/native-studio.bcmkn", &[]);
}
#[test]
fn tiny_lm_generation_matches_interpreter() {
    compare_with("projects/tiny-lm/tiny_lm.bcmkn", &[], &["51"], Some("lm_generated"));
}
