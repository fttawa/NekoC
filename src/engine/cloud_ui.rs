//! Read-only cloud rendering payload, separate from expression/JIT contracts.
//! Official UI observations: docs/k4cloudui.md. Never issues network requests.
use super::{Cell, Engine};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Default, Serialize)]
pub struct CloudUi {
    /// Exact rows: [] and [""] must not collapse to the same newline string.
    pub lists: BTreeMap<String, Vec<String>>,
    pub ranking: Option<RankingUi>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RankingUi {
    pub variable: String,
    pub value: Option<f64>,
}

impl Engine {
    pub fn close_cloud_ranking(&mut self) {
        self.show_cloud_ranking(None, false);
    }

    pub fn cloud_ui(&self) -> CloudUi {
        let lists = self
            .program
            .cloud
            .iter()
            .filter(|b| {
                b.list
                    && self
                        .program
                        .monitor_targets
                        .iter()
                        .enumerate()
                        .any(|(i, (id, _, _))| id == &b.id && self.monitors.get(i) == Some(&true))
            })
            .filter_map(|b| {
                let i = self.program.list_names.iter().position(|id| id == &b.id)?;
                Some((
                    b.id.clone(),
                    self.lists[i].borrow().iter().map(Cell::text).collect(),
                ))
            })
            .collect();
        let ranking = self.cloud.ranking.map(|i| RankingUi {
            variable: self.program.cloud[i].id.clone(),
            value: self.cloud.ranking_value,
        });
        CloudUi { lists, ranking }
    }

    pub(super) fn show_cloud_ranking(&mut self, binding: Option<usize>, show: bool) {
        if !show {
            self.cloud.ranking = None;
            self.cloud.ranking_value = None;
        } else if let Some(i) = binding.filter(|_| self.cloud.ranking.is_none()) {
            let id = &self.program.cloud[i].id;
            self.cloud.ranking_value = match self.variable_value(id) {
                Cell::Number(n) if n.is_finite() => Some(n),
                _ => None,
            };
            self.cloud.ranking = Some(i);
        }
    }
}
