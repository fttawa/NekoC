# Kitten N compatibility

## Verified editor

Checked on 2026-11-01 against <https://kn.codemao.cn/editor>:

- Project format: **0.27.4** (the editor's `version` field, distinct from its UI release number).
- Editor bundle: `main.8ccf2442.js`.
- The nested `nekoBlockJsonList` format and workspace connections remain supported.

Use the self-contained, NekoC-authored template:

```sh
cargo run -- compile-ts-bcmkn samples/kitten_n_compat.ts --template samples/kitten-n-0.27.4.bcmkn --out compatibility.compiled.bcmkn
cargo run -- validate compatibility.compiled.bcmkn
```

The template contains a white background and a blue circle as inline SVGs. Existing
templates, including 0.27.1, still work. Compilation retains the template version;
it does not relabel an old project as a newer schema. Unknown fields on retained
template objects are preserved.

## Adaptations

- `onClick` and `self.onClick` emit `sprite_on_tap` with `mouse_click` and `--self`.
  `start_on_click` is the editor's script-run button, not a sprite click handler.
- `onKey("space", body)` supports the two-argument overload. Keys such as `space`,
  `enter`, `escape`, arrow names and letters are converted to editor keyboard codes.
  Numeric code strings such as `"81"` remain accepted. CLI key events use the same
  normalization. Key-up handlers retain their state when decompiled.
- Appearance effects accept readable aliases: `color`/`hue` → `0`,
  `ghost`/`transparency` → `1`, `brightness` → `2`, `pixelate` → `3`,
  `displacement`/`mosaic` → `4`, `twist`/`whirl` → `5`, `grey`/`grayscale` → `6`.
  The mapping applies to `setEffect`, `changeEffect` and `effectOf`, not pen effects.
- Registering sprites retains referenced template backgrounds. Top-level scripts
  fall back to the current scene when the template has no actors, including when
  source-defined sprites replace the template actors.
- Broadcast dropdown entries are registered for the final scene IDs, including
  newly declared screens. Validation checks dangling style references and procedure
  block parents/comments as well as scene/actor blocks.

The local runtime's `click` event remains a synthetic event dispatched to click
handlers; it does not simulate sprite texture hit testing.

## Live-editor check

The new probe opens an isolated headless browser and uses the current official
editor's project validator and actual Blockly workspaces. It checks block presence,
connections and dropdown values, including procedure workspaces. Reports record the
editor bundle URL and project version. This checks editor loading/rendering; it is
not a full test of the official runtime's graphics, audio, AI or hardware features.

Install Playwright for this optional check:

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run editor:compat -- compatibility.compiled.bcmkn --out compatibility.report.json
```

On Windows, `--channel msedge` can use installed Edge instead of downloading
Chromium. `NEKOC_NODE_MODULES` may point to an external `node_modules` containing
Playwright. Multiple input files are supported. The probe does not require the
untracked local harness used by `editor:oracle`.

Downloaded editor code and generated reports should stay outside Git. If a future
editor changes its module loader or exported interfaces, the probe fails and must
be updated rather than silently reporting compatibility.
