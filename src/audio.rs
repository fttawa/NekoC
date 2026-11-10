//! Resource state and a deterministic, network-free audio clock for headless VMs.
//! Official source locations and the browser/CLI boundary: docs/audio.md.
use crate::engine::Cell;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub(crate) struct Resource {
    id: String,
    name: String,
    duration: Option<f64>,
    volume: f64,
    rate: f64,
}

#[derive(Default)]
pub(crate) struct State {
    pub browser: bool,
    resources: Vec<Resource>,
    // Every play has its own position; K4 Howl.play() does not restart older plays.
    playing: BTreeMap<u64, (String, f64)>,
}

impl State {
    pub fn resources(project: &Value) -> Vec<Resource> {
        let audios = &project["audios"];
        let dict = &audios["audiosDict"];
        let order = audios["sortList"]
            .as_array()
            .or_else(|| audios["audioIds"].as_array());
        let ids: Vec<_> = order.map_or_else(
            || {
                dict.as_object()
                    .map(|d| d.keys().cloned().collect())
                    .unwrap_or_default()
            },
            |list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            },
        );
        ids.into_iter()
            .filter_map(|id| {
                let value = dict.get(&id)?;
                let duration = value["duration"]
                    .as_f64()
                    .filter(|n| n.is_finite() && *n >= 0.0)
                    .or_else(|| {
                        wav_duration(
                            value["url"]
                                .as_str()
                                .or_else(|| value["cdn_url"].as_str())
                                .unwrap_or_default(),
                        )
                    });
                Some(Resource {
                    id,
                    name: value["name"].as_str().unwrap_or_default().into(),
                    duration,
                    volume: finite(&value["volume"], 1.0).clamp(0.0, 1.0),
                    rate: finite(&value["playback_rate"], 1.0).clamp(0.05, 4.0),
                })
            })
            .collect()
    }

    pub fn reset(&mut self, resources: &[Resource]) {
        self.resources = resources.to_vec();
        self.playing.clear();
    }

    fn targets(&self, value: &Cell) -> Vec<usize> {
        match value {
            Cell::Number(n) if n.is_finite() => {
                let index = (n + 0.5).floor() - 1.0;
                if index >= 0.0 && index < self.resources.len() as f64 {
                    vec![index as usize]
                } else {
                    vec![]
                }
            }
            Cell::Text(s) if matches!(s.as_ref(), "all" | "--all--") => {
                (0..self.resources.len()).collect()
            }
            Cell::Text(s) => self
                .resources
                .iter()
                .position(|r| r.id == s.as_ref())
                .or_else(|| self.resources.iter().position(|r| r.name == s.as_ref()))
                .into_iter()
                .collect(),
            _ => vec![],
        }
    }

    pub fn play(&mut self, value: &Cell, id: u64) -> bool {
        if let Some(i) = self.targets(value).first() {
            let r = &self.resources[*i];
            self.playing
                .insert(id, (r.id.clone(), r.duration.unwrap_or(0.0)));
            r.duration.is_some()
        } else {
            // Missing/undecodable headless resources complete next tick, not forever.
            self.playing.insert(id, (String::new(), 0.0));
            false
        }
    }

    pub fn stop(&mut self, value: &Cell) -> Vec<u64> {
        let targets: Vec<_> = self
            .targets(value)
            .iter()
            .map(|&i| self.resources[i].id.clone())
            .collect();
        let all =
            matches!(value, Cell::Text(s) if matches!(s.as_ref(), "all" | "--all--" | "all_audio"));
        let ids = self
            .playing
            .iter()
            .filter(|(_, (id, _))| all || targets.contains(id))
            .map(|(&id, _)| id)
            .collect::<Vec<_>>();
        for id in &ids {
            self.playing.remove(id);
        }
        ids
    }

    pub fn property(&mut self, target: &Cell, rate: bool, change: bool, value: f64) {
        for i in self.targets(target) {
            let r = &mut self.resources[i];
            let slot = if rate { &mut r.rate } else { &mut r.volume };
            *slot = (if change { *slot + value } else { value })
                .clamp(if rate { 0.05 } else { 0.0 }, if rate { 4.0 } else { 1.0 });
        }
    }

    pub fn tick(&mut self, dt: f64) -> Vec<u64> {
        if self.browser {
            return vec![];
        }
        let mut done = vec![];
        for (&id, (sound, remaining)) in &mut self.playing {
            let rate = self
                .resources
                .iter()
                .find(|r| r.id == *sound)
                .map_or(1.0, |r| r.rate);
            *remaining -= dt * rate;
            if *remaining <= 1e-9 {
                done.push(id);
            }
        }
        for id in &done {
            self.playing.remove(id);
        }
        done
    }

    pub fn finished(&mut self, id: u64) {
        self.playing.remove(&id);
    }
    pub fn cancel(&mut self, id: u64) -> Option<Cell> {
        self.playing
            .remove(&id)
            .map(|(sound, _)| Cell::Text(sound.into()))
    }
}

fn finite(value: &Value, default: f64) -> f64 {
    value.as_f64().filter(|n| n.is_finite()).unwrap_or(default)
}

// Small RIFF reader: inline PCM fixtures need neither a decoder nor network I/O.
fn wav_duration(url: &str) -> Option<f64> {
    let data = url.strip_prefix("data:audio/wav;base64,")?;
    let mut bytes = vec![];
    let mut bits = 0u32;
    let mut count = 0;
    for c in data.bytes().take_while(|&c| c != b'=') {
        let n = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        bits = (bits << 6) | n as u32;
        count += 6;
        if count >= 8 {
            count -= 8;
            bytes.push((bits >> count) as u8);
        }
    }
    if bytes.get(..4)? != b"RIFF" || bytes.get(8..12)? != b"WAVE" {
        return None;
    }
    let mut at = 12usize;
    let mut byte_rate = None;
    let mut data_len = None;
    while at.checked_add(8)? <= bytes.len() {
        let len = u32::from_le_bytes(bytes.get(at + 4..at + 8)?.try_into().ok()?) as usize;
        let start = at + 8;
        let end = start.checked_add(len)?;
        let chunk = bytes.get(start..end)?;
        match &bytes[at..at + 4] {
            b"fmt " => byte_rate = Some(u32::from_le_bytes(chunk.get(8..12)?.try_into().ok()?)),
            b"data" => data_len = Some(len),
            _ => {}
        }
        at = end.checked_add(len % 2)?;
    }
    let rate = byte_rate?;
    (rate > 0).then(|| data_len.unwrap_or(0) as f64 / rate as f64)
}
