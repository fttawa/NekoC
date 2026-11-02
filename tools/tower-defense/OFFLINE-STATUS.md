# Local official KN release playback

## Working

`node tools/tower-defense/verify.mjs <project.bcmkn> <output-directory>`

Defaults to the existing `samples/pen_display_fast.bcmkn` smoke fixture and
`D:/AppData/Local/Temp/opencode/kn-tower-offline` evidence directory. The harness
uses the locally cached Playwright package and installed Edge; it downloads nothing.

- Loads all 15 manifest-recorded KN `/neko/web/release/` JavaScript assets locally.
- Verifies every published 8-digit webpack content-hash token using normalized
  MD4 (remove the asset's own token before hashing). All 15 match.
- Removes the known collector-only `window.__req=__webpack_require__;` insertion
  when validating `main.8ccf2442.js`. The loader export remains available during
  testing, and webpack's asset base is redirected to localhost.
- Compares SHA-256 hashes of executing entry/compiler/interpreter/runtime/renderer
  module factories with the original local bundle factories. No VM stepping,
  scheduler, runtime-manager, rendering, or game procedures are replaced.
- Loads the real `.bcmkn` using official `previewUrl`, clicks the native Start
  control, and observes the native VM event bus, game frame variable, browser rAF,
  scalar/list snapshots, errors/warnings, and stage screenshots.
- The smoke fixture ran successfully with positive game/native/rAF deltas in all
  three windows and no native VM errors or warnings. Frame rates are machine-
  and fixture-specific; use each project's JSON report, not the smoke numbers.
- Native keyboard smoke actions also passed: key `2` changes the project's own
  `__pd_fps` to 30, then key `3` restores it to 60, with no fixture injection.
- Fresh browser context, blocked service workers, restrictive CSP, exact-origin
  HTTP routing, all-WebSocket abort routing, background-networking disable flags,
  and DNS restrictions. Every observed blocked request is logged.

## Scope and remaining cache gaps

This is the **official KN editor's native playback runtime inside a local test
shell**, not the unrelated NekoC pure player and not a fabricated implementation.
Runtime/project version observed: `0.27.4`.

Hash validation proves consistency with the locally recorded release manifest;
the manifest is not an independent cryptographic signature.

The cache has no official HTML/CSS. The test shell supplies minimal layout CSS;
missing official CSS is recorded and served as explicitly labeled empty styles.
The running-stage overlay requests missing UI chunk `8425.6ea6b3c6.chunk.js`;
the player VM keeps running, but complete official editor chrome is unavailable.
Other missing chrome: `card-empty.a54c99435e77c1be4547.png`,
`coordinate_portrait.55a8e78a289fb7f0d8e6.png`, DSEG timer font and block-editor
sound effects. The missing coordinate portrait image surfaces a generic browser
`Event` rejection (its target URL is captured). These remain visible in the report; they are
not reported as successful asset loads.

No cloud login, publication, account action or external asset acquisition occurs.
Cloud-enabled projects may have additional offline failures; inspect native errors
and blocked-request logs rather than treating inability to connect as success.

Evidence is split into `report.json`, `release-audit.json`,
`blocked-requests.json`, and four PNG screenshots. `runtimeVerified` and
`provenanceVerified` describe native playback and recorded-release hash checks;
`browserShellDegraded` explicitly records the incomplete editor chrome.

## Scenario interface

`KN_FRAME_VARIABLE` overrides automatic `frames`, `frame`, `__pd_frames`,
`td_frames` detection. `KN_SCENARIO` points to a local JSON action array:

```json
[
  {"name":"select-pulse", "key":"1", "holdMs":120},
  {"name":"build", "click":{"x":-200,"y":100}, "waitMs":400},
  {"name":"next-wave", "key":"Space", "until":{"name":"wave","op":"gt","value":0}},
  {"name":"pause", "key":"p", "waitMs":200, "assert":{"paused":1}}
]
```

Click coordinates use KN centered coordinates (positive y upward). Every step
records before/after snapshots and a screenshot. Optional `set` provides clearly
labeled test-fixture variable injection via the native runtime manager; normal
verification never changes game variables. `until` supports `eq` (default),
`ne`, `gt`, `lt`; `timeout` defaults to 30 seconds.

`offline-player.mjs` can also host the cache by itself (default localhost port
4178), but use `verify.mjs` for the full browser network barrier and evidence.

PowerShell smoke command:

```powershell
$env:KN_SCENARIO='tools/tower-defense/smoke-actions.json'
node tools/tower-defense/verify.mjs samples/pen_display_fast.bcmkn D:/AppData/Local/Temp/opencode/kn-tower-offline
```

For STARHOLD, clear `KN_SCENARIO` or point it to a STARHOLD action file, and pass
the generated `samples/starhold.bcmkn`; automatic counter selection uses `frames`.

`m1-actions.json` is the parent-prescribed M1 scenario. Object-format scenarios
have `before`, `benchmark`, and `after`. The M1 benchmark begins after Enter,
three real pad clicks and Space; requires mode 2, unpaused, wave 1 and active
enemies in every sample; records three four-second battle windows. All wait
conditions use 500ms polling rather than a busy rAF state loop. `domKey:true`
dispatches keydown/keyup to body through official keyboard event listeners.

`frame-metrics.json` records the battle benchmark and network counters. The
network audit counts localhost routes, HTTP/WebSocket aborts, CSP blocks, and
observed external responses/completions; any external completion fails the run.

## Embedded SVG playback path

The official editor loader `68602.c9` uploads inline SVGs. Its stage loader also
rejects localhost URLs through the CDN URL predicate. Therefore verification
uses a URL-resolved **bootstrap-only** test copy to initialize the editor, then
calls the **unaltered official playback loader `68602.UO` with the exact original
project JSON and embedded SVG URLs** before starting the native VM. This loader
directly loads the stage and skips the editor upload conversion. All 51 STARHOLD
styles successfully load, no uploads are attempted, and the native factory hash
check now includes module 68602.

`asset-resolution.json` records bootstrap URL substitutions, identical SVG-byte
SHA-256 hashes and normalized project equality; `playbackOriginalProjectSha256`
and `styleUrlsPreserved` attest that actual playback uses the original embedded
resources. No project file, game block, cloud service, texture implementation or
runtime factory is modified.

## Accepted M1 evidence (2026-11-03)

Project SHA-256:
`710f32c3a74701bb78103fc3ec6edf0ae86a4ca0e367aed7ecc76964b5fbeba9`.

- `samples/starhold-verification/m1/`: parent-prescribed three Pulse purchases,
  wave-1 combat, visible actor layer assertions, 51/51 loaded embedded SVG styles.
  Final retained parent run: 952 controller frames / 12.0635s = **78.9157 update
  FPS**, **88.4486 rAF Hz**, 1,067 native updates. Per-window update FPS:
  79.4817 / 76.9727 / 80.2963. An earlier agent rerun reported higher rates;
  use the retained `report.json` and `frame-metrics.json` above.
- `samples/starhold-verification/m1-gameplay/`: ordinary-gold central Pulse P3,
  then entry and middle Pulse upgrades between waves. All four waves won with
  44 kills, 20 lives, three stars, score 7,660, gold 196. `R` resets normally.
  The subsequent undefended run loses on wave 3 (0 lives, 0 kills, 0 stars,
  score 400), and another `R` resets to 180 gold / 20 lives / wave 0.
- Campaign opening timing: **94.8886 game FPS**, **96.8723 rAF Hz** over 3.0246s.
  The longer three-window M1 combat measurement above is the primary FPS result.
- All 27 campaign action steps have `fixture:null`; no stats, enemy state,
  wave-completion state, score or timing was injected.
- Both runs: zero native errors/warnings, all release/factory hash checks pass,
  35 CSP blocks, 0 external HTTP/WebSocket route attempts (CSP blocks first),
  **0 external responses/completed requests**, zero style upload attempts.
- Actual screenshots confirm the title, battlefield actors and readable HUD.
  Victory/defeat result panels have minor duplicate artwork/text overlap; their
  state and counters are readable, and the parent can polish layout later.

Reproduce the campaign with `KN_SCENARIO=tools/tower-defense/m1-gameplay-actions.json`
and output `samples/starhold-verification/m1-gameplay`. No commits were made by
the verification agent.
