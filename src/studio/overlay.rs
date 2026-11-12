//! Detached native data widgets. No cloud connection or synthetic ranking data.
//! Style facts: official dr.generate_variable_opt/generate_list_opt (1001965 /
//! 1002430), Gn/Yn (918600), ranking component (1814500), in the external
//! player_v2.2d180c468559fbd29528.js.orig. Geometry is independently authored.
use crate::engine::{Engine, Monitor};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CloudIcon {
    Public,
    Private,
    List,
}

#[derive(Clone, Debug)]
pub struct NativeMonitor {
    pub monitor: Monitor,
    pub position: Option<[f64; 2]>,
    pub scale: f64,
    pub theme: String,
    pub prefix: String,
    pub cloud: Option<CloudIcon>,
    /// Exact rows, when available. Frame's legacy newline string is ambiguous
    /// for empty lists and items containing newlines; cloud rows bypass it.
    pub items: Option<Vec<String>>,
}

#[derive(Clone, Debug)]
pub struct NativeRanking {
    pub variable: String,
    /// Only a numeric score is shown, as in the official anonymous user row.
    pub score: Option<f64>,
}

#[derive(Clone, Debug, Default)]
pub struct NativeOverlay {
    pub monitors: Vec<NativeMonitor>,
    pub ranking: Option<NativeRanking>,
}

pub(super) struct OverlayCatalog {
    declarations: Vec<(NativeMonitor, bool)>,
}

impl OverlayCatalog {
    pub(super) fn new(project: &Value) -> Self {
        let mut declarations = Vec::new();
        if let Some(vars) = project
            .pointer("/variables/variablesDict")
            .and_then(Value::as_object)
        {
            for (id, variable) in vars {
                declarations.push((
                    widget(project, id, variable, None),
                    variable["visible"] == true,
                ));
            }
        }
        if let Some(vars) = project
            .pointer("/_nekocKitten4/source/cloud_variables")
            .and_then(Value::as_object)
        {
            for (id, variable) in vars {
                declarations.retain(|(w, _)| w.monitor.id != *id);
                declarations.push((
                    widget(project, id, variable, Some(variable)),
                    variable["visible"] == true,
                ));
            }
        }
        Self { declarations }
    }

    pub(super) fn initial(&self, engine: &Engine) -> NativeOverlay {
        NativeOverlay {
            monitors: self
                .declarations
                .iter()
                .filter(|(_, visible)| *visible)
                .map(|(widget, _)| {
                    let mut widget = widget.clone();
                    if widget.cloud.is_some() {
                        update_cloud_value(&mut widget, engine);
                    }
                    widget
                })
                .collect(),
            ranking: None,
        }
    }

    pub(super) fn frame(&self, monitors: Vec<Monitor>, engine: &Engine) -> NativeOverlay {
        let monitors = monitors
            .into_iter()
            .map(|monitor| {
                let mut widget = self
                    .declarations
                    .iter()
                    .find(|(w, _)| w.monitor.id == monitor.id)
                    .map(|(w, _)| w.clone())
                    .unwrap_or_else(|| NativeMonitor {
                        monitor: monitor.clone(),
                        position: None,
                        scale: 1.0,
                        theme: "common".into(),
                        prefix: String::new(),
                        cloud: None,
                        items: None,
                    });
                widget.monitor = monitor;
                if widget.cloud.is_some() {
                    update_cloud_value(&mut widget, engine);
                }
                widget
            })
            .collect();
        // Snapshot-only UI observation; do not advance to obtain state.
        let state = engine.cloud_ui();
        let ranking = state.ranking.map(|ranking| NativeRanking {
            variable: ranking.variable,
            score: ranking.value,
        });
        NativeOverlay { monitors, ranking }
    }
}

fn update_cloud_value(widget: &mut NativeMonitor, engine: &Engine) {
    let value = engine.variable_value(&widget.monitor.id);
    widget.monitor.value = value.text();
    if widget.monitor.list {
        widget.items = if let crate::engine::Cell::List(items) = value {
            Some(
                items
                    .borrow()
                    .iter()
                    .map(crate::engine::Cell::text)
                    .collect(),
            )
        } else {
            None
        };
    }
}

fn value_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items.iter().map(value_text).collect::<Vec<_>>().join(","),
        Value::Null => "NaN".into(),
        _ => value.to_string(),
    }
}

fn widget(project: &Value, id: &str, variable: &Value, cloud: Option<&Value>) -> NativeMonitor {
    let cloud = cloud.or_else(|| variable.get("cloud").filter(|v| v.is_object()));
    let style = cloud.unwrap_or(variable);
    let list = variable["type"] == "list" || style["type"] == "public_list";
    let position = style.get("position").and_then(|p| {
        let [x, y] = [p["x"].as_f64()?, p["y"].as_f64()?];
        (x.is_finite() && y.is_finite() && x.abs() <= 1e9 && y.abs() <= 1e9).then_some([x, y])
    });
    let owner = variable["current_entity"]
        .as_str()
        .or_else(|| variable["actorId"].as_str());
    let prefix = owner
        .and_then(|id| {
            project["actors"]["actorsDict"]
                .get(id)
                .or_else(|| project["scenes"]["scenesDict"].get(id))
        })
        .and_then(|v| v["name"].as_str())
        .map(|name| format!("{name}·"))
        .unwrap_or_default();
    NativeMonitor {
        monitor: Monitor {
            id: id.into(),
            name: variable["name"].as_str().unwrap_or(id).into(),
            list,
            value: if list {
                variable["value"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .take(100)
                            .map(value_text)
                            .collect::<Vec<_>>()
                            .join("\n")
                    })
                    .unwrap_or_default()
            } else {
                value_text(&variable["value"])
            },
        },
        position,
        scale: style["scale"]
            .as_f64()
            .filter(|v| v.is_finite() && *v >= 0.0)
            .unwrap_or(1.0)
            .min(100.0),
        theme: style["theme"].as_str().unwrap_or("").into(),
        prefix,
        cloud: cloud.map(|v| {
            if list {
                CloudIcon::List
            } else if v["type"] == "private" {
                CloudIcon::Private
            } else {
                CloudIcon::Public
            }
        }),
        items: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn cloud_metadata_uses_saved_stage_anchor_and_no_third_party_asset() {
        let project = json!({"variables":{"variablesDict":{}},"_nekocKitten4":{"source":{"cloud_variables":{
            "score":{"name":"Score","type":"private","visible":true,"theme":"common","scale":1.25,"position":{"x":-300,"y":200}},
            "items":{"name":"Items","type":"public_list","visible":false}
        }}}});
        let catalog = OverlayCatalog::new(&project);
        let (score, visible) = &catalog.declarations[0];
        assert!(*visible);
        assert_eq!(score.position, Some([-300.0, 200.0]));
        assert_eq!(score.scale, 1.25);
        assert_eq!(score.cloud, Some(CloudIcon::Private));
        assert_eq!(catalog.declarations[1].0.cloud, Some(CloudIcon::List));
        assert!(catalog.declarations[1].0.monitor.list);
    }

    #[test]
    fn malformed_geometry_and_duplicate_cloud_declarations_are_safe() {
        let project = json!({"variables":{"variablesDict":{"v":{"name":"old"}}},"_nekocKitten4":{"source":{"cloud_variables":{
            "v":{"name":"Cloud","type":"public","scale":-1,"position":{"x":"bad","y":0}}
        }}}});
        let catalog = OverlayCatalog::new(&project);
        assert_eq!(catalog.declarations.len(), 1);
        let widget = &catalog.declarations[0].0;
        assert_eq!(widget.monitor.name, "Cloud");
        assert_eq!(widget.position, None);
        assert_eq!(widget.scale, 1.0);
    }
}
