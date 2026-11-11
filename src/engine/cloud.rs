//! K4 cloud domain: independent implementation based on the official TL4g
//! module (R, K.update_list_by_action, ct); evidence: docs/kitten4-cloud.md.
use super::{Cell, Engine, Target};
use crate::cloud::{CloudBackend, CloudKey};
use anyhow::{Result, ensure};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug)]
pub(super) struct Binding {
    pub id: String,
    pub remote: String,
    pub private: bool,
    pub list: bool,
}
#[derive(Default)]
pub(super) struct State {
    pub ranking: Option<usize>,
    backend: Option<Arc<dyn CloudBackend>>,
    namespace: String,
    user: String,
    saved: Vec<Value>,
}

fn limit(value: Cell, max: usize) -> Option<Cell> {
    match value {
        Cell::Number(_) => Some(value),
        Cell::Text(text) => {
            // JS String.slice counts UTF-16 units. Unpaired surrogates use the
            // VM's existing replacement-character representation.
            let units: Vec<_> = text.encode_utf16().take(max).collect();
            Some(Cell::Text(String::from_utf16_lossy(&units).into()))
        }
        _ => None,
    }
}
fn add(a: &Cell, b: &Cell) -> Cell {
    // JS + first converts arrays/objects to primitives. In particular an empty
    // cloud-list reporter is "", not numeric NaN (12 + [] is "12"). Keep this
    // conversion local: ordinary VM arithmetic has a different contract.
    let primitive = |v: &Cell| match v {
        Cell::List(_) | Cell::Costume(_) | Cell::Object(_) | Cell::Midi(_) => {
            Cell::Text(v.text().into())
        }
        _ => v.clone(),
    };
    let a = primitive(a);
    let b = primitive(b);
    if matches!(a, Cell::Text(_)) || matches!(b, Cell::Text(_)) {
        let text = |v: &Cell| {
            if matches!(v, Cell::Null) {
                "null".into()
            } else {
                v.text()
            }
        };
        Cell::Text(format!("{}{}", text(&a), text(&b)).into())
    } else {
        Cell::Number(a.number() + b.number())
    }
}

fn js_number(value: &Cell) -> f64 {
    match value {
        Cell::List(_) => crate::js_number::parse(&value.text()),
        _ => value.number(),
    }
}

impl Engine {
    pub(super) fn cloud_restart_values(&self) -> Vec<Cell> {
        if self.cloud.backend.is_some() {
            self.capture_cloud()
        } else {
            vec![]
        }
    }
    /// Explicit local profile. Does not imply official authentication. Call before
    /// start(); absent backend entries retain the official anonymous defaults.
    pub fn set_cloud_backend(
        &mut self,
        backend: Arc<dyn CloudBackend>,
        namespace: String,
        user: String,
    ) -> Result<()> {
        ensure!(
            !namespace.is_empty(),
            "local cloud namespace must not be empty"
        );
        let mut loaded = Vec::new();
        for binding in &self.program.cloud {
            let key = CloudKey {
                project: namespace.clone(),
                variable: binding.remote.clone(),
                user: binding.private.then(|| user.clone()),
            };
            let value = backend.load(&key)?;
            if let Some(value) = &value {
                ensure!(
                    if binding.list {
                        value.as_array().is_some_and(|a| {
                            a.iter()
                                .all(|v| v.is_number() || v.is_string() || v.is_null())
                        })
                    } else {
                        value.is_number() || value.is_string() || value.is_null()
                    },
                    "invalid local cloud value for {}",
                    binding.id
                );
            }
            loaded.push(value);
        }
        for (index, value) in loaded.into_iter().enumerate() {
            if let Some(value) = value {
                let binding = &self.program.cloud[index];
                let cell = if value.is_null() {
                    Cell::Number(f64::NAN)
                } else if binding.list {
                    let cells = value
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|v| {
                            if v.is_null() {
                                Ok(Cell::Number(f64::NAN))
                            } else {
                                Cell::from_json(v)
                            }
                        })
                        .collect::<Result<Vec<_>>>()?;
                    Cell::List(std::rc::Rc::new(std::cell::RefCell::new(cells)))
                } else {
                    Cell::from_json(&value)?
                };
                self.restore_cloud_entry(index, cell);
            } else {
                let cell = if self.program.cloud[index].list {
                    Cell::List(std::rc::Rc::new(std::cell::RefCell::new(vec![])))
                } else {
                    Cell::Number(0.0)
                };
                self.restore_cloud_entry(index, cell);
            }
        }
        self.cloud.backend = Some(backend);
        self.cloud.namespace = namespace;
        self.cloud.user = user;
        self.cloud.saved = self
            .capture_cloud()
            .iter()
            .map(|v| serde_json::to_value(v).unwrap())
            .collect();
        Ok(())
    }
    pub(super) fn capture_cloud(&self) -> Vec<Cell> {
        self.program
            .cloud
            .iter()
            .map(|b| {
                if b.list {
                    self.program
                        .list_names
                        .iter()
                        .position(|id| id == &b.id)
                        .map(|i| Cell::List(self.lists[i].clone()).deep_clone())
                        .unwrap_or(Cell::Null)
                } else {
                    self.program
                        .variable_names
                        .iter()
                        .position(|id| id == &b.id)
                        .map(|i| self.global_value(i).deep_clone())
                        .unwrap_or(Cell::Null)
                }
            })
            .collect()
    }
    fn restore_cloud_entry(&mut self, index: usize, cell: Cell) {
        let binding = &self.program.cloud[index];
        if binding.list {
            if let Some(i) = self
                .program
                .list_names
                .iter()
                .position(|id| id == &binding.id)
                && let Cell::List(list) = cell
            {
                self.lists[i] = list;
            }
        } else if let Some(i) = self
            .program
            .variable_names
            .iter()
            .position(|id| id == &binding.id)
        {
            self.assign(Target::Global(i), cell);
        }
    }
    pub(super) fn restore_cloud(&mut self, cells: Vec<Cell>) {
        for (i, cell) in cells.into_iter().enumerate() {
            self.restore_cloud_entry(i, cell);
        }
    }
    pub(super) fn flush_cloud(&mut self) -> Result<()> {
        let Some(backend) = &self.cloud.backend else {
            return Ok(());
        };
        for (i, cell) in self.capture_cloud().iter().enumerate() {
            let value = serde_json::to_value(cell)?;
            if self.cloud.saved.get(i) == Some(&value) {
                continue;
            }
            let b = &self.program.cloud[i];
            backend.store(
                &CloudKey {
                    project: self.cloud.namespace.clone(),
                    variable: b.remote.clone(),
                    user: b.private.then(|| self.cloud.user.clone()),
                },
                &value,
            )?;
            self.cloud.saved[i] = value;
        }
        Ok(())
    }
    pub(super) fn cloud_set(&mut self, binding: usize, value: Cell, change: bool, decrease: bool) {
        let Some(b) = self.program.cloud.get(binding) else {
            return;
        };
        let Some(slot) = self
            .program
            .variable_names
            .iter()
            .position(|id| id == &b.id)
        else {
            return;
        };
        let value = if change {
            let previous = self.global_value(slot);
            if matches!(
                previous,
                Cell::List(_) | Cell::Costume(_) | Cell::Object(_) | Cell::Midi(_)
            ) {
                return;
            }
            if decrease {
                Cell::Number(js_number(&previous) - js_number(&value))
            } else {
                add(&previous, &value)
            }
        } else {
            value
        };
        if let Some(value) = limit(value, 1024) {
            self.assign(Target::Global(slot), value);
        }
    }
    pub(super) fn cloud_list(
        &mut self,
        binding: usize,
        action: u8,
        at: Option<Cell>,
        value: Option<Cell>,
    ) {
        let Some(b) = self.program.cloud.get(binding) else {
            return;
        };
        let Some(index) = self.program.list_names.iter().position(|id| id == &b.id) else {
            return;
        };
        let at = match at {
            Some(Cell::Number(n)) if n.is_finite() && n > 0.0 => Some(n),
            None => None,
            _ => return,
        };
        let value = value.and_then(|v| limit(v, 128)).unwrap_or(Cell::Undefined);
        let mut list = self.lists[index].borrow_mut();
        let at = at
            .map(|n| n.max(1.0).trunc() as usize - 1)
            .unwrap_or_else(|| list.len().saturating_sub(1));
        // JS splice clamps positive indices to length. Unlike ordinary K4 lists,
        // out-of-range replace inserts, delete does nothing, read returns "".
        match action {
            0 => list.push(value),
            1 => list.insert(0, value),
            2 => {
                let at = at.min(list.len());
                list.insert(at, value);
            }
            3 => {
                if at < list.len() {
                    list.remove(at);
                }
            }
            4 => {
                let at = at.min(list.len());
                if at < list.len() {
                    list.remove(at);
                }
                list.insert(at, value);
            }
            5 => list.clear(),
            _ => unreachable!(),
        }
    }
}
