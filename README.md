# NekoC

NekoC, short for **Neko Compiler**, is an experimental compiler and inspection
toolchain for Kitten N `.bcmkn` projects.

Kitten means kitten; `neko` means cat. Kitten N is a visual programming
environment, while NekoC explores a text-first path: write a small TypeScript
program, compile it into Kitten N block graphs, and export a `.bcmkn` project
that the official editor can open.

## Status

This project is early and conservative.

- JSON-based `.bcmkn` inspection, roundtrip, structural diff, workspace export,
  decompile-style reporting, and validation are implemented.
- The TypeScript frontend supports a growing subset of Kitten N blocks.
- Plain TypeScript helper functions are inlined at compile time.
- Natural TypeScript variable syntax has started: `let score = 0`,
  `score = score + 1`, and `console.log(score)` compile to Kitten N blocks.
- Stage and sprite resource registration can update the background and create
  actors with their own event scripts.
- A small reverse-engineered runtime can execute a conservative subset of
  `.bcmkn` block graphs for automated state checks.
- The compiler preserves unknown project fields and avoids destructive
  rewriting of IDs/resources.

NekoC is not affiliated with Codemao or Kitten N.

## Install

Prerequisites:

- Rust toolchain
- Node.js and npm

```bash
npm install
cargo build
```

Run tests:

```bash
cargo test
npm run typecheck
npm audit --audit-level=moderate
```

Run the local editor end-to-end smoke test after the local editor harness has
its npm dependencies installed:

```bash
npm run e2e:three-body
npm run e2e:multi-screen
npm run e2e:all
```

These scripts compile sample TypeScript projects, validate the generated
`.bcmkn`, then open them through the local Kitten N editor harness under
`../research/kn-editor-local`. If Playwright has not installed Chromium yet, run
`npx playwright install chromium` in the harness directory first.

For reverse-engineering runtime behavior, capture a local editor oracle report:

```bash
npm run editor:oracle -- --input samples/three_body.compiled.bcmkn --out samples/three_body.editor-oracle.json
```

The oracle script opens the real local editor, optionally clicks the stage start
button, waits briefly, then writes page state, debug logs, `NekoDebug.snapshot()`,
and shallow global-object probes. It is intentionally diagnostic: NekoC's own
Rust runtime remains the clean implementation under test.

Compare editor-visible variables with a `nekoc run` snapshot:

```bash
cargo run -- run samples/three_body.compiled.bcmkn --ticks 58 --out samples/three_body.runtime.json
npm run editor:compare -- --oracle samples/three_body.editor-oracle.json --runtime samples/three_body.runtime.json --out samples/three_body.oracle-compare.json
```

This comparison currently uses the editor's variable panel text as the oracle.
It is useful for exposing scheduler and block-semantic mismatches while deeper
editor VM state hooks are still being reverse-engineered.

## CLI

```bash
nekoc inspect <input.bcmkn> --out report.json
nekoc roundtrip <input.bcmkn> <output.bcmkn>
nekoc diff <left.bcmkn> <right.bcmkn>
nekoc decompile <input.bcmkn> --out decompile.json
nekoc workspace <input.bcmkn> --out workspace.json
nekoc validate <input.bcmkn> --out validate.json
nekoc compile-ts <input.ts> --out workspace.json [--emit-ir program.ir.json]
nekoc compile-ts-bcmkn <input.ts> --template template.bcmkn --out output.bcmkn
nekoc compile-ts-scenario <input.ts> --template template.bcmkn --scenario scenario.json --out output.bcmkn
nekoc test <input.ts>
nekoc run <input.bcmkn> --ticks 30 [--event click] [--event key-down:81] [--out runtime.json] [--expect expected-runtime.json]
nekoc run-scenario <input.bcmkn> <scenario.json>
```

During development, use Cargo:

```bash
cargo run -- compile-ts samples/natural_ts.ts --out natural_ts.workspace.json
cargo run -- compile-ts samples/three_body.ts --out three_body.workspace.json --emit-ir three_body.ir.json
cargo run -- compile-ts-bcmkn samples/natural_ts.ts --template samples/我的作品-原生.bcmkn --out natural_ts.bcmkn
cargo run -- compile-ts-scenario samples/three_body.ts --template samples/我的作品-原生.bcmkn --scenario samples/three_body.runtime-scenario.json --out three_body.checked.bcmkn
cargo run -- test samples/unit_tests.ts
cargo run -- run samples/three_body.bcmkn --ticks 1 --out three_body.runtime.json
cargo run -- run samples/three_body.bcmkn --ticks 1 --event click --out three_body.click-runtime.json
cargo run -- run samples/three_body.bcmkn --ticks 1 --expect three_body.expected-runtime.json
cargo run -- run-scenario samples/three_body.bcmkn samples/three_body.runtime-scenario.json
```

## TypeScript Example

```ts
let score = 0;

onStart(() => {
  score = score + 1;
  console.log(score);
});
```

Pure TypeScript helper code can be covered with compile-time unit tests. These
tests are ignored by `compile-ts`, so they do not become Kitten N blocks:

```ts
function double(x: number) {
  return x * 2;
}

test("double", () => {
  expect(double(21)).toBe(42);
});
```

Run them with:

```bash
cargo run -- test samples/unit_tests.ts
npm run test:ts
```

## Runtime Checks

`nekoc run` is the first step toward a reverse-engineered Kitten N interpreter.
It loads a JSON `.bcmkn`, starts `on_running_group_activated` scripts, advances
the scheduler for a fixed number of ticks, and writes a JSON snapshot containing
the current scene, variables, actor state, console logs, and active thread
count.
Pass `--event click`, `--event key-down:<key>`, or `--event key-up:<key>` to
inject events before ticking the scheduler.
Pass `--expect expected-runtime.json` to compare that snapshot structurally and
exit nonzero with changed JSON paths when the runtime behavior diverges.
Use `nekoc run-scenario <input.bcmkn> <scenario.json>` to keep ticks, injected
events, and expected snapshot paths together in a small test file:

```json
{
  "ticks": 1,
  "events": ["click", { "kind": "key-down", "key": "81" }],
  "expect": {
    "variables.var-clicked": 1,
    "actors.actor-1.x": { "approx": 89.876663, "epsilon": 0.001 }
  }
}
```
Use `nekoc compile-ts-scenario` when you want the compiler to emit a `.bcmkn`
and immediately verify that exported project with the embedded runtime.

The current runtime subset intentionally starts small:

- events: `on_running_group_activated`, `start_on_click`,
  `on_keydown`
- broadcasts: `self_broadcast`, `self_broadcast_with_param`,
  `self_broadcast_and_wait`, `self_listen`, `self_listen_with_param`,
  `self_listen_param`, `self_listen_value`, `received_broadcast`
- control: `repeat_forever`, `repeat_n_times`, `repeat_forever_until`,
  `traverse_number`, `traverse_number_param`, `traverse_number_value`, `break`,
  `wait`, `wait_until`, `warp`, `tell`, `sync_tell`, `stop`, `restart`
- conditions: `controls_if`, `when`, `logic_compare`, `logic_operation`,
  `logic_negate`, `logic_boolean`
- variables: `variables_get`, `variables_set`, `change_variables`
- script variables: `script_variables`, `script_variables_param`,
  `script_variables_value`
- procedures: `procedures_2_callnoreturn`, `procedures_2_callreturn`,
  `procedures_2_parameter`, `procedures_2_return_value` for pure return
  expressions and statement procedure calls
- lists: `pure_list_get`, `list_append`, `list_insert_value`,
  `replace_list_item`, `delete_list_item`, `list_copy`, `list_get`,
  `list_item`, `list_length`, `list_index_of`, `list_is_exist`,
  `temporary_list`, `show_hide_list`
- values: `math_number`, `text`, `math_arithmetic`, `math_modulo`,
  `random_num`, `divisible_by`, `math_round`, `math_function`,
  `math_number_property`, `math_trig`, `convert_type`, `text_join`,
  `text_length`, `text_contain`, `text_split`, `text_select`
- actor state: `self_set_position_x`, `self_set_position_y`, `self_appear`,
  `set_scale`, `self_change_scale`
- motion: `self_go_forward`, `self_move_to`, `self_glide_to`,
  `self_change_coordinate_x`, `self_change_coordinate_y`,
  `self_glide_coordinate_x`, `self_glide_coordinate_y`, `self_rotate`,
  `self_point_towards`, `coordinate_of_sprite`, `distance_to`,
  `get_orientation`
- style/appearance values: `style_of_sprite`, `appearance_of_sprite`,
  `effect_of_sprite`
- sensing/input/time defaults: `ask_and_choose`, `self_ask`, `check_key`,
  `mouse_down`, `get_mouse_info`, `get_answer`, `get_choice_and_index`,
  `set_timer_state`, `timer`, `show_hide_timer`, `get_time`,
  `get_stage_info`, `bump_into`, `bump_into_color`, `out_of_boundary`,
  `get_clone_num`, `get_current_clone_index`, `get_clone_index_property`,
  `bump_into_body_part`, `get_appearance_of_part`, `get_tilt_angle_of_face`,
  `face_to_body_part`
- conservative display/pen no-ops: `self_appear_animation`,
  `self_gradually_show_hide`, `self_dialog`, `self_dialog_wait`,
  `close_self_dialog`, `create_stage_dialog`, `set_width_height_scale`,
  `add_width_height_scale`, `self_set_effect`, `self_change_effect`,
  `clear_all_effects`, `self_text_effect_text`, `self_text_effect_size`,
  `self_text_effect_color`, `set_top_bottom_layer`, `self_set_draggable`,
  `self_set_role_camp`, `self_stress_animation`, `global_animation`,
  `show_hide_variables`, `clear_drawing`, `self_pen_down`, `self_pen_up`,
  `self_set_pen_color`, `self_set_pen_size`, `self_change_pen_size`,
  `self_set_pen_color_property`, `self_change_pen_color_property`, `stamp`,
  `image_stamp`, `set_pen_layer`
- screens: `switch_to_screen`, `get_screens`
- logging: `console_log`

Unsupported blocks fail loudly so each newly reverse-engineered block gets an
explicit semantic implementation and test.

Older DSL-style calls are still supported while the real TypeScript lowering
layer grows:

```ts
onStart(() => {
  setVar("score", 0);
  forever(() => {
    changeVar("score", 1);
    consoleLog(getVar("score"));
  });
});
```

Stage and sprite resources can be declared at the top level. Event blocks inside
a sprite callback are attached to that generated actor:

```ts
stage({
  name: "main",
  backdrop: "https://example.com/bg.png",
});

sprite("player", {
  costume: "https://example.com/player.png",
  x: 0,
  y: 0,
  scale: 100,
  visible: true,
}, () => {
  onStart(() => {
    console.log("ready");
  });
});
```

For better editor completion, include `ts/nekoc.d.ts` in your TypeScript
project or run the checked sample directly:

```bash
npm run typecheck
```

The newer sprite callback style exposes a typed `self` API:

```ts
sprite("player", { costume: "https://example.com/player.png" }, self => {
  self.onStart(() => {
    self.x = 100;
    self.y = 50;
    self.move(10);
    self.var("score").set(0);
    self.list("items").add("hello");
  });
});
```

Multiple Kitten N screens can be declared with `screen`. Sprites inside the
callback are attached to that screen, and `switchScreen` can target another
declared screen by name:

```ts
screen("menu", { backdrop: "https://example.com/menu.png" }, () => {
  sprite("start", { costume: "https://example.com/start.png" }, () => {
    onStart(() => {
      switchScreen("game");
    });
  });
});

screen("game", { backdrop: "https://example.com/game.png" }, () => {
  sprite("player", { costume: "https://example.com/player.png" }, () => {
    onStart(() => {
      console.log("go");
    });
  });
});
```

## Repository Notes

The included `.bcmkn` fixture is a small native template used for compiler
roundtrip and validation tests. Do not add third-party or private Kitten N works
to the repository. Large editor bundles, downloaded editor assets, generated
reports, and temporary research output should stay outside Git.

## Roadmap

- Lower more natural TypeScript syntax: `if`, `while`, `for`, local variables,
  and expressions.
- Introduce a typed intermediate representation between TypeScript AST and
  Kitten N block JSON.
- Expand resource handling for local files, base64 assets, sounds, and multiple
  scenes.
- Add optimization passes after roundtrip correctness is stable.
