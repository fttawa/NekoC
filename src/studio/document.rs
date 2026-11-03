use anyhow::{Context, Result, bail, ensure};
use serde_json::{Value, json};
use std::path::Path;

/// Preserve the original JSON, including fields not yet understood by the editor.
/// Changes are committed atomically and history stores complete document states.
pub struct Document {
    value: Value,
    undo: Vec<Value>,
    redo: Vec<Value>,
    saved: Value,
    next_id: u64,
}

impl Document {
    pub fn new(value: Value) -> Result<Self> {
        ensure!(value.is_object(), "project root must be an object");
        Ok(Self {
            saved: value.clone(),
            value,
            undo: vec![],
            redo: vec![],
            next_id: 1,
        })
    }

    pub fn blank() -> Self {
        Self::new(
            serde_json::from_str(include_str!("../../samples/kitten-n-0.27.4.bcmkn")).unwrap(),
        )
        .unwrap()
    }

    pub fn value(&self) -> &Value {
        &self.value
    }
    pub fn is_dirty(&self) -> bool {
        self.value != self.saved
    }
    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }
    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    pub fn edit(&mut self, edit: impl FnOnce(&mut Value) -> Result<()>) -> Result<()> {
        let mut next = self.value.clone();
        edit(&mut next)?;
        ensure!(next.is_object(), "project root must remain an object");
        if next != self.value {
            self.undo.push(std::mem::replace(&mut self.value, next));
            if self.undo.len() > 100 {
                self.undo.remove(0);
            }
            self.redo.clear();
        }
        Ok(())
    }

    pub fn set(&mut self, pointer: &str, value: Value) -> Result<()> {
        self.edit(|root| {
            *root
                .pointer_mut(pointer)
                .with_context(|| format!("missing path: {pointer}"))? = value;
            Ok(())
        })
    }

    pub fn undo(&mut self) {
        if let Some(previous) = self.undo.pop() {
            self.redo.push(std::mem::replace(&mut self.value, previous));
        }
    }
    pub fn redo(&mut self) {
        if let Some(next) = self.redo.pop() {
            self.undo.push(std::mem::replace(&mut self.value, next));
        }
    }

    pub fn save(&mut self, path: &Path) -> Result<()> {
        let bytes = serde_json::to_vec_pretty(&self.value)?;
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
        use std::io::Write;
        temporary.write_all(&bytes)?;
        temporary.as_file().sync_all()?;
        temporary
            .persist(path)
            .with_context(|| format!("save {}", path.display()))?;
        self.saved = self.value.clone();
        Ok(())
    }

    pub fn fresh_id(&mut self) -> String {
        loop {
            let id = format!("nekoc-native-{}", self.next_id);
            self.next_id += 1;
            if !contains_id(&self.value, &id) {
                return id;
            }
        }
    }

    pub fn add_script(&mut self, owner: &str, mut block: Value) -> Result<()> {
        self.assign_ids(&mut block);
        self.edit(|root| {
            let owner = root.pointer_mut(owner).context("owner no longer exists")?;
            if owner.get("nekoBlockJsonList").is_none() {
                owner["nekoBlockJsonList"] = json!([]);
            }
            owner["nekoBlockJsonList"]
                .as_array_mut()
                .context("invalid script list")?
                .push(block);
            repair_owner(owner);
            Ok(())
        })
    }

    pub fn append(&mut self, pointer: &str, mut block: Value) -> Result<()> {
        self.assign_ids(&mut block);
        self.edit(|root| {
            let mut target = root
                .pointer_mut(pointer)
                .context("block no longer exists")?;
            while target.get("next").is_some_and(Value::is_object) {
                target = target.get_mut("next").unwrap();
            }
            ensure!(target.is_object(), "target is not a block");
            target["next"] = block;
            repair_workspace(root, pointer);
            Ok(())
        })
    }

    /// Move a connected stack after another block, preserving the target successor.
    /// Target IDs are resolved after removal, so root-array index shifts are safe.
    pub fn move_stack_after(&mut self, source: &str, target_id: &str) -> Result<()> {
        self.edit(|root| {
            let owner_path = source
                .split("/nekoBlockJsonList")
                .next()
                .context("invalid source")?;
            ensure!(
                root.pointer(owner_path)
                    .is_some_and(|owner| contains_id(owner, target_id)),
                "target must be in the same workspace"
            );
            let source_value = root.pointer(source).context("source block missing")?;
            ensure!(
                !contains_id(source_value, target_id),
                "cannot connect a stack to itself or its descendants"
            );
            let (parent_path, key) = source.rsplit_once('/').context("invalid source path")?;
            let parent = root
                .pointer_mut(parent_path)
                .context("source parent missing")?;
            let mut stack = if let Some(array) = parent.as_array_mut() {
                let index = key.parse::<usize>()?;
                ensure!(index < array.len(), "source index out of range");
                array.remove(index)
            } else {
                parent
                    .as_object_mut()
                    .context("invalid source parent")?
                    .remove(&key.replace("~1", "/").replace("~0", "~"))
                    .context("source missing")?
            };
            let target = find_block_mut(root, target_id).context("target block missing")?;
            let old_next = target
                .as_object_mut()
                .context("invalid target")?
                .remove("next");
            if let Some(next) = old_next {
                let mut tail = &mut stack;
                while tail.get("next").is_some_and(Value::is_object) {
                    tail = tail.get_mut("next").unwrap();
                }
                tail["next"] = next;
            }
            target["next"] = stack;
            repair_workspace(root, source);
            Ok(())
        })
    }

    pub fn import_style(&mut self, owner: &str, name: &str, url: &str) -> Result<String> {
        let id = self.fresh_id();
        self.edit(|root| {
            let entity = root.pointer_mut(owner).context("resource owner missing")?;
            ensure!(entity.is_object(), "invalid owner");
            if entity.get("styles").is_none() {
                entity["styles"] = json!([]);
            }
            entity["styles"]
                .as_array_mut()
                .context("invalid styles list")?
                .push(json!(id));
            entity["currentStyleId"] = json!(id);
            root["styles"]["stylesDict"][&id] =
                json!({"id":id, "name":name, "url":url, "centerPoint":{"x":0,"y":0}});
            Ok(())
        })?;
        Ok(id)
    }

    pub fn remove_block(&mut self, pointer: &str) -> Result<()> {
        self.edit(|root| {
            let (parent, key) = pointer
                .rsplit_once('/')
                .context("cannot remove project root")?;
            let parent = root.pointer_mut(parent).context("missing parent")?;
            if let Some(array) = parent.as_array_mut() {
                let index: usize = key.parse()?;
                ensure!(index < array.len(), "block index out of range");
                // Deleting a top-level stack is explicit; nested removal splices next.
                array.remove(index);
            } else if let Some(map) = parent.as_object_mut() {
                let key = key.replace("~1", "/").replace("~0", "~");
                let mut old = map.remove(&key).context("missing block")?;
                if let Some(next) = old.as_object_mut().and_then(|m| m.remove("next")) {
                    map.insert(key, next);
                }
            } else {
                bail!("invalid block parent");
            }
            repair_workspace(root, pointer);
            Ok(())
        })
    }

    pub fn add_actor(&mut self, scene_id: &str) -> Result<String> {
        let id = self.fresh_id();
        self.edit(|root| {
            let scene = root["scenes"]["scenesDict"]
                .get_mut(scene_id)
                .context("scene missing")?;
            scene["actorIds"]
                .as_array_mut()
                .context("invalid actor list")?
                .push(json!(id));
            root["actors"]["actorsDict"][&id] = json!({
                "id": id, "name": "Sprite", "position": {"x": 0, "y": 0},
                "rotation": 0, "scale": 100, "visible": true, "styles": [],
                "nekoBlockJsonList": [], "comments": {}
            });
            Ok(())
        })?;
        Ok(id)
    }

    pub fn add_scene(&mut self) -> Result<String> {
        let id = self.fresh_id();
        self.edit(|root| {
            root["scenes"]["sortList"]
                .as_array_mut()
                .context("invalid scene list")?
                .push(json!(id));
            root["scenes"]["scenesDict"][&id] = json!({
                "id": id, "name": "Background", "screenName": "Scene", "actorIds": [],
                "styles": [], "nekoBlockJsonList": [], "comments": {}
            });
            root["broadcasts"]["broadcastsDict"][&id] = json!([]);
            Ok(())
        })?;
        Ok(id)
    }

    fn assign_ids(&mut self, value: &mut Value) {
        if let Some(map) = value.as_object_mut() {
            if map.get("type").is_some_and(Value::is_string) {
                map.insert("id".into(), json!(self.fresh_id()));
            }
            for child in map.values_mut() {
                self.assign_ids(child);
            }
        } else if let Some(array) = value.as_array_mut() {
            for child in array {
                self.assign_ids(child);
            }
        }
    }
}

fn contains_id(value: &Value, id: &str) -> bool {
    match value {
        Value::Object(map) => {
            map.get("id").and_then(Value::as_str) == Some(id)
                || map.values().any(|v| contains_id(v, id))
        }
        Value::Array(array) => array.iter().any(|v| contains_id(v, id)),
        _ => false,
    }
}

fn repair_workspace(root: &mut Value, block_pointer: &str) {
    if let Some((owner, _)) = block_pointer.split_once("/nekoBlockJsonList")
        && let Some(owner) = root.pointer_mut(owner)
    {
        repair_owner(owner);
    }
}

fn repair_owner(owner: &mut Value) {
    if let Some(blocks) = owner["nekoBlockJsonList"].as_array_mut() {
        for block in blocks {
            repair_parent(block, None);
        }
    }
}

fn repair_parent(block: &mut Value, parent: Option<&str>) {
    if !block.is_object() {
        return;
    }
    block["parent_id"] = json!(parent);
    let id = block["id"].as_str().map(str::to_owned);
    for key in ["inputs", "statements"] {
        if let Some(children) = block[key].as_object_mut() {
            for child in children.values_mut() {
                repair_parent(child, id.as_deref());
            }
        }
    }
    if let Some(next) = block.get_mut("next") {
        repair_parent(next, id.as_deref());
    }
}

fn find_block_mut<'a>(value: &'a mut Value, id: &str) -> Option<&'a mut Value> {
    if value.get("id").and_then(Value::as_str) == Some(id) && value.get("type").is_some() {
        return Some(value);
    }
    match value {
        Value::Object(map) => map.values_mut().find_map(|v| find_block_mut(v, id)),
        Value::Array(array) => array.iter_mut().find_map(|v| find_block_mut(v, id)),
        _ => None,
    }
}

pub fn escape_pointer(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

pub fn palette() -> Vec<(&'static str, Value)> {
    let number = |n| json!({"type": "math_number", "fields": {"NUM": n}});
    vec![
        (
            "When started",
            json!({"type": "on_running_group_activated"}),
        ),
        (
            "When space pressed",
            json!({"type": "on_keydown", "fields": {"key": "32", "type": "down"}}),
        ),
        (
            "Move 10 steps",
            json!({"type": "self_go_forward", "inputs": {"steps": number(10)}}),
        ),
        (
            "Go to x:0 y:0",
            json!({"type": "self_move_to", "inputs": {"x": number(0), "y": number(0)}}),
        ),
        (
            "Turn 15 degrees",
            json!({"type": "self_rotate", "inputs": {"degrees": number(15)}}),
        ),
        (
            "Wait 1 second",
            json!({"type": "wait", "inputs": {"time": number(1)}}),
        ),
        (
            "Repeat 10",
            json!({"type": "repeat_n_times", "inputs": {"times": number(10)}, "statements": {"DO": {"type": "self_go_forward", "inputs": {"steps": number(10)}}}}),
        ),
        (
            "Forever",
            json!({"type": "repeat_forever", "statements": {"DO": {"type": "self_go_forward", "inputs": {"steps": number(1)}}}}),
        ),
        ("Pen down", json!({"type": "self_pen_down"})),
        ("Pen up", json!({"type": "self_pen_up"})),
        (
            "Pen color",
            json!({"type": "self_set_pen_color", "fields": {"color": "#608fee"}}),
        ),
        ("Clear drawing", json!({"type": "clear_drawing"})),
        (
            "Say hello",
            json!({"type": "self_dialog", "fields": {"type": "talk"}, "inputs": {"text": {"type": "text", "fields": {"TEXT": "Hello!"}}, "time": number(2)}}),
        ),
        (
            "Log hello",
            json!({"type": "console_log", "inputs": {"console_log": {"type": "text", "fields": {"TEXT": "Hello!"}}}}),
        ),
    ]
}
