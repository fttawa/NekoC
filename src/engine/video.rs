//! K4 media state. Evidence: player_v2 QqDm, wi/ki, add_playable and video domain blocks.
//! Media time is deliberately simulated, not claimed equal to HTMLMediaElement's clock.
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) enum Action {
    Play(bool),
    Resume(bool),
    Visible(bool),
}

#[derive(Clone, Debug, Serialize)]
pub struct VideoState {
    pub id: String,
    pub x: f64,
    pub y: f64,
    /// Saved K4 width/height already include scale; never multiply twice.
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub visible: bool,
    pub playing: bool,
    pub played: bool,
    pub ended: bool,
    pub position: f64,
    pub duration: Option<f64>,
    /// Play generation lets the viewer distinguish restart from resume.
    pub generation: u64,
    #[serde(skip)]
    waiters: Vec<u64>,
}

pub(super) fn initial(project: &Value) -> Vec<VideoState> {
    project
        .pointer("/videos/videosDict")
        .and_then(Value::as_object)
        .into_iter()
        .flatten()
        .map(|(id, v)| {
            let number = |key: &str, default: f64| {
                v[key].as_f64().filter(|n| n.is_finite()).unwrap_or(default)
            };
            VideoState {
                id: id.clone(),
                x: number("x", 0.0),
                y: number("y", 0.0),
                width: number("width", 320.0).max(0.0),
                height: number("height", 320.0).max(0.0),
                scale: number("scale", 1.0).max(0.0),
                visible: v["visible"].as_bool().unwrap_or(true),
                playing: false,
                played: false,
                ended: false,
                position: 0.0,
                duration: v["duration"]
                    .as_f64()
                    .filter(|n| n.is_finite() && *n >= 0.0),
                generation: 0,
                waiters: vec![],
            }
        })
        .collect()
}

impl Engine {
    /// Browser/CLI may provide decoded metadata. Unknown duration is not guessed.
    pub fn set_video_duration(&mut self, id: &str, duration: f64) {
        if !duration.is_finite() || duration < 0.0 {
            return;
        }
        for video in self
            .videos
            .iter_mut()
            .chain(self.program.videos.iter_mut())
            .filter(|v| v.id == id)
        {
            video.duration = Some(duration);
        }
    }

    pub fn set_video_metadata(&mut self, id: &str, duration: f64, width: f64, height: f64) {
        self.set_video_duration(id, duration);
        if ![width, height].iter().all(|n| n.is_finite() && *n >= 0.0) {
            return;
        }
        for video in self
            .videos
            .iter_mut()
            .chain(self.program.videos.iter_mut())
            .filter(|v| v.id == id)
        {
            video.width = width;
            video.height = height;
        }
    }

    fn release_video_waiters(&mut self, waiters: Vec<u64>) {
        for id in waiters {
            if let Some(task) = self.tasks.iter_mut().find(|t| t.id == id && !t.done) {
                task.pending = task.pending.saturating_sub(1);
            }
        }
    }

    pub(super) fn video_action(&mut self, id: &str, action: Action, task: usize) {
        let Some(v) = self.videos.iter_mut().find(|v| v.id == id) else {
            return;
        };
        let mut released = vec![];
        match action {
            Action::Play(wait) => {
                // ki.play calls the previous completion callback before replacing it.
                released = std::mem::take(&mut v.waiters);
                v.position = 0.0;
                v.playing = true;
                v.played = true;
                v.ended = false;
                v.generation = self.next_video_generation;
                self.next_video_generation += 1;
                if wait {
                    v.waiters.push(self.tasks[task].id);
                    self.tasks[task].pending += 1;
                }
            }
            Action::Resume(resume) => v.playing = resume && v.played && !v.ended,
            Action::Visible(visible) => v.visible = visible,
        }
        self.release_video_waiters(released);
    }

    pub(super) fn tick_videos(&mut self, dt: f64) {
        let mut released = vec![];
        for v in &mut self.videos {
            if !v.playing {
                continue;
            }
            v.position += dt;
            if let Some(duration) = v.duration.filter(|d| v.position + 1e-9 >= *d) {
                v.position = duration;
                v.playing = false;
                v.ended = true;
                released.append(&mut v.waiters);
            }
        }
        self.release_video_waiters(released);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn waiting() -> Engine {
        let mut p = crate::studio::document::Document::blank().value().clone();
        p["videos"] = serde_json::json!({"videosDict":{"v":{"duration":10.0}}});
        let scene = p["scenes"]["currentSceneId"].as_str().unwrap().to_owned();
        p["scenes"]["scenesDict"][scene]["nekoBlockJsonList"] = serde_json::json!([{
            "type":"on_running_group_activated","id":"start","next":{
                "type":"kitten4_play_video_until_end","id":"play","fields":{"video":"v"},"next":{
                    "type":"kitten4_show_hide_video","id":"hide","fields":{"video":"v","display":"hide"}
                }
            }
        }]);
        let mut vm = Engine::new(Program::compile(&p).unwrap());
        vm.start();
        vm.advance(0.0, 1000, Duration::from_secs(1)).unwrap();
        vm
    }

    #[test]
    fn replay_releases_old_wait_pause_hide_do_not_and_resume_keeps_time() {
        let mut vm = waiting();
        assert_eq!(vm.tasks[0].pending, 1);
        vm.tick_videos(0.25);
        vm.video_action("v", Action::Resume(false), 0);
        vm.video_action("v", Action::Visible(false), 0);
        vm.tick_videos(0.25);
        assert_eq!(vm.tasks[0].pending, 1);
        assert_eq!(vm.videos[0].position, 0.25);
        vm.video_action("v", Action::Resume(true), 0);
        vm.tick_videos(0.25);
        assert_eq!(vm.videos[0].position, 0.5);
        vm.video_action("v", Action::Play(false), 0);
        assert_eq!(vm.tasks[0].pending, 0);
        assert_eq!(vm.videos[0].position, 0.0);
        assert!(!vm.videos[0].visible);
    }

    #[test]
    fn metadata_updates_geometry_and_duration_without_guessing_unknown_end() {
        let mut vm = waiting();
        vm.videos[0].duration = None;
        vm.tick_videos(100.0);
        assert_eq!(vm.tasks[0].pending, 1);
        vm.set_video_metadata("v", 0.5, 128.0, 96.0);
        vm.tick_videos(0.0);
        assert_eq!(vm.tasks[0].pending, 0);
        assert!(vm.videos[0].ended);
        assert_eq!(vm.videos[0].width, 128.0);
        vm.video_action("v", Action::Resume(true), 0);
        assert!(!vm.videos[0].playing);
        vm.set_video_duration("v", f64::NAN);
        assert_eq!(vm.videos[0].duration, Some(0.5));
    }
}
