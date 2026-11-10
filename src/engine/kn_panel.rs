//! KN panel services with an explicit offline transport and host effect boundary.
//! Official source locations and the limits of this profile: docs/kn-panel-services.md.
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) enum Command {
    Translate(usize, usize),
    Ranking,
    GlobalAnimation(usize),
    CaptureAlpha(usize),
    CaptureClose,
    Recognize(kn_capture::Language),
    AiRejected(kn_ai::RejectedCommand, Option<usize>),
}

#[derive(Clone, Copy, Debug)]
pub(super) enum Reporter {
    Translate(usize, usize),
    Ranking(Option<usize>),
    Classifier(Option<usize>, bool),
}

impl Reporter {
    pub(super) fn children(self) -> Vec<usize> {
        match self {
            Self::Translate(a, b) => vec![a, b],
            Self::Ranking(i) => i.into_iter().collect(),
            Self::Classifier(i, _) => i.into_iter().collect(),
        }
    }
}

/// An effect is not complete until the host acknowledges it. No official SVGA
/// or audio assets are bundled, and headless execution does not invent a duration.
#[derive(Clone, Debug, Serialize)]
pub struct GlobalAnimationRequest {
    pub id: u64,
    pub actor: String,
    pub animation: String,
    #[serde(skip)]
    task: u64,
}

/// Recoverable official warning/UI requests; hosts may display these without
/// treating a missing login as recognized text or a successful device operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PanelNotice {
    IgnoredCameraAlpha,
    RecognitionLoginRequired,
    RecordingBusy,
    AiOffline,
    AiLoginRequired,
    AiMissingModel,
    AiInvalidIndex,
}

#[derive(Default)]
pub(super) struct State {
    serial: u64,
    effects: Vec<GlobalAnimationRequest>,
    capture: kn_capture::OfflineCapture,
    notices: Vec<PanelNotice>,
    offline_anonymous: bool,
}

impl State {
    pub(super) fn reset(&mut self) {
        self.effects.clear();
        self.capture = kn_capture::OfflineCapture::default();
        self.notices.clear();
    }
}

impl Compiler {
    fn kn_panel_arg(&mut self, b: &Value, name: &str) -> Result<usize> {
        if let Some(value) = b["inputs"].get(name) {
            self.value(value)
        } else if let Some(value) = b["fields"].get(name) {
            Ok(self.push_constant(Cell::from_json(value)?))
        } else {
            bail!("missing KN panel argument {name} at {}", b["id"])
        }
    }

    pub(super) fn kn_panel_command(&mut self, b: &Value) -> Result<Command> {
        Ok(match b["type"].as_str().unwrap_or("") {
            "translate" => Command::Translate(
                self.kn_panel_arg(b, "text")?,
                self.kn_panel_arg(b, "language")?,
            ),
            // This VM runs local, unpublished works with no KN ranking backend.
            // Official early-return branches do not read the selected variable.
            "show_hide_ranking" | "update_ranking" => Command::Ranking,
            "global_animation" => Command::GlobalAnimation(self.kn_panel_arg(b, "animation")?),
            "set_camera_alpha" | "set_webcam_alpha" => {
                debug_assert_eq!(
                    kn_capture::block(b["type"].as_str().unwrap()),
                    Some(kn_capture::Block::CameraAlpha)
                );
                Command::CaptureAlpha(self.kn_panel_arg(b, "camera_alpha")?)
            }
            "open_hide_camera" | "open_close_webcam" => {
                ensure!(
                    kn_capture::CameraSwitch::parse(field(b, "camera_status"))
                        == Some(kn_capture::CameraSwitch::Off),
                    "KN camera turn_on requires a camera backend"
                );
                Command::CaptureClose
            }
            "voice_recognition" => Command::Recognize(
                kn_capture::Language::parse(field(b, "type"))
                    .context("unsupported KN recognition language")?,
            ),
            "ai_chat_ask"
            | "new_conversation"
            | "set_system_preset"
            | "ai_text_actor"
            | "ai_text_photo"
            | "enable_face_detect_by_actor"
            | "enable_face_detect_by_photo"
            | "enable_object_detect_by_actor"
            | "enable_object_detect_by_photo"
            | "evaluate_actor_style"
            | "evaluate_camera"
            | "evaluate_photo" => {
                let rejected = kn_ai::command(
                    kn_ai::Profile::OfflineAnonymous,
                    b["type"].as_str().unwrap(),
                    field(b, "model_id"),
                )
                .context("unsupported KN AI command")?;
                let argument = rejected
                    .value_socket
                    .map(|name| self.kn_panel_arg(b, name))
                    .transpose()?;
                Command::AiRejected(rejected, argument)
            }
            kind => bail!("unsupported KN panel command {kind}"),
        })
    }

    pub(super) fn kn_panel_reporter(&mut self, b: &Value) -> Result<Reporter> {
        Ok(match b["type"].as_str().unwrap_or("") {
            "translate_result" => Reporter::Translate(
                self.kn_panel_arg(b, "text")?,
                self.kn_panel_arg(b, "language")?,
            ),
            "user_ranking_info" => Reporter::Ranking(None),
            "user_info_of_th" => Reporter::Ranking(Some(self.kn_panel_arg(b, "order")?)),
            "get_evaluate_class_name" | "get_evaluate_class_accuracy" => {
                debug_assert!(
                    kn_ai::classifier_reporter(
                        kn_ai::Profile::OfflineAnonymous,
                        b["type"].as_str().unwrap()
                    )
                    .is_some()
                );
                Reporter::Classifier(
                    b["inputs"]
                        .get("index")
                        .map(|v| self.value(v))
                        .transpose()?,
                    field(b, "model_id") == "?",
                )
            }
            kind => bail!("unsupported KN panel reporter {kind}"),
        })
    }
}

impl Engine {
    pub(super) fn eval_kn_panel(&mut self, reporter: Reporter, actor: usize) -> Cell {
        match reporter {
            Reporter::Translate(text, language) => {
                let text = self.eval_value(text, actor);
                let _ = self.eval_value(language, actor);
                if matches!(text, Cell::Null | Cell::Undefined) {
                    self.value_error =
                        Some("KN translation text.toString cannot read null/undefined".into());
                }
                // Official blank text OR a caught HTTP transport failure gives
                // empty text, NOT the original text (K4 has different semantics).
                Cell::Text("".into())
            }
            Reporter::Ranking(order) => {
                if let Some(order) = order {
                    let _ = self.eval_value(order, actor);
                }
                Cell::Number(f64::NAN)
            }
            Reporter::Classifier(index, missing_model) => {
                let index = index
                    .map(|i| self.eval_value(i, actor))
                    .unwrap_or(Cell::Number(1.0));
                if !self.kn_panel.offline_anonymous {
                    self.value_error = Some("KN classifier requires explicit offline anonymous profile or an AI backend".into());
                } else {
                    let notice = if missing_model {
                        PanelNotice::AiMissingModel
                    } else if !matches!(index, Cell::Number(n) if !n.is_nan()) {
                        PanelNotice::AiInvalidIndex
                    } else {
                        PanelNotice::AiOffline
                    };
                    self.push_kn_panel_notice(notice);
                }
                Cell::Number(f64::NAN)
            }
        }
    }

    pub(super) fn exec_kn_panel(
        &mut self,
        index: usize,
        actor: usize,
        command: Command,
    ) -> Result<bool> {
        match command {
            Command::Translate(text, language) => {
                let text = self.eval_value(text, actor);
                let _ = self.eval_value(language, actor);
                ensure!(
                    !matches!(text, Cell::Null | Cell::Undefined),
                    "KN translation text.toString cannot read null/undefined"
                );
                // Offline request fails; the official error path releases the
                // lock and does not open a translation dialog.
                Ok(self.defer_kn_panel(index))
            }
            Command::Ranking => Ok(self.defer_kn_panel(index)),
            Command::AiRejected(rejected, argument) => {
                ensure!(
                    self.kn_panel.offline_anonymous,
                    "KN AI command requires explicit offline anonymous profile or an AI backend"
                );
                if let Some(argument) = argument {
                    self.eval_value(argument, actor);
                }
                // The VM currently exposes only the empty-result profile:
                // clearing chat and invalidating OCR are idempotent here. No
                // backend may seed caches without replacing these read paths.
                match rejected.cache {
                    kn_ai::CacheEffect::ClearChatAnswer
                    | kn_ai::CacheEffect::InvalidateTextResult
                    | kn_ai::CacheEffect::Preserve => {}
                }
                let notice = match rejected.reason {
                    kn_ai::Rejection::Offline => PanelNotice::AiOffline,
                    kn_ai::Rejection::LoginRequired => PanelNotice::AiLoginRequired,
                    kn_ai::Rejection::MissingModel => PanelNotice::AiMissingModel,
                };
                self.push_kn_panel_notice(notice);
                Ok(self.defer_kn_panel(index))
            }
            Command::CaptureAlpha(value) => {
                let number = match self.eval_value(value, actor) {
                    Cell::Number(n) => Some(n),
                    _ => None,
                };
                let completion = self.kn_panel.capture.set_alpha(number);
                self.kn_panel_notice(completion.notice);
                Ok(self.defer_kn_panel(index))
            }
            Command::CaptureClose => {
                self.kn_panel
                    .capture
                    .set_camera(kn_capture::CameraSwitch::Off)
                    .map_err(|error| anyhow::anyhow!("unsupported KN camera: {error:?}"))?;
                Ok(self.defer_kn_panel(index))
            }
            Command::Recognize(language) => {
                let completion = self
                    .kn_panel
                    .capture
                    .recognize(kn_capture::Profile::default(), language)
                    .map_err(|error| anyhow::anyhow!("unsupported KN recognition: {error:?}"))?;
                self.kn_panel_notice(completion.notice);
                Ok(self.defer_kn_panel(index))
            }
            Command::GlobalAnimation(animation) => {
                ensure!(
                    self.reporter_depth == 0,
                    "global animation cannot wait in a reporter"
                );
                let animation = self.eval_value(animation, actor).text();
                ensure!(
                    matches!(
                        animation.as_str(),
                        "animation_salvo"
                            | "animation_firework"
                            | "animation_awkward"
                            | "animation_silent"
                    ),
                    "unsupported KN global animation {animation}"
                );
                ensure!(
                    self.kn_panel.effects.len() < 256,
                    "too many pending KN global effects"
                );
                self.kn_panel.serial = self
                    .kn_panel
                    .serial
                    .checked_add(1)
                    .context("KN global effect IDs exhausted")?;
                self.kn_panel.effects.push(GlobalAnimationRequest {
                    id: self.kn_panel.serial,
                    actor: self.sprites[actor].id.clone(),
                    animation,
                    task: self.tasks[index].id,
                });
                self.tasks[index].pending += 1;
                Ok(false)
            }
        }
    }

    /// Local continuation boundary; not an assertion that a VM tick equals a
    /// browser microtask. See the explicitly unverified scheduling scope in docs.
    fn defer_kn_panel(&mut self, index: usize) -> bool {
        self.tasks[index].wake = self.time;
        self.tasks[index].wait_started = Some(self.scheduler_tick);
        self.tasks[index].wait_finished = false;
        false
    }

    fn kn_panel_notice(&mut self, notice: Option<kn_capture::Notice>) {
        let notice = match notice {
            Some(kn_capture::Notice::IgnoredAlpha) => PanelNotice::IgnoredCameraAlpha,
            Some(kn_capture::Notice::LoginRequired) => PanelNotice::RecognitionLoginRequired,
            Some(kn_capture::Notice::RecordBusy) => PanelNotice::RecordingBusy,
            None => return,
        };
        // Bounded, deduplicated UI notifications, not an unbounded per-loop log.
        self.push_kn_panel_notice(notice);
    }

    fn push_kn_panel_notice(&mut self, notice: PanelNotice) {
        if !self.kn_panel.notices.contains(&notice) {
            self.kn_panel.notices.push(notice);
        }
    }

    /// Explicitly select the official anonymous, browser-offline AI rejection
    /// branches. Disabled by default; this never enables a model or network API.
    pub fn set_kn_offline_anonymous(&mut self, enabled: bool) {
        self.kn_panel.offline_anonymous = enabled;
    }

    pub fn take_kn_panel_notices(&mut self) -> Vec<PanelNotice> {
        std::mem::take(&mut self.kn_panel.notices)
    }

    /// Shared KN camera control state only; it does not claim a camera image exists.
    pub fn kn_camera_alpha(&self) -> f64 {
        self.kn_panel.capture.camera_alpha()
    }

    /// Host integration, not an assertion that the renderer already plays SVGA.
    pub fn pending_kn_global_animations(&mut self) -> Vec<GlobalAnimationRequest> {
        self.kn_panel.effects.retain(|effect| {
            self.tasks
                .iter()
                .any(|task| task.id == effect.task && !task.done)
        });
        self.kn_panel.effects.clone()
    }

    /// Release exactly the task that requested this animation. Stale IDs are inert.
    pub fn finish_kn_global_animation(&mut self, id: u64) {
        let Some(index) = self
            .kn_panel
            .effects
            .iter()
            .position(|effect| effect.id == id)
        else {
            return;
        };
        let effect = self.kn_panel.effects.remove(index);
        if let Some(task) = self
            .tasks
            .iter_mut()
            .find(|task| task.id == effect.task && !task.done)
        {
            task.pending = task.pending.saturating_sub(1);
        }
    }
}
