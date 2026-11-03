//! Self-extracting `.bcmkn` packing: shrinks large text lists so the project
//! file fits upload/request limits, and adds block scripts that restore the
//! lists when the project starts — in the official player, with no plugin.
//!
//! Format. Each packed list `L` gets a hidden list holding one encoded record
//! per original item. A record is tokens joined by a separator character that
//! never occurs in the data:
//! - `~text` — literal text (the prefix keeps `text_split` from turning digit
//!   runs into numbers);
//! - `!d,s,l` — copy `l` UTF-16 units starting at 1-based unit `s` of the
//!   restored item `d` positions earlier (frames of an animation are similar).
//!
//! The decoder is real Kitten N blocks (compiled once from `pack/decoder.ts`
//! by `ts/compile-ts.mjs`, stored in `pack/decoder-template.json`). It runs in
//! a warp on the initial scene's stage; every start script first waits until
//! the `ready` flag is set, so the project's own scripts see restored data.
use anyhow::{Context, Result, bail, ensure};
use serde::Serialize;
use serde_json::{Map, Value, json};
use std::collections::HashMap;

const TEMPLATE: &str = include_str!("pack/decoder-template.json");
/// Marker in every generated block id, used to find the decoder when unpacking.
const ID_PREFIX: &str = "nekoc-pack";
const HELPER_PREFIX: &str = "__nekoc_pack_";
const HASH_LEN: usize = 8;

#[derive(Clone, Debug)]
pub struct PackOptions {
    /// Only lists whose JSON is at least this large are packed.
    pub min_list_bytes: usize,
    /// Previous restored items a reference may point at.
    pub window: usize,
    /// Shortest copy (UTF-16 units) worth a reference token. Larger values make
    /// fewer tokens (faster block decoding) and a slightly larger file.
    pub min_match: usize,
}
impl Default for PackOptions {
    fn default() -> Self {
        Self {
            min_list_bytes: 64 * 1024,
            window: 8,
            min_match: 12,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct PackedList {
    pub name: String,
    pub items: usize,
    pub original_bytes: usize,
    pub packed_bytes: usize,
    pub tokens: usize,
}
#[derive(Debug, Serialize)]
pub struct PackReport {
    pub original_bytes: usize,
    pub packed_bytes: usize,
    pub lists: Vec<PackedList>,
    /// Large lists left as they were, with the reason.
    pub skipped: Vec<(String, String)>,
    pub gated_scripts: usize,
}

fn json_len(value: &Value) -> usize {
    serde_json::to_vec(value).map_or(0, |v| v.len())
}

/// Separator absent from every item: a printable ASCII character when one is
/// free (1 byte), otherwise a private-use character.
fn pick_separator(lists: &[&[String]]) -> Option<char> {
    let used = |c: char| {
        lists
            .iter()
            .any(|items| items.iter().any(|s| s.contains(c)))
    };
    "|^`@#$&*;:<>{}[]?=+_%'"
        .chars()
        .chain((0xE000u32..0xE100).filter_map(char::from_u32))
        .find(|&c| !used(c))
}

/// Encodes items into records (see the module docs). Positions are UTF-16 code
/// units, as the official runtime's `text_select` uses JavaScript substrings.
pub fn encode(
    items: &[String],
    separator: char,
    window: usize,
    min_match: usize,
) -> (Vec<String>, usize) {
    let units: Vec<Vec<u16>> = items.iter().map(|s| s.encode_utf16().collect()).collect();
    let mut records = Vec::with_capacity(items.len());
    let mut token_count = 0;
    for (i, record) in units.iter().enumerate() {
        // Hash index of the previous items' substrings.
        let mut index: HashMap<&[u16], Vec<(usize, usize)>> = HashMap::new();
        for d in 1..=window.min(i) {
            let source = &units[i - d];
            for p in 0..source.len().saturating_sub(HASH_LEN - 1) {
                let bucket = index.entry(&source[p..p + HASH_LEN]).or_default();
                if bucket.len() < 32 {
                    bucket.push((d, p));
                }
            }
        }
        // A boundary must not split a surrogate pair (literals stay valid text).
        let boundary =
            |s: &[u16], p: usize| p == 0 || p >= s.len() || !(0xDC00..0xE000).contains(&s[p]);
        let mut tokens: Vec<String> = vec![];
        let mut literal_start = 0;
        let mut p = 0;
        let flush = |tokens: &mut Vec<String>, from: usize, to: usize| {
            if from < to {
                tokens.push(format!("~{}", String::from_utf16_lossy(&record[from..to])));
            }
        };
        while p < record.len() {
            let mut best: Option<(usize, usize, usize)> = None;
            if p + HASH_LEN <= record.len() && boundary(record, p) {
                for &(d, s) in index.get(&record[p..p + HASH_LEN]).into_iter().flatten() {
                    let source = &units[i - d];
                    let mut l = HASH_LEN;
                    while p + l < record.len()
                        && s + l < source.len()
                        && record[p + l] == source[s + l]
                    {
                        l += 1;
                    }
                    // Shrink to a boundary valid in both strings.
                    while l > 0 && !(boundary(record, p + l) && boundary(source, s + l)) {
                        l -= 1;
                    }
                    if best.is_none_or(|b| l > b.2) && boundary(source, s) {
                        best = Some((d, s, l));
                    }
                }
            }
            match best {
                Some((d, s, l)) if l >= min_match.max(HASH_LEN) => {
                    flush(&mut tokens, literal_start, p);
                    tokens.push(format!("!{d},{},{l}", s + 1));
                    p += l;
                    literal_start = p;
                }
                _ => p += 1,
            }
        }
        flush(&mut tokens, literal_start, record.len());
        token_count += tokens.len();
        records.push(tokens.join(&separator.to_string()));
    }
    (records, token_count)
}

/// Reference decoder with the block decoder's semantics.
pub fn decode(records: &[String], separator: char) -> Result<Vec<String>> {
    let mut out: Vec<Vec<u16>> = Vec::with_capacity(records.len());
    for record in records {
        let mut item: Vec<u16> = vec![];
        for token in record.split(separator) {
            if let Some(reference) = token.strip_prefix('!') {
                let parts: Vec<usize> = reference
                    .split(',')
                    .map(str::parse)
                    .collect::<Result<_, _>>()
                    .with_context(|| format!("bad reference {token}"))?;
                let [d, s, l] = parts[..] else {
                    bail!("bad reference {token}");
                };
                let source = out
                    .len()
                    .checked_sub(d)
                    .and_then(|i| out.get(i))
                    .with_context(|| format!("reference {token} before the start"))?;
                let piece = source
                    .get(s - 1..s - 1 + l)
                    .with_context(|| format!("reference {token} out of range"))?;
                item.extend_from_slice(piece);
            } else if let Some(text) = token.strip_prefix('~') {
                item.extend(text.encode_utf16());
            } else if !token.is_empty() {
                bail!("bad token {token}");
            }
        }
        out.push(item);
    }
    Ok(out.iter().map(|u| String::from_utf16_lossy(u)).collect())
}

/// Clones a template block tree with fresh ids and renamed references.
struct Grafter<'a> {
    serial: usize,
    names: &'a HashMap<String, String>,
}
impl Grafter<'_> {
    fn graft(&mut self, block: &Value, parent: Option<&str>) -> Value {
        let mut ids = HashMap::new();
        let mut out = self.rename(block, &mut ids);
        if let Some(obj) = out.as_object_mut() {
            obj.insert("parent_id".into(), parent.map_or(Value::Null, |p| json!(p)));
        }
        out
    }
    fn rename(&mut self, value: &Value, ids: &mut HashMap<String, String>) -> Value {
        match value {
            Value::Object(map) => {
                let mut out = Map::new();
                if let Some(id) = map.get("id").and_then(Value::as_str) {
                    self.serial += 1;
                    let fresh = format!("{ID_PREFIX}-{}", self.serial);
                    ids.insert(id.to_owned(), fresh.clone());
                    out.insert("id".into(), json!(fresh));
                }
                for (key, v) in map {
                    match key.as_str() {
                        "id" => {}
                        "parent_id" => {
                            let mapped = v.as_str().and_then(|p| ids.get(p)).cloned();
                            out.insert(key.clone(), mapped.map_or(v.clone(), Value::String));
                        }
                        _ => {
                            out.insert(key.clone(), self.rename(v, ids));
                        }
                    }
                }
                Value::Object(out)
            }
            Value::Array(items) => {
                Value::Array(items.iter().map(|v| self.rename(v, ids)).collect())
            }
            Value::String(s) => {
                Value::String(self.names.get(s).cloned().unwrap_or_else(|| s.clone()))
            }
            other => other.clone(),
        }
    }
}

/// The last block of a `next` chain.
fn chain_tail(block: &mut Value) -> &mut Value {
    if block.get("next").is_some_and(Value::is_object) {
        chain_tail(block.get_mut("next").unwrap())
    } else {
        block
    }
}

fn is_start_hat(block: &Value) -> bool {
    matches!(
        block["type"].as_str(),
        Some("on_running_group_activated" | "start_on_click")
    )
}
fn script_owners(project: &mut Value) -> Vec<&mut Value> {
    let mut owners = vec![];
    if let Some(actors) = project
        .pointer_mut("/actors/actorsDict")
        .and_then(Value::as_object_mut)
    {
        owners.extend(actors.values_mut());
    }
    owners
}

pub fn is_packed(project: &Value) -> bool {
    project["variables"]["variablesDict"]
        .as_object()
        .is_some_and(|vars| vars.keys().any(|k| k.starts_with(ID_PREFIX)))
}

/// Packs a `.bcmkn` project value. Fails if the project is already packed.
pub fn pack(project: &Value, options: &PackOptions) -> Result<(Value, PackReport)> {
    ensure!(!is_packed(project), "project is already packed");
    let template: Value = serde_json::from_str(TEMPLATE).context("decoder template")?;
    let mut project = project.clone();
    let original_bytes = json_len(&project);
    let scene_id = project["scenes"]["currentSceneId"]
        .as_str()
        .context("project has no current scene")?
        .to_owned();
    ensure!(
        project["scenes"]["scenesDict"][&scene_id].is_object(),
        "current scene missing"
    );

    // Candidate lists: global, all-text items, large enough.
    let vars = project["variables"]["variablesDict"]
        .as_object()
        .context("project has no variables")?;
    let mut candidates: Vec<(String, String, Vec<String>)> = vec![];
    let mut skipped = vec![];
    for (id, var) in vars {
        if var["type"] != "list" || json_len(&var["value"]) < options.min_list_bytes {
            continue;
        }
        let name = var["name"].as_str().unwrap_or(id).to_owned();
        if var["isGlobal"] == false {
            skipped.push((name, "not a global list".into()));
            continue;
        }
        let Some(items) = var["value"].as_array().and_then(|a| {
            a.iter()
                .map(|v| v.as_str().map(str::to_owned))
                .collect::<Option<Vec<_>>>()
        }) else {
            skipped.push((name, "items are not all text".into()));
            continue;
        };
        candidates.push((id.clone(), name, items));
    }
    let all: Vec<&[String]> = candidates
        .iter()
        .map(|(_, _, items)| items.as_slice())
        .collect();
    let separator = pick_separator(&all).context("no free separator character")?;

    let mut lists = vec![];
    let mut packed: Vec<(String, String, Vec<String>)> = vec![];
    for (id, name, items) in candidates {
        let (records, tokens) = encode(&items, separator, options.window, options.min_match);
        ensure!(
            decode(&records, separator)? == items,
            "self-check failed for list {name}"
        );
        let original = json_len(&json!(items));
        let size = json_len(&json!(records));
        if size * 10 > original * 9 {
            skipped.push((name, "does not compress".into()));
            continue;
        }
        lists.push(PackedList {
            name: name.clone(),
            items: items.len(),
            original_bytes: original,
            packed_bytes: size,
            tokens,
        });
        packed.push((id, name, records));
    }
    if packed.is_empty() {
        let packed_bytes = json_len(&project);
        return Ok((
            project,
            PackReport {
                original_bytes,
                packed_bytes,
                lists,
                skipped,
                gated_scripts: 0,
            },
        ));
    }

    // Helper variables and the packed lists.
    let mut names: HashMap<String, String> = HashMap::new();
    names.insert("SEPCHAR".into(), separator.to_string());
    let vars = project["variables"]["variablesDict"]
        .as_object_mut()
        .unwrap();
    for helper in template["variables"].as_array().into_iter().flatten() {
        let old_id = helper["id"].as_str().unwrap_or_default().to_owned();
        let name = helper["name"].as_str().unwrap_or_default();
        let new_id = format!("{ID_PREFIX}-{name}");
        let mut entry = helper.clone();
        entry["id"] = json!(new_id);
        entry["name"] = json!(format!("{HELPER_PREFIX}{name}"));
        vars.insert(new_id.clone(), entry);
        names.insert(old_id, new_id);
    }
    let list_template = template["variables"]
        .as_array()
        .and_then(|v| v.iter().find(|h| h["type"] == "list"))
        .cloned()
        .context("template list")?;
    for (index, (id, name, records)) in packed.iter().enumerate() {
        let packed_id = format!("{ID_PREFIX}-list-{index}");
        let mut entry = list_template.clone();
        entry["id"] = json!(packed_id);
        entry["name"] = json!(format!("{HELPER_PREFIX}{name}"));
        entry["value"] = json!(records);
        entry["visible"] = json!(false);
        vars.insert(packed_id, entry);
        vars[id]["value"] = json!([]);
    }

    // Decoder: hat -> warp { per list: restore loop } -> ready = 1.
    let mut grafter = Grafter {
        serial: 0,
        names: &names,
    };
    let decoder_template = &template["decoder"];
    let mut decoder = grafter.graft(decoder_template, None);
    let loop_template = decoder_template["next"]["statements"]["DO"].clone();
    let warp_id = decoder["next"]["id"].as_str().unwrap().to_owned();
    let mut body: Option<Value> = None;
    for (index, (id, _, _)) in packed.iter().enumerate() {
        let mut list_names = names.clone();
        list_names.insert("kn-list-ZSRC".into(), format!("{ID_PREFIX}-list-{index}"));
        list_names.insert("kn-list-ZDST".into(), id.clone());
        let mut list_grafter = Grafter {
            serial: grafter.serial,
            names: &list_names,
        };
        match body.as_mut() {
            None => body = Some(list_grafter.graft(&loop_template, Some(&warp_id))),
            Some(chain) => {
                let tail = chain_tail(chain);
                let tail_id = tail["id"].as_str().unwrap().to_owned();
                tail["next"] = list_grafter.graft(&loop_template, Some(&tail_id));
            }
        }
        grafter.serial = list_grafter.serial;
    }
    decoder["next"]["statements"]["DO"] = body.unwrap();
    decoder["location"] = json!([-600, -400]);
    project["scenes"]["scenesDict"][&scene_id]["nekoBlockJsonList"]
        .as_array_mut()
        .context("scene scripts")?
        .insert(0, decoder);

    // Gate every start script on the ready flag.
    let gate_template = template["gate"].clone();
    let mut gated = 0;
    let mut gate = |script: &mut Value, grafter: &mut Grafter| {
        if !is_start_hat(script) {
            return;
        }
        let hat_id = script["id"].as_str().unwrap_or_default().to_owned();
        let mut gate = grafter.graft(&gate_template, Some(&hat_id));
        if let Some(mut next) = script.get("next").filter(|n| n.is_object()).cloned() {
            next["parent_id"] = gate["id"].clone();
            gate["next"] = next;
        }
        script["next"] = gate;
        gated += 1;
    };
    let mut scenes: Vec<String> = project["scenes"]["scenesDict"]
        .as_object()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    scenes.sort();
    for scene in &scenes {
        let scripts = project["scenes"]["scenesDict"][scene]["nekoBlockJsonList"].as_array_mut();
        for (i, script) in scripts.into_iter().flatten().enumerate() {
            // The decoder itself (first script of the initial scene) is not gated.
            if !(scene == &scene_id && i == 0) {
                gate(script, &mut grafter);
            }
        }
    }
    for owner in script_owners(&mut project) {
        for script in owner["nekoBlockJsonList"]
            .as_array_mut()
            .into_iter()
            .flatten()
        {
            gate(script, &mut grafter);
        }
    }

    let packed_bytes = json_len(&project);
    Ok((
        project,
        PackReport {
            original_bytes,
            packed_bytes,
            lists,
            skipped,
            gated_scripts: gated,
        },
    ))
}

/// Restores a packed project: lists decoded, decoder, gates and helpers removed.
pub fn unpack(project: &Value) -> Result<Value> {
    ensure!(is_packed(project), "project is not packed");
    let mut project = project.clone();
    let scene_id = project["scenes"]["currentSceneId"]
        .as_str()
        .unwrap_or_default()
        .to_owned();
    // The decoder names the restored list for each packed list.
    let decoder = project["scenes"]["scenesDict"][&scene_id]["nekoBlockJsonList"]
        .as_array()
        .and_then(|s| s.first())
        .cloned()
        .context("decoder script missing")?;
    let separator = project["variables"]["variablesDict"]
        .as_object()
        .and_then(|_| find_separator(&decoder))
        .context("decoder separator missing")?;
    // Packed lists are named `<prefix><restored list name>`.
    let vars = project["variables"]["variablesDict"]
        .as_object()
        .context("variables")?;
    let mut pairs = vec![];
    for (id, var) in vars {
        let Some(name) = var["name"]
            .as_str()
            .and_then(|n| n.strip_prefix(HELPER_PREFIX))
        else {
            continue;
        };
        if !(id.starts_with(ID_PREFIX) && var["type"] == "list") {
            continue;
        }
        if let Some((target, _)) = vars
            .iter()
            .find(|(k, v)| !k.starts_with(ID_PREFIX) && v["type"] == "list" && v["name"] == name)
        {
            pairs.push((id.clone(), target.clone()));
        }
    }
    for (packed, target) in pairs {
        let records: Vec<String> = project["variables"]["variablesDict"][&packed]["value"]
            .as_array()
            .context("packed list missing")?
            .iter()
            .map(|v| v.as_str().unwrap_or_default().to_owned())
            .collect();
        project["variables"]["variablesDict"][&target]["value"] =
            json!(decode(&records, separator)?);
    }
    project["variables"]["variablesDict"]
        .as_object_mut()
        .unwrap()
        .retain(|k, _| !k.starts_with(ID_PREFIX));
    project["scenes"]["scenesDict"][&scene_id]["nekoBlockJsonList"]
        .as_array_mut()
        .unwrap()
        .remove(0);
    let ungate = |script: &mut Value| {
        let is_gate = script["next"]["id"]
            .as_str()
            .is_some_and(|id| id.starts_with(ID_PREFIX));
        if is_start_hat(script) && is_gate {
            let hat_id = script["id"].clone();
            match script["next"]
                .get("next")
                .filter(|n| n.is_object())
                .cloned()
            {
                Some(mut next) => {
                    next["parent_id"] = hat_id;
                    script["next"] = next;
                }
                None => {
                    script.as_object_mut().unwrap().remove("next");
                }
            }
        }
    };
    if let Some(scenes) = project
        .pointer_mut("/scenes/scenesDict")
        .and_then(Value::as_object_mut)
    {
        for scene in scenes.values_mut() {
            for script in scene["nekoBlockJsonList"]
                .as_array_mut()
                .into_iter()
                .flatten()
            {
                ungate(script);
            }
        }
    }
    for owner in script_owners(&mut project) {
        for script in owner["nekoBlockJsonList"]
            .as_array_mut()
            .into_iter()
            .flatten()
        {
            ungate(script);
        }
    }
    Ok(project)
}

fn find_separator(block: &Value) -> Option<char> {
    match block {
        Value::Object(map) => {
            if map.get("type").and_then(Value::as_str) == Some("text_split")
                && let Some(text) = map["inputs"]["SPLIT_TEXT"]["fields"]["TEXT"].as_str()
                && text != ","
            {
                return text.chars().next();
            }
            map.values().find_map(find_separator)
        }
        Value::Array(items) => items.iter().find_map(find_separator),
        _ => None,
    }
}
