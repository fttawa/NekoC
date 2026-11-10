//! Detached JIT diagnostics, intentionally separate from the player wire format.
use super::{Cell, Engine};
use serde_json::{Value, json};
use std::{collections::BTreeMap, rc::Rc};

#[derive(Default)]
struct Cells {
    ids: BTreeMap<usize, usize>,
    pending: Vec<super::List>,
    costumes: BTreeMap<usize, usize>,
}

fn number(n: f64) -> Value {
    // NaN payload/sign is not observable by blocks; signed zero is observable.
    json!(if n.is_nan() {
        "NaN".to_owned()
    } else {
        format!("{:016x}", n.to_bits())
    })
}

impl Cells {
    fn cell(&mut self, cell: &Cell) -> Value {
        match cell {
            Cell::Number(n) => json!(["number", number(*n)]),
            Cell::Bool(b) => json!(["boolean", b]),
            Cell::Text(t) => json!(["text", t.as_ref()]),
            Cell::Null => json!(["null"]),
            Cell::Costume(t) => {
                let next = self.costumes.len();
                let id = *self
                    .costumes
                    .entry(Rc::as_ptr(t) as *const () as usize)
                    .or_insert(next);
                json!(["costume", id, t.as_ref()])
            }
            Cell::List(list) => {
                let address = Rc::as_ptr(list) as usize;
                let id = if let Some(&id) = self.ids.get(&address) {
                    id
                } else {
                    let id = self.pending.len();
                    self.ids.insert(address, id);
                    self.pending.push(list.clone());
                    id
                };
                json!(["list", id])
            }
        }
    }

    fn graph(&mut self) -> Vec<Value> {
        let mut graph = Vec::new();
        // Breadth-first traversal is stack-safe and preserves shared identities,
        // including cycles should a failed operation ever leave one behind.
        while graph.len() < self.pending.len() {
            let list = self.pending[graph.len()].clone();
            graph.push(Value::Array(
                list.borrow().iter().map(|c| self.cell(c)).collect(),
            ));
        }
        graph
    }
}

impl Engine {
    /// Exact typed cells/alias topology and suspended control state for local
    /// interpreter/JIT differential checks. Does not evaluate any reporter.
    pub fn jit_debug_snapshot(&self) -> Value {
        let mut cells = Cells::default();
        let globals: Vec<_> = (0..self.slots.len())
            .map(|i| cells.cell(&self.global_value(i)))
            .collect();
        let lists: Vec<_> = self
            .lists
            .iter()
            .map(|l| cells.cell(&Cell::List(l.clone())))
            .collect();
        let actors: Vec<_> = self
            .sprites
            .iter()
            .map(|s| {
                let variables: Vec<_> = s
                    .variables
                    .iter()
                    .map(|(slot, c)| json!([slot, cells.cell(c)]))
                    .collect();
                json!({"id":s.id,"alive":s.alive,"variables":variables})
            })
            .collect();
        let tasks: Vec<_> = self
            .tasks
            .iter()
            .map(|t| {
                let parameters: Vec<_> = t.parameters.iter().map(|c| cells.cell(c)).collect();
                let locals: Vec<_> = t
                    .locals
                    .iter()
                    .enumerate()
                    .map(|(i, n)| {
                        cells.cell(t.local_values[i].as_ref().unwrap_or(&Cell::Number(*n)))
                    })
                    .collect();
                let calls: Vec<_> = t
                    .calls
                    .iter()
                    .map(|c| {
                        let parameters: Vec<_> =
                            c.parameters.iter().map(|v| cells.cell(v)).collect();
                        json!({"pc":c.pc,"parameters":parameters,"loops":c.loops,"ranges":c.ranges})
                    })
                    .collect();
                let ranges: Vec<_> = t
                    .ranges
                    .iter()
                    .map(|r| json!([number(r.value), number(r.end), number(r.step)]))
                    .collect();
                let returned = t.returned.as_ref().map(|c| cells.cell(c));
                json!({"id":t.id,"actor":t.actor,"pc":t.pc,"loops":t.loops,
                    "ranges":ranges,"calls":calls,"parameters":parameters,"locals":locals,
                    "payload":cells.cell(&t.payload),"returned":returned,"done":t.done,
                    "wake":number(t.wake),"pending":t.pending,"waiter":t.waiter,
                    "wait_started":t.wait_started,"wait_finished":t.wait_finished})
            })
            .collect();
        json!({"globals":globals,"lists":lists,"actors":actors,"tasks":tasks,
            "heap":cells.graph(),"random_state":self.random_state,"cursor":self.cursor})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cells_preserve_types_signed_zero_nonfinite_values_and_aliases() {
        let mut cells = Cells::default();
        assert_ne!(cells.cell(&Cell::Null), cells.cell(&Cell::Number(f64::NAN)));
        assert_ne!(number(0.0), number(-0.0));
        assert_ne!(number(f64::INFINITY), number(f64::NEG_INFINITY));
        let list: super::super::List = Default::default();
        list.borrow_mut().push(Cell::List(list.clone()));
        assert_eq!(cells.cell(&Cell::List(list.clone())), json!(["list", 0]));
        assert_eq!(cells.cell(&Cell::List(list.clone())), json!(["list", 0]));
        assert_eq!(cells.graph(), vec![json!([["list", 0]])]);
        list.borrow_mut().clear();
    }

    #[test]
    fn observations_are_detached_deterministic_and_keep_list_identity() {
        let project = crate::studio::document::Document::blank().value().clone();
        let mut engine = Engine::new(super::super::Program::compile(&project).unwrap());
        engine.set_random_seed(42);
        engine.start();
        let shared: super::super::List = Default::default();
        let separate: super::super::List = Default::default();
        engine.lists = vec![shared.clone(), shared];
        let before = engine.jit_debug_snapshot();
        assert_eq!(before, engine.jit_debug_snapshot());
        engine.lists[1] = separate;
        assert_ne!(before, engine.jit_debug_snapshot());
        assert_eq!(before["lists"], json!([["list", 0], ["list", 0]]));
    }
}
