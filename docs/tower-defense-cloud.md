# Tower defense: Kitten N native-cloud design and source audit

## Delivered status — 2026-11-03

**Online cloud integration is incomplete.** The final `.bcmkn` contains local native lists/scalars and text stamps, no configured cloud IDs and no cloud read/write blocks. The nine-scalar format below is a source-backed future design, not an implemented synchronization layer or optional binding switch.

Implemented `modules/tower-defense/cloud.ts`: six ten-slot local tables; one session pseudonym retaining only its best score in each table; twelve recent preset messages; maximum16 UTF-16 units; exact six-phrase allowlist; 30-second unpaused wall-timer cooldown; validation again before display. Links, contact information and arbitrary sensitive text cannot match the allowlist. No free-text entry is exposed. Closing/restarting the work loses these records; there are no fabricated other players.

Native offline test: first preset accepted, second immediate send rejected, next accepted only after cooldown; both remain after an ordinary-gold four-wave victory. Score7480 was inserted exactly once, all six table selectors work. All36 scenario steps used keyboard/mouse without state fixtures. Evidence: `samples/starhold-verification/m5/`. Separate tests cover corrupt ingress, overlength and hidden suffixes, replay/foreign-session rejection, 12-entry eviction, sorting and personal-best replacement.

Two native compatibility issues were fixed during integration: descending `for` loops are rewritten as ascending loops with reverse indices; `.length` on the helper call emitted a disconnected reporter, so explicit native `length(getVar(...))` is used and artifact-tested.

Completing the online version requires legitimate server-issued work/resource IDs and an authorized online test environment. Under the current no-login/no-network rules these are unavailable. Nothing here claims online synchronization, public multi-user chat, durability, authoritative scores or transaction safety.

Audit date: **2026-11-02**. Target: cached Kitten N **0.27.4**, main bundle `main.8ccf2442.js`. This is a design/research deliverable for M5, not an online deployment or a runtime integration test.

## Decision for the parent implementation

**The complete offline game can have six local top-10 tables and a local last-12 chat/demo buffer. An authenticated, durable, concurrent online version cannot be provisioned or guaranteed in this task.** No network requests, browser/editor sessions, login, account actions, publication, or server-resource creation were performed during this audit.

The examined KN client supports **public scalar variables**, not public cloud lists. Its creation UI permits **10** public variables and **4** built-in leaderboards. Public string writes use `slice(0, 128)`. Thus a seven-cloud-list design borrowed from Kitten 4 is incompatible with this KN build.

A compact **9-public-scalar** representation below fits six score tables plus twelve short messages, with each record under 48 characters and each scalar at most 122 characters. It is a **best-effort, non-authoritative community cache**: native read/modify/set cannot prevent concurrent lost updates, prove identity, or guarantee all-time top ten / exact global last twelve. If those guarantees are required, the requested native-only feature is **not established as feasible** by these sources. M5 must expose that distinction rather than claim an online service exists.

No client-side `published` prerequisite was found in cloud provisioning: the code requires login and a server `workId`, and calls `saveWork()` if necessary. Consequently, **“cloud always requires publication” is unconfirmed**. Under the present no-network/no-login/no-publish conditions, online provisioning and public sharing are unavailable regardless. An unpublished local `.bcmkn` is not an online backend.

## Evidence scope and provenance

Only local official-source cache `D:/AppData/Local/Temp/opencode/nekoc-kitenn/runtime-source/` and local repository documentation/schema/source were inspected. The cache manifest records the historical source URL `https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js`; it was **not fetched** in this task. Factory text was parsed as JavaScript syntax, never evaluated. SHA-256 fingerprints are in the final section and the companion [`cloud-schema.json`](../tools/tower-defense/cloud-schema.json).

“Confirmed” below means **confirmed in this cached client**, not a server guarantee or a current production policy. UI caps, string slicing and batching are different from server quotas.

## Confirmed limits versus unknown constraints

| Topic | Cached-client evidence | Interpretation |
|---|---|---|
| Public variable creation count | **88106**, export `Ci`, local `h = 10`; **17028** creation UI tests `te >= No.Ci`; **11004** `q/$` import path falls back to ordinary variable at `I >= H.Ci` | 10 is the operative creation/UI cap. |
| Conflicting internal counter | **69138** `cloudVariableStore.increaseCloudVariableNum`: `Math.min((this.cloudVariableNum || 0) + 1, 20)` | This is a counter clamp, **not evidence that 20 are creatable**. Use 10. |
| Variable/list types | **1892**: `Variable="any", List="list", PublicCV="public", LocalVariable="private", LocalList="private_list"`; scalar types `[any,private,public]`, list types `[list,private_list]` | No public-list type exists in this inspected model. `private_list` is device-local, not a private online list. |
| Cloud list count/length | **46501** `getListDomainFunctions`: mutates arrays and persists only `LocalList`; no cloud queue branch | No KN cloud-list capacity to quote. Ordinary list routines inspected have no comparable explicit length cap; memory/runtime constraints are unknown. |
| Cloud write value types | **46501** `getVariablesDomainFunctions` helper `s`: object non-array rejected; arrays `join(",")`; only number/string accepted | Do not store JSON objects or assume array mutations synchronize. Serialize explicitly as a scalar string. |
| Cloud string write length | **46501**, `rn = 128`; helper `s`: `s = s.slice(0, rn)` | Maximum passed from each string write operand in this path: **128 UTF-16 code units**, not 128 bytes or code points. This does not prove a server storage bound or the result bound for repeated string increments. |
| Invalid numeric values | Same helper enqueues `value:null, action:"set", param_type:"number"` for NaN/±Infinity result | Validate finite integer scores before writing. Incoming null becomes runtime NaN. |
| Cloud write scheduling | **93454** export `vO = 100`; **11004** `initCloudVariableTimer`: `setInterval(..., D.vO)` | Queue flushed roughly every **100 ms**. This is batching, **not a verified server allowance of 10 writes/sec**. |
| Per-variable queue merge | **18027** `enQueue`: key is `cvId`; later `set` overwrites queued value/action/type; increments coalesce | Multiple writes to one variable within the interval are not separate log records. |
| Native leaderboard count | **1892** export `yp = 4`; **51395** creation/import guards; **17028** tooltip says `最多创建4个` | Six independent native ranking resources exceed this client UI cap. Do not fabricate six IDs. |
| Leaderboard record count | **40742** rank-number shadow constraints `1,100,1`; **46501** better-score test checks `l.length >= 100` | Client expects a top-100-shaped result, but this does **not** establish server retention/pagination guarantees. |
| Leaderboard write/read pacing | **46501** `zt.DEBOUNCE_INTERVAL = 2000`; `Ht/Ft` caches reads for 1000 ms; display may wait 1500 ms after an update | A single pending ranking task merges by better score without partitioning by board ID. Avoid rapid cross-board submissions. These are client behaviors, not server quotas. |
| Server quotas | **78798** maps `OVER_MAX_NUM`, `FREQUENCy_LIMIT`, `NO_AUTH`, `NO_LOGIN`; **93454** has `MoreThanRoomLImit` | Actual server variable/list limits, room size, payload bytes, rate buckets, retention, moderation, conflict ordering and persistence SLA are **unknown**. Error names alone give no numeric quota. |

**48 characters is an application budget, not an official limit.** The recommended compact online scoreboard record is 12 ASCII characters; compact chat record is exactly 30 UTF-16 code units. The larger local-only chat record budget is 48. A whole cloud scalar may contain several records and therefore exceeds 48 while staying below 128.

## Synchronization and failure behavior

### Cloud scalar flow

1. **40283** `initRuntimeCloudData` (`fe/Ae`) first checks preview/login state. **Logged out, it emits `CLOUD_VARIABLE_INIT_END` when appropriate and returns before calling cloud initialization**; the examined client therefore uses local fallback rather than connecting anonymously. Only after that gate does it delegate to **11004** `de/pe`, which walks `variablesDict`, handles `private` through local storage, skips public initialization in debug mode, and skips public connection when `workStore.workId` is missing. This proves the client path, not the server's anonymous-access policy.
2. `navigator.onLine === false` produces a toast explaining that cloud variables are treated as ordinary variables. This is fallback, not upload queueing.
3. When `disabledEdit` is true and login passes, initialization uses the listing API path; otherwise the socket path is used. **82277** export `w` also includes file URL, preview URL and historical-backup modes; **40283** returns early for these preview modes unless `disabledEdit` applies, and **46501** disables their cloud writes. Merely loading a file that contains `cvId` does not establish writable online mode.
4. **11004** `initSocket` uses the official socket service with a work/session ID and token, WebSocket transport, `reconnection:false`. `connect → join → connect_done → list_variables → list_variables_done` initializes the list. There is no explicit timeout in the inspected initialization Promise.
5. **46501** getter/setter/change blocks can lock their script until `CLOUD_VARIABLE_INIT_END`. Use an independent UI/gameplay script and a bounded UI timeout; a timer in the blocked script cannot rescue it.
6. Cloud write branch requires socket status, writable context, a real `cvId`, not being in `localRunCloudVariable`, and `type === "public"`. It enqueues and returns without immediately changing the runtime value. The fallback branch updates runtime and theatre immediately.
7. **11004** `UPDATE_VARS_DONE` maps server `cvid` to local `id`, then updates runtime/theatre. A read immediately after a cloud write can therefore be stale. There is no native block shown for socket status, request ID, commit acknowledgement, compare-and-swap, or transactional append.
8. A `cvId` absent from the initial server list is added to `localRunCloudVariable`; its writes use local fallback. Socket stop/disconnect clears the interval and queue, sets socket status false, and does not replay unsent writes. Runtime restart reinitializes. Persistence across a later run depends on the server and is not demonstrated here.

**Important:** write/read equality cannot prove online success; local fallback returns the same value too. Do not show “synced” merely because a variable echoes. With native blocks alone, present `local`, `configured / status unverified`, or `pending / outcome unverified` rather than invent a positive connectivity reporter.

### Race counterexample

Two clients read revision 7, independently merge A or B, and both write revision 8. The last arriving `set` can discard the other record. Adding a revision string, a read-back check, random delay, or a “lock” scalar does not make the check and write atomic. The examined native API has no CAS or exclusive ownership primitive. Finite retry improves the chance of convergence but cannot recover a record no surviving client observed.

Never clear, sort-in-place, or reinitialize shared storage on ordinary game start. Never use `change_variables` as an atomic ticket allocator: the client receives no unique increment return value. Never use per-frame score writes.

## Built-in identity and privacy

**46501** `getOnlineDomainFunctions`, `usernameGet` and `userIdGet`:

```js
// username_get
if (!E.He()) return "未登录用户";
return userStore.userProfile?.nickname || "";
// user_id_get
if (!E.He()) return "0";
return userStore.userProfile?.id || "";
```

`E.He` is **39942** export `He`, which checks existing login/native user state. These two reporters themselves do not prompt for login and do not issue an HTTP request in the examined implementation. **40742** declares `user_id_get` output as Number even though logged-out fallback is string `"0"`; normalize to text before checking `""` / `"0"`. Do not rely on nickname to detect login or provide uniqueness. Logged-in-but-unavailable profile data can return empty strings.

The native ranking reader `user_info_of_th` can return `username`, `userId`, or `score`. Its inspected implementation requires an existing current-user profile ID and otherwise returns NaN; missing rank returns `无记录`. `user_ranking_info` returns `未上榜` when not listed. Identity fields are account identifiers, not credentials, but copying them into a shared scalar makes them available to other clients reading it.

For the compact community format use a **random session pseudonym**, not a raw user ID, truncated ID, modulo ID, or reversible “hash.” Generate six decimal digits locally (100000–999999), render `P123456`, reuse for this session, and treat collisions as possible. This is not account authentication or a unique player identity. Keep actual username/user ID out of shared packets; no cookies/tokens belong in the project or packets. Local free-text nickname may be displayed locally but is not serialized by the compact online format.

**68602** `_e` checks for public/private variables, local lists and rankings on load. Logged-out projects containing them may show a “some functions require login” toast/dialog offer even before an explicit write. The hard-offline artifact should use `type:"any"` and `type:"list"`, no native ranking resources and no fabricated `cvId`.

## Native block contract (KN, not Kitten 4)

Definitions: **40742** `Pt` (variables), online block registration in `Yt`; names: **26912**; execution: **46501**. Fields contain **local project IDs**, not server `cvId`/`rankingId` and not arbitrary names after serialization.

| Block type | Fields | Value inputs | Output / notes |
|---|---|---|---|
| `variables_get` | `variable: <local id>` | none | Number/String/Boolean/Array; public metadata chooses cloud semantics |
| `variables_set` | `variable: <local id>` | `value` | Statement; same block for public scalar |
| `change_variables` | `variable`, `method: increase/decrease` | `value` | Statement; avoid for serialized records |
| `show_hide_variables` | `variable`, `show_hide: show/hide` | none | Statement |
| `username_get` | none | none | String; logged-out text above |
| `user_id_get` | none | none | Declared Number, runtime may return string/empty |
| `show_hide_ranking` | `ranking`, `show_hide` | none | Mutation `selectShowHideRankingMutator`; use exact native defaults if emitted |
| `update_ranking` | `ranking`, `variable` | none | Score is read from the selected scalar variable ID, **not an input socket** |
| `user_ranking_info` | `ranking`, `type: rank/score` | none | Async Number/String, can return NaN/text sentinel |
| `user_info_of_th` | `ranking`, `type: username/userId/score` | `order` | 1-based rank; stock shadow range 1–100 |

`cloud_variables_set`, `cloud_lists_append`, and their uppercase `VAR` / `VALUE` fields in `docs/kitten4-block-schema.json` are **Kitten 4**, not the KN schema. Do not emit them in `.bcmkn`.

Native ordinary list operations for local tables: `list_get` (`fields.list`), `list_append` (`inputs.list`, `inputs.list_item_value`), `list_length` (`inputs.list`), `list_item` (`fields.item:any/last`, `inputs.list`, `inputs.list_index`), `delete_list_item` (`fields.item:any/last/all`, `inputs.list`, `inputs.list_index` as applicable). Lists are 1-based. Guard empty lists before number traversal: KN `1..0` traverses backwards, as already documented in `docs/kitten-n-runtime-findings.md`.

## Project metadata and NekoC support

Project paths are `variables.variablesDict[localId]` and `rankings.rankingsDict[localId]` (**91107**). Official variable factory **87123** `U` creates `id,type,name,value,style,scale,visible,position,isGlobal,currentEntityId,createTime,cvId`. Public variables are global. Illustrative metadata only:

```json
{
  "variables": {
    "variablesDict": {
      "local-variable-id": {
        "id": "local-variable-id", "name": "TD_L1", "type": "public",
        "value": "", "style": "default", "scale": 1, "visible": false,
        "position": { "x": 20, "y": 20 }, "isGlobal": true, "createTime": 0,
        "cvId": "SERVER_ISSUED_ID_ONLY"
      }
    }
  }
}
```

Do **not** put that placeholder into a runnable artifact. An offline record is `type:"any"` with no `cvId`. Real `cvId` comes from **78798** add-variable response; **56609** `vF/g/h` first ensures login and a saved server work ID. Work/session binding is runtime `workStore.workId`, not just `projectName`, file name, local UUID or an invented root field.

Native ranking metadata (**51395**, **92943**) is `{id, rankingId, name, sortType, createTime}`. `sortType:1` (`Forward`) compares higher scores as better; `2` compares lower scores as better. Saving/importing may sync/remap server resources. Offline JSON cannot mint a valid resource.

NekoC at audit time:

- `setVar`, `getVar`, `changeVar`, ordinary lists, text concatenation, `splitText`, `selectText`, `toNumber`, numeric arithmetic and loops are available. `ts/compile-ts.mjs:1272` emits `variables_set`, field `variable`, input `value`.
- `self.showRanking`/`hideRanking` are declared at `ts/nekoc.d.ts:224` and compiler cases at `ts/compile-ts.mjs:1138` emit native fields. They do not provision a ranking or establish server ID mapping.
- No public API declaration/compiler case for username/user-ID reporters, score submission, ranking readers, cloud provisioning, cloud mode, or socket status was found. A parent-owned, narrow native-block emission/patch step or compiler extension would be needed for those reporters; this audit adds none.
- `src/bcmkn_compiler.rs::insert_variable` emits `type:"any"`; `insert_list` emits `type:"list"`. Existing variable metadata may be retained when resolved from a template, but `reset_template_for_registered_resources` clears the entire variable dictionary at line 430. **Do not rely on a template's cloud bindings surviving source-defined sprite/resource registration.** If a future authorized binding step exists, apply it after compilation and validate all field IDs.
- Rust local runtime/engine have no inspected cloud transport or identity implementation. Passing local execution cannot certify cloud semantics. Repo source-audit metadata likewise does not mark those semantics verified.
- `selectText` compiles to native `text_select`; **46501** uses 1-based inclusive indices. Avoid zero/negative/reversed ranges; the native implementation can reverse a reversed substring. Work in fixed-width strings for the format below.

## M5 format contract

### Delivery mode

The deliverable for this task is `offline`: ordinary local variables/lists, cloud-enabled flag hard false, no `cvId`, no `rankingId`, no work ID provisioning and no network-capable online blocks in startup paths. UI: **“本地记录 · 云端未配置”**. Show real local results; an empty leaderboard is empty, not seeded with invented online users. A local chat test must be labeled **“本地留言演示（不发送）”**.

The codec below may be implemented/tested locally at M5. Enabling it online is a separate future action requiring changed user authorization and real editor-issued bindings. No game code is included here.

### Storage allocation

| Name | Count | Contents | Maximum scalar size |
|---|---:|---|---:|
| `TD_L1` … `TD_L6` | 6 | One complete top-10 snapshot per level | 122 ASCII chars each |
| `TD_C0` … `TD_C2` | 3 | Four fixed-width message slots per shard | 122 UTF-16 units each |
| Unallocated | 1 | Leave unused; not a lock / ticket counter | — |

This is nine scalar variables, **zero cloud lists, zero native ranking resources**. The tables and chat shard are independently parseable. They are not atomic across variables.

### Scoreboard wire version `S1`

Alphabet is decimal ASCII; prefix is `S1`. A score record is exactly **12** characters:

```text
PPPPPPSSSSSS
P = six-digit random session pseudonym, 100000..999999
S = six-digit zero-padded integer score, 000000..999999
Example: 123456004200
```

Payload: `S1` followed by **0..10** records, no separators. Empty: `S1`. Example: `S1123456004200`. Maximum: `2 + 10*12 = 122`.

Validate the complete envelope before accepting any records: length 2..122, exact prefix, `(length-2) % 12 == 0`, at most ten records, each character decimal, pseudonym nonzero and six digits, score within the chosen bound. Invalid packet is not an empty table and must not trigger overwrite/reset. Do not silently truncate a score or pseudonym. Reject out-of-range score with a local diagnostic. The scoring design must make 999999 unreachable or explicitly version the format before exceeding it.

Deterministic merge: combine latest valid remote snapshot, locally observed cache and this session's completed result; keep maximum score per pseudonym; order score descending then pseudonym numeric ascending; take first ten. Six levels are independent variables. This represents **session-best scores**, not authenticated per-account personal best. Pseudonym collision may merge two players. Tie order is deterministic but not “first achieved.” Scores are untrusted client claims.

Local index `i=0..9`: record starts at 1-based character `3 + 12*i`; pseudonym ends `8 + 12*i`, score spans `9 + 12*i` through `14 + 12*i`. Check record count before extracting. Pad with decimal-string operations; keep leading zeroes as text, never cast the whole envelope to Number.

### Compact chat wire version `C1`

Three shards have exactly **four slots**, each exactly **30 UTF-16 code units**. Prefix `C1`, so every initialized shard is exactly `2 + 4*30 = 122` units. Empty slot is **30 ASCII spaces**. This uses the same native scalar operations as scores.

```text
PPPPPP TTTTTT Q L BODY..............
6      6      1 1 16 code units       (spaces above are diagram separators only)
```

Actual slot positions:

| 1-based positions | Field | Rules |
|---|---|---|
| 1–6 | pseudonym | Six decimal digits 100000..999999 |
| 7–12 | ordering key | Six decimal digits 000001..999999; Lamport-style local key, **not wall time or server sequence** |
| 13 | nonce | Decimal 0..9; part of duplicate key |
| 14 | body length | One symbol from `0123456789ABCDEFG`, representing 0..16; active records use 1..16 |
| 15–30 | body | Up to 16 allowed UTF-16 units, then right-pad with ASCII space to 16 |

Example active record (trailing spaces are significant): `12345600000102Hi              `, exactly 30 units. Empty shard: `C1` plus 120 spaces. All-spaces slot is the only empty-slot encoding; a partly malformed slot invalidates the shard for writing. Do not use raw fixed-width padding as displayed text; honor the length symbol and validate padding.

For a native-only sanitizer, build the body character by character with `selectText(text,i)`. Allowed alphabet is ASCII letters/digits, ASCII space and punctuation `.,!?+-()`, plus an explicit finite game vocabulary such as `你好谢谢加油厉害防御塔升级金币敌人关卡胜利失败再来一起玩我过了`. Replace disallowed characters with a space, trim outer spaces, reject empty body, and cap at **16** units. This whitelist avoids controls, delimiter concerns and split surrogate pairs using existing native operations. It is a design constraint, not a platform moderation guarantee; the UI must show the 16-character limit. A phrase selector is also compatible with the same body field.

Full 48-character chat records for all twelve messages require 576 units before envelope overhead. Alongside six 122-unit scoreboards, that exceeds the nine-variable allocation and the ten-variable cap. Therefore **48 is a ceiling, not a promised free-text message length**. The offline chat can use a richer `C1|pseudonym|localSequence|body` record with a six-digit local sequence (1..999999), body up to 28 units, and an explicit total-length check of at most 48 units (maximum with these fields is 45). Replace `|` and control characters in the body, reject empty text, and stop before sequence wrap. That local record is not the compact cloud wire format. Keep precisely the last twelve local send events by sequence in an ordinary list.

Shard choice: `pseudonym % 3`, stable for the session. Read all three valid shards, take max observed ordering key, advance local key to `max(local, observed) + 1`; reject send at 999999 rather than wrapping. Nonce changes each message. The message key is `(pseudonym, orderingKey, nonce)`. Merge only the selected shard with its valid local cache and the new record; deduplicate by key, retain four greatest keys ordered by `(orderingKey, pseudonym, nonce)`, encode the four slots in descending order with empty slots last. Read-only clients must not write caches back.

Render the union of valid shard records, deduplicated by key, ordered by the same tuple, with at most **12** displayed. Keep a local observed last-12 cache if desired and mark it local. **Four-per-shard retention is not exact global last-twelve retention:** a busy shard can evict a globally newer message while another shard still holds older messages. This is an explicit product limitation. Late joining readers only see retained shared records. Lost updates and pseudonym collisions remain possible.

### Bounded update policy (chosen values, not official quotas)

- One background storage worker, independent of game/render input handling. No storage operation in the render loop.
- Local cache refresh/display at most once per **1 second**; scalar reads use the runtime cache, not a new HTTP request per read.
- Score submission only at successful end-of-level, only if this session's best improves; at most **one attempt per 5 seconds** per client across all level variables. Keep at most six pending results, coalesced per level, in ordinary local memory.
- Chat submit at most **one attempt per 5 seconds**, only after explicit send; keep at most one pending message. Never replay pre-login/offline messages automatically when a later run becomes online.
- Initial randomized delay 0.2–0.8 seconds; reread before encoding, skip identical result. After a write, delay at least 1 second before a read-back; one retry after 3–5 seconds if a new valid snapshot clearly excludes the pending contribution, **also respecting the 5-second attempt cooldown**. Maximum two attempts per contribution. Read-back is outcome-unverified because fallback may echo locally.
- Invalid/unknown-version packet: retain last good **local** cache, show unavailable/stale, do not repair/reset shared state. No infinite merge/repair traffic and no writes merely to canonicalize someone else's data.
- Local UI timeout 5 seconds: gameplay continues; pending display becomes “状态未确认 / 本地保留”. Native script initialization itself may remain locked; use a separate script and do not wait on it from game start.
- Ordinary startup never writes empty envelopes. Only a future authorized owner provisioning step could initialize empty shared values. This task does not perform it.

These choices reduce traffic and damage, but cannot provide transactionality, verified global ordering, authenticated identity or anti-cheat. Hard-offline M5 has no online writes at all.

## M5 acceptance checks (all local)

1. Structural output contains only KN variable/list types and field names. Offline artifact has no real/fake cloud/resource binding IDs and no reachable online startup operation.
2. Six score tables retain at most ten entries each; malformed version, wrong width, nondigit fields and out-of-range scores are rejected without writes. Merge and tie results are deterministic.
3. Compact bounds: score maximum 122; each chat shard exactly 122; score record 12; chat record 30; local rich chat at most 48. Validate all chat padding/length symbols.
4. Empty lists do not enter reversed `1..0` traversal. Encoding/decoding does not lose leading zeros or split surrogate pairs.
5. Simulated concurrent stale writers demonstrate possible data loss; tests must not assert a false CAS guarantee. Retry budget terminates and corrupt packets never become destructive empty resets.
6. Unconfigured/logged-out/stalled initialization remains playable with truthful local labels. A successful local echo is not reported as an online acknowledgement.

No game code or integration tests are introduced by this document. The parent should implement the codec only after accepting these product constraints.

## Reproducible source evidence

Raw main bundle SHA-256: `456109c27830e35bd3c005512804b8bdc9ca158995a9702446b020321609236b` (5,594,360 bytes). Factory hashes below are SHA-256 of the exact UTF-8 function-expression text from each Webpack property, from its `function` token through final `}`, excluding property key/comma. Offsets are **zero-based JavaScript string offsets** into this main bundle, not promised byte offsets.

| Module | Offset | Factory SHA-256 | Key evidence |
|---|---:|---|---|
| 1892 | 1737108 | `be3159fb4af458aaf383dd8e31cc7dbd6dcbbe80115561c2c301701a82cb1e08` | Variable/list enums; ranking cap `yp=4` |
| 88106 | 1910164 | `a45520b571aff49da80fef83507041f4b05864909b896f2adc5dd6f64142132d` | Public variable creation cap `Ci=10` |
| 69138 | 5321680 | `d47842a359d971c1cc711c8b9c4df77746fbd5b2ba78b745ba4105bf6be68dbb` | Cloud store; conflicting 20 counter clamp |
| 93454 | 360760 | `b12a06518d2db667bed11c4467ddf2f470c9d35db00c413fa941978cda3d8e40` | Socket event names, set/inc, 100ms batch |
| 18027 | 356851 | `4905957f21abaff9b7c20cfd5970088c3e2441e957953b04fe48791ab91324f7` | `enQueue/deQueue/clearQueue` |
| 11004 | 1915317 | `4955c7897d43b5933ba90e18130adcd66533fd6066086f4403e6f42c4f96288a` | Socket/init/fallback; public metadata creation |
| 40283 | 1825509 | `577d0f6cb5ff41fdc93f0cc476aaafebbdc7bb603337f43ef570d5c17439ef45` | `initRuntimeCloudData` login/preview gates before connection |
| 46501 | 1583958 | `c3ab242c18ec17966b6fd768e8c6bd71a38ad582310f9720ce70992ff01eccc2` | Runtime domains, 128 slice, identity, ranking pacing |
| 40742 | 1036560 | `dd6fd240940423c72ef7b3edc0e16eed6525b3316b24524f77dadc4346e605e6` | KN block definitions/fields/inputs |
| 26912 | 961344 | `6a836070c715d28c254c628182e3815ff7b491ececa34ca7e50db1c483327060` | Native type names |
| 78798 | 357688 | `703973ce4eba045bb030a1d782d851a42500deae453e70e2551d41e5a7daf2c6` | Cloud add/list/delete/sync and error mappings |
| 56609 | 5450806 | `2a7eac10b0ddc2ef32726a1ed9e96db9c47ab7e80c9a88e018fb332fb8222b86` | Provisioning login/work-save requirements |
| 82277 | 1935934 | `50343cceed6f4fba22e7f6b1bdc90aeda794299a3616487f136e22ad290bf2f9` | Disabled-edit/file/preview/history gates |
| 39942 | 209541 | `26a56ad7637e5b304d62bbb8078725b99e475d60a590f135e7e3990446b6812c` | Login status helper |
| 87123 | 708706 | `e039622b78c4c508c6068044800c8e63e6aabfe051159d7921069390cd9acab2` | Variable factory metadata |
| 91107 | 734462 | `e73bbdcfbdc3cccf5186fbb292b36b9a9b4a9c36e598257982685f3a85802127` | BCM metadata dictionary paths |
| 51395 | 1788991 | `de876d7dfb21cf2cccfd3d48dcc1a1e592c9d76e8023682d825aa2118aefc8cd` | Ranking creation guards/metadata |
| 92943 | 392022 | `650d8eed3f80f1d6d4d2bec9008927ed2fd986528733956b722e8d17b513ed5d` | Ranking record shape and server-resource mapping |
| 68602 | 119581 | `085b12a50efaa4c6cc67f5b02d802de67f63d50564eff1877e1eb229ce297f04` | Logged-out load warning detection |

Readable cache cross-references: `pretty-46501.js` lines **305–386**, **994–1067**, **1221–1260**, **1812–2044**; `pretty-68602.js` lines **182–203**; `pretty-17028.js` lines **1684–1702**. Pretty-file SHA-256: `pretty-46501.js` = `fa54ee5ae71c82d351da85d79ec0688e0fc60c47761522bd15770fe6c3c08747`; `pretty-68602.js` = `9a52e2620bbd67494b83369cb8e4ecb5d184353ebca51e220d2e219960630056`.

All endpoint strings encountered are source evidence only. No endpoint was contacted, no token was read, and no official source factory was executed.
