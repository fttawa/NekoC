//! K4 media host boundary. No microphone, network, camera or MIDI assets are
//! fabricated by the headless engine. See docs/kitten4-third-media.md.
use super::*;

#[derive(Clone, Copy, Debug)]
pub(super) enum Command {
    MidiWait(usize),
    MidiNote(usize, usize, bool),
    Language(usize),
    Request(RequestKind, Option<usize>, Option<usize>),
    PlayRecord,
    Vibrate(usize, bool),
    Translate(usize, usize),
}

#[derive(Clone, Copy, Debug)]
pub(super) enum Reporter {
    Midi(usize),
    Voice,
    Scan,
    MobileButton(usize, usize, usize),
    Translate(usize, usize),
}

impl Reporter {
    pub(super) fn children(self) -> Vec<usize> {
        match self {
            Self::Midi(i) => vec![i],
            Self::MobileButton(a, b, c) => vec![a, b, c],
            Self::Translate(a, b) => vec![a, b],
            _ => vec![],
        }
    }
}

#[derive(Clone, Debug)]
pub(super) struct Event {
    action: String,
    value: String,
    device: String,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequestKind {
    AskListen,
    Recognize,
    AskRecord,
    Scan,
    ScanResult,
}

#[derive(Clone, Debug, Serialize)]
pub struct MediaRequest {
    pub id: u64,
    pub kind: RequestKind,
    pub actor: String,
    pub text: String,
    pub language: String,
    #[serde(skip)]
    task: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MediaOutput {
    /// Zero-based piano key (A0=0, C8=87), not General MIDI note number.
    Midi {
        key: Cell,
        beats: f64,
        seconds: f64,
        fade_seconds: f64,
    },
    PlayRecord {
        recording: String,
    },
    Vibrate {
        pattern_ms: Vec<f64>,
    },
}

#[derive(Default)]
pub(super) struct State {
    serial: u64,
    dialog: VecDeque<MediaRequest>,
    scanner: VecDeque<MediaRequest>,
    scan_results: Vec<MediaRequest>,
    output: Vec<MediaOutput>,
    frame_output: Vec<MediaOutput>,
    /// Browser hosts can opt into frame-only delivery.  The default remains
    /// the historical take API, so native hosts do not silently lose output.
    frame_only: bool,
    voice: String,
    recording: String,
    scan: String,
    language: String,
    button: Option<(String, String, String)>,
    camera_available: bool,
    motion: Option<[f64; 3]>,
    device_events: Vec<Event>,
    orientations: Vec<(f64, f64, bool)>,
}

impl State {
    pub(super) fn reset(&mut self) {
        let serial = self.serial;
        let camera = self.camera_available;
        let frame_only = self.frame_only;
        *self = Self::default();
        self.serial = serial;
        self.camera_available = camera;
        self.frame_only = frame_only;
    }
    pub(super) fn clear_frame(&mut self) {
        self.button = None;
        self.device_events.clear();
        self.orientations.clear();
    }

    pub(super) fn begin_frame(&mut self) {
        // In frame-only mode the legacy queue is deliberately discarded at
        // the start of each update.  This is opt-in because old native hosts
        // still rely on take_k4_media_output() retaining events until taken.
        if self.frame_only {
            self.output.clear();
        }
        self.frame_output.clear();
    }

    pub(super) fn take_frame_output(&mut self) -> Vec<MediaOutput> {
        std::mem::take(&mut self.frame_output)
    }

    pub(super) fn set_frame_only(&mut self, enabled: bool) {
        self.frame_only = enabled;
        if enabled {
            self.output.clear();
        }
    }

    fn emit(&mut self, output: MediaOutput) -> Result<()> {
        ensure!(
            self.frame_output.len() < 1024,
            "too many K4 media outputs in one frame"
        );
        if !self.frame_only {
            ensure!(
                self.output.len() < 1024,
                "too many unconsumed K4 media outputs"
            );
            self.output.push(output.clone());
        }
        self.frame_output.push(output);
        Ok(())
    }
}

impl Compiler {
    fn media_arg(&mut self, b: &Value, name: &str) -> Result<usize> {
        if let Some(value) = b["inputs"].get(name) {
            self.value(value)
        } else if let Some(value) = b["fields"].get(name) {
            Ok(self.push_constant(Cell::from_json(value)?))
        } else {
            bail!("missing K4 media argument {name} at {}", b["id"])
        }
    }

    pub(super) fn k4_media_command(&mut self, b: &Value) -> Result<Command> {
        ensure!(
            self.program.semantics == RuntimeSemantics::Kitten4,
            "K4 media requires K4 provenance"
        );
        let arg = |this: &mut Self, key| this.media_arg(b, key);
        Ok(
            match b["type"]
                .as_str()
                .unwrap_or("")
                .trim_start_matches("kitten4_media_")
            {
                "midi_wait" => Command::MidiWait(arg(self, "beats")?),
                "midi_play_note" => {
                    Command::MidiNote(arg(self, "note")?, arg(self, "beats")?, false)
                }
                "midi_play_num_note" => {
                    Command::MidiNote(arg(self, "num_note")?, arg(self, "beats")?, true)
                }
                "set_speaking_language" => Command::Language(arg(self, "language")?),
                "self_ask_listen" => Command::Request(
                    RequestKind::AskListen,
                    Some(arg(self, "text")?),
                    Some(arg(self, "lang")?),
                ),
                "voice_recognition" => {
                    Command::Request(RequestKind::Recognize, None, Some(arg(self, "lang")?))
                }
                "self_ask_record" => Command::Request(
                    RequestKind::AskRecord,
                    Some(arg(self, "TEXT")?),
                    Some(arg(self, "lang")?),
                ),
                "turn_on_the_camera" | "turn_on_the_qrcode_camera" => {
                    Command::Request(RequestKind::Scan, None, None)
                }
                "display_recognition_result" => {
                    Command::Request(RequestKind::ScanResult, None, None)
                }
                "play_ask_record" => Command::PlayRecord,
                "shock_duration" => Command::Vibrate(arg(self, "duration")?, false),
                "shock_for_n_times" => Command::Vibrate(arg(self, "times")?, true),
                "translate" => Command::Translate(arg(self, "text")?, arg(self, "language")?),
                kind => bail!("unsupported K4 media command {kind}"),
            },
        )
    }

    pub(super) fn k4_media_reporter(&mut self, b: &Value) -> Result<Reporter> {
        ensure!(
            self.program.semantics == RuntimeSemantics::Kitten4,
            "K4 media requires K4 provenance"
        );
        Ok(
            match b["type"]
                .as_str()
                .unwrap_or("")
                .trim_start_matches("kitten4_media_")
            {
                "midi_get" => Reporter::Midi(self.media_arg(b, "midi")?),
                "get_voice_answer" => Reporter::Voice,
                "get_recognition_result" => Reporter::Scan,
                "on_mobile_click_btn" => Reporter::MobileButton(
                    self.media_arg(b, "mobile")?,
                    self.media_arg(b, "btn_event_type")?,
                    self.media_arg(b, "type")?,
                ),
                "translate_result" => {
                    Reporter::Translate(self.media_arg(b, "text")?, self.media_arg(b, "language")?)
                }
                kind => bail!("unsupported K4 media reporter {kind}"),
            },
        )
    }

    pub(super) fn k4_media_event(&mut self, b: &Value) -> Result<Event> {
        ensure!(
            self.program.semantics == RuntimeSemantics::Kitten4,
            "K4 media requires K4 provenance"
        );
        let action = b["type"]
            .as_str()
            .unwrap_or("")
            .trim_start_matches("kitten4_media_");
        ensure!(
            matches!(
                action,
                "on_mobile_slide" | "on_mobile_slope" | "on_mobile_shake" | "on_shake" | "on_tilt"
            ),
            "unknown K4 media event {action}"
        );
        // Official responders use registration filter arguments, not live sockets.
        ensure!(
            b["inputs"].as_object().is_none_or(|v| v.is_empty()),
            "dynamic K4 media event filters unsupported"
        );
        Ok(Event {
            action: action.into(),
            value: field(b, "type").into(),
            device: field(b, "mobile").into(),
        })
    }
}

impl Engine {
    pub(super) fn exec_k4_media(
        &mut self,
        index: usize,
        actor: usize,
        command: Command,
    ) -> Result<bool> {
        match command {
            Command::MidiWait(i) => {
                let beats = self.eval_value(i, actor);
                let duration = match beats {
                    Cell::Number(n) => n * 0.75,
                    _ => 0.0,
                };
                return Ok(self.k4_midi_wait(index, duration));
            }
            Command::MidiNote(note, beats, numbered) => {
                // Preserve official argument order, including ignored invalid notes.
                let note = self.eval_value(note, actor);
                let beats = self.eval_value(beats, actor);
                if numbered && matches!(note, Cell::Null) {
                    bail!("K4 midi_play_num_note cannot read id of null");
                }
                let Cell::Number(beats) = beats else {
                    return Ok(true);
                };
                if !beats.is_finite() || beats <= 0.0 {
                    return Ok(true);
                }
                let key = if numbered {
                    match note {
                        Cell::Midi(id) if !matches!(*id, Cell::Null) => (*id).clone(),
                        Cell::Number(n) => {
                            let n = (n + 0.5).floor();
                            if n.is_nan() || !(0.0..=100.0).contains(&n) {
                                return Ok(true);
                            }
                            Cell::Number(n.clamp(1.0, 88.0) - 1.0)
                        }
                        _ => return Ok(true),
                    }
                } else {
                    let key = parse_note(&note.text());
                    if !valid_midi_key(key) {
                        return Ok(true);
                    }
                    Cell::Number(key)
                };
                if !midi_cell_key_is_valid(&key) {
                    return Ok(true);
                }
                let seconds = beats * 0.75;
                let output = MediaOutput::Midi {
                    key,
                    beats,
                    seconds,
                    fade_seconds: seconds.max(0.2),
                };
                self.k4_media.emit(output)?;
                return Ok(self.k4_midi_wait(index, seconds));
            }
            Command::Language(i) => {
                let language = self.eval_value(i, actor).text();
                self.k4_media.language = match language.as_str() {
                    "chinese" => "zh",
                    "french" => "fra",
                    "spanish" => "spa",
                    "japanese" => "jp",
                    _ => "en",
                }
                .into();
            }
            Command::Request(kind, text, language) => {
                ensure!(
                    self.reporter_depth == 0,
                    "K4 media dialogs cannot run in reporter procedures"
                );
                let text = text.map(|i| self.eval_value(i, actor));
                ensure!(
                    !matches!(text, Some(Cell::Null)),
                    "K4 media question.toString cannot read null"
                );
                let text = text.map(|v| v.text()).unwrap_or_default();
                let language = language
                    .map(|i| self.eval_value(i, actor).text())
                    .unwrap_or_default();
                // Official PC camera test rejects before acquiring its queue lock.
                if kind == RequestKind::Scan && !self.k4_media.camera_available {
                    return Ok(true);
                }
                ensure!(
                    self.k4_media.dialog.len()
                        + self.k4_media.scanner.len()
                        + self.k4_media.scan_results.len()
                        < 256,
                    "too many pending K4 media requests"
                );
                self.k4_media.serial = self
                    .k4_media
                    .serial
                    .checked_add(1)
                    .context("K4 media IDs exhausted")?;
                let request = MediaRequest {
                    id: self.k4_media.serial,
                    kind,
                    actor: self.sprites[actor].id.clone(),
                    text,
                    language,
                    task: self.tasks[index].id,
                };
                match kind {
                    RequestKind::Scan => self.k4_media.scanner.push_back(request),
                    RequestKind::ScanResult => self.k4_media.scan_results.push(request),
                    _ => self.k4_media.dialog.push_back(request),
                }
                self.tasks[index].pending += 1;
                return Ok(false);
            }
            Command::PlayRecord => {
                let recording = &self.k4_media.recording;
                if !recording.is_empty() && recording != "undefined" && recording != "null" {
                    let output = MediaOutput::PlayRecord {
                        recording: recording.clone(),
                    };
                    self.k4_media.emit(output)?;
                }
            }
            Command::Vibrate(i, count) => {
                let n = self.eval_value(i, actor).number();
                let pattern_ms = if count {
                    ensure!(
                        !n.is_infinite() && n <= 4096.0,
                        "K4 vibration pattern exceeds safety bound"
                    );
                    vec![100.0; n.ceil().max(0.0) as usize * 2]
                } else {
                    vec![1000.0 * n]
                };
                let output = MediaOutput::Vibrate { pattern_ms };
                self.k4_media.emit(output)?;
            }
            Command::Translate(text, language) => {
                let _ = self.eval_value(text, actor);
                let _ = self.eval_value(language, actor);
                // Offline transport failure calls the queue continuation without
                // opening a dialog (Tn6a/b). Do not pretend a translation occurred.
            }
        }
        Ok(true)
    }

    fn k4_midi_wait(&mut self, index: usize, seconds: f64) -> bool {
        self.tasks[index].wake = self.time + seconds.max(0.0);
        self.tasks[index].wait_started = Some(self.scheduler_tick);
        self.tasks[index].wait_finished = false;
        false
    }

    pub(super) fn eval_k4_media(&mut self, reporter: Reporter, actor: usize) -> Cell {
        match reporter {
            Reporter::Midi(i) => Cell::Midi(Rc::new(self.eval_value(i, actor))),
            Reporter::Voice => recognition(&self.k4_media.voice),
            Reporter::Scan => recognition(&self.k4_media.scan),
            Reporter::MobileButton(device, event, kind) => {
                let device = self.eval_value(device, actor);
                let event = self.eval_value(event, actor);
                let kind = self.eval_value(kind, actor);
                let matched = self.k4_media.button.as_ref().is_some_and(|(d, e, k)| {
                    if d.is_empty() || e.is_empty() || k.is_empty() {
                        return false;
                    }
                    if !device.equals(&Cell::Text(d.as_str().into()))
                        || !event.equals(&Cell::Text(e.as_str().into()))
                    {
                        return false;
                    }
                    matches!(&kind, Cell::Text(kind) if k.to_uppercase() == kind.to_uppercase())
                });
                if self.k4_media.button.as_ref().is_some_and(|(d, e, k)| {
                    !d.is_empty()
                        && !e.is_empty()
                        && !k.is_empty()
                        && device.equals(&Cell::Text(d.as_str().into()))
                        && event.equals(&Cell::Text(e.as_str().into()))
                }) && !matches!(kind, Cell::Text(_))
                {
                    self.value_error = Some("K4 mobile type.toUpperCase requires text".into());
                }
                Cell::Bool(matched)
            }
            Reporter::Translate(text, language) => {
                let text = self.eval_value(text, actor);
                let _ = self.eval_value(language, actor);
                if !text.truth() {
                    return Cell::Text("".into());
                }
                // The official failed-network fallback is input.toString().substring(0,200).
                let units: Vec<_> = text.text().encode_utf16().take(200).collect();
                Cell::Text(String::from_utf16_lossy(&units).into())
            }
        }
    }

    /// FIFO dialog and scanner queues are independent in official VL4Q.
    /// Result display locks are concurrent; one dismissal releases all of them.
    pub fn pending_k4_media(&mut self) -> Vec<MediaRequest> {
        self.prune_k4_media();
        self.k4_media
            .dialog
            .front()
            .into_iter()
            .chain(self.k4_media.scanner.front())
            .chain(self.k4_media.scan_results.iter().take(1))
            .cloned()
            .collect()
    }

    pub fn complete_k4_media(&mut self, id: u64, result: &str) -> bool {
        self.prune_k4_media();
        let mut finished = Vec::new();
        if self.k4_media.dialog.front().is_some_and(|r| r.id == id) {
            let request = self.k4_media.dialog.pop_front().unwrap();
            match request.kind {
                RequestKind::AskRecord => self.k4_media.recording = result.into(),
                _ => self.k4_media.voice = result.into(),
            }
            finished.push(request);
        } else if self.k4_media.scanner.front().is_some_and(|r| r.id == id) {
            self.k4_media.scan = result.into();
            finished.push(self.k4_media.scanner.pop_front().unwrap());
        } else if self.k4_media.scan_results.iter().any(|r| r.id == id) {
            finished.append(&mut self.k4_media.scan_results);
        } else {
            return false;
        }
        for request in finished {
            if let Some(task) = self
                .tasks
                .iter_mut()
                .find(|t| t.id == request.task && !t.done)
            {
                task.pending = task.pending.saturating_sub(1);
            }
        }
        true
    }

    fn prune_k4_media(&mut self) {
        let tasks = &self.tasks;
        let alive = |r: &MediaRequest| tasks.iter().any(|t| t.id == r.task && !t.done);
        self.k4_media.dialog.retain(alive);
        self.k4_media.scanner.retain(alive);
        self.k4_media.scan_results.retain(alive);
    }

    /// Host capability probe result; false reproduces the official PC test failure.
    pub fn set_k4_camera_available(&mut self, available: bool) {
        self.k4_media.camera_available = available;
    }
    pub fn take_k4_media_output(&mut self) -> Vec<MediaOutput> {
        // Compatibility API.  In frame-only mode this is intentionally empty;
        // frame hosts consume Frame.k4_media instead.
        std::mem::take(&mut self.k4_media.output)
    }

    /// An explicit host event, never synthesized from keyboard/mouse input.
    pub fn k4_device_event(&mut self, action: &str, device: &str, value: &str) {
        if !matches!(
            action,
            "on_mobile_slide" | "on_mobile_slope" | "on_mobile_shake" | "on_shake" | "on_tilt"
        ) {
            return;
        }
        if self.stopped {
            return;
        }
        if self.k4_media.device_events.len() < 4096 {
            self.k4_media.device_events.push(Event {
                action: action.into(),
                device: device.into(),
                value: value.into(),
            });
        }
    }

    /// RuntimeManager.update_actions evaluates Action responders before
    /// Dynamic responders. A Dynamic trigger receives the entire frame queue,
    /// not only actions with its own ID (official mixed-input probe).
    pub(super) fn dispatch_k4_devices(&mut self) {
        // Official rAF/world ticker integrates the previous gravity before
        // the update sees the new DOM orientation (device-gravity probe).
        for (beta, gamma, portrait) in std::mem::take(&mut self.k4_media.orientations) {
            self.set_physics_device_orientation(beta, gamma, portrait);
        }
        if self.stopped || self.k4_media.device_events.is_empty() {
            return;
        }
        for dynamic in [false, true] {
            for script in 0..self.program.scripts.len() {
                let spec = &self.program.scripts[script];
                let ScriptEvent::K4Media(filter) = &spec.event else {
                    continue;
                };
                if filter.action.starts_with("on_mobile_") != dynamic
                    || !self.in_active_scene(spec.actor)
                {
                    continue;
                }
                let events = &self.k4_media.device_events;
                let matched = if dynamic {
                    events.iter().any(|e| e.action == filter.action)
                        && events
                            .iter()
                            .any(|e| filter.matches(&filter.action, &e.device, &e.value))
                } else {
                    events
                        .iter()
                        .any(|e| filter.matches(&e.action, &e.device, &e.value))
                };
                if !matched {
                    continue;
                }
                for target in self.instances(spec.actor) {
                    if !self
                        .tasks
                        .iter()
                        .any(|t| !t.done && t.script == script && t.actor == target)
                    {
                        self.spawn(script, target);
                    }
                }
            }
        }
    }

    /// Store a browser DeviceMotion sample. K4's official player does not
    /// classify `devicemotion` itself; mobile shake is an explicit service
    /// event, so raw samples never synthesize an official hat.
    pub fn k4_device_motion(&mut self, x: f64, y: f64, z: f64) {
        if x.is_finite() && y.is_finite() && z.is_finite() && !self.stopped {
            self.k4_media.motion = Some([x, y, z]);
        }
    }

    /// Last finite raw acceleration sample. No sample means no real device
    /// data has been supplied; it must not be confused with a stationary phone.
    pub fn k4_device_motion_sample(&self) -> Option<[f64; 3]> {
        self.k4_media.motion
    }

    pub fn inject_k4_device(&mut self, input: crate::device::DeviceInput) {
        match input {
            crate::device::DeviceInput::Motion { x, y, z } => self.k4_device_motion(x, y, z),
            crate::device::DeviceInput::Orientation {
                beta,
                gamma,
                portrait,
            } => {
                if !self.stopped && self.k4_media.orientations.len() < 4096 {
                    self.k4_media.orientations.push((beta, gamma, portrait));
                }
            }
            crate::device::DeviceInput::Event {
                action,
                device,
                value,
            } => self.k4_device_event(&action, &device, &value),
            crate::device::DeviceInput::Button {
                device,
                event,
                button,
            } => self.k4_mobile_button(&device, &event, &button),
        }
    }

    pub fn k4_mobile_button(&mut self, device: &str, event: &str, kind: &str) {
        if !self.stopped {
            self.k4_media.button = Some((device.into(), event.into(), kind.into()));
        }
    }

    /// Language used by existing K4 speech outputs. Default/chinese select by text.
    pub fn k4_speech_language(&self, text: &str) -> &'static str {
        match self.k4_media.language.as_str() {
            "jp" => "ja",
            "en" => "en-UK",
            "spa" => "es-ES",
            "fra" => "fr",
            _ if text.chars().any(|c| c as u32 > 255) => "zh-CN",
            _ => "en-UK",
        }
    }
}

impl Event {
    fn matches(&self, action: &str, device: &str, value: &str) -> bool {
        if self.action != action {
            return false;
        }
        match action {
            "on_mobile_slide" | "on_mobile_slope" => {
                !device.is_empty()
                    && !value.is_empty()
                    && self.device == device
                    && self.value == value
            }
            "on_mobile_shake" => !device.is_empty() && self.device == device,
            "on_tilt" => self.value == value,
            "on_shake" => true,
            _ => false,
        }
    }
}

fn parse_note(text: &str) -> f64 {
    let text = text.trim_start();
    let (sign, text) = if let Some(t) = text.strip_prefix('-') {
        (-1.0, t)
    } else {
        (1.0, text.strip_prefix('+').unwrap_or(text))
    };
    let (radix, text) = if text.starts_with("0x") || text.starts_with("0X") {
        (16, &text[2..])
    } else {
        (10, text)
    };
    let mut value = 0.0;
    let mut any = false;
    for ch in text.chars() {
        let Some(n) = ch.to_digit(radix).filter(|_| ch.is_ascii()) else {
            break;
        };
        value = value * radix as f64 + n as f64;
        any = true;
    }
    if any { sign * value } else { f64::NAN }
}

fn valid_midi_key(key: f64) -> bool {
    key.is_finite() && key.fract() == 0.0 && (0.0..=87.0).contains(&key)
}

fn midi_cell_key_is_valid(key: &Cell) -> bool {
    match key {
        Cell::Number(key) => valid_midi_key(*key),
        Cell::Text(text) => valid_midi_key(parse_note(text)),
        Cell::Midi(id) => midi_cell_key_is_valid(id),
        _ => false,
    }
}

fn recognition(text: &str) -> Cell {
    let raw = text.strip_prefix('-').unwrap_or(text);
    let mut parts = raw.split('.');
    let whole = parts.next().unwrap_or("");
    let fraction = parts.next();
    let valid = !whole.is_empty()
        && whole.bytes().all(|c| c.is_ascii_digit())
        && (whole == "0" || !whole.starts_with('0'))
        && fraction.is_none_or(|s| !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()))
        && parts.next().is_none();
    if valid {
        Cell::Number(crate::js_number::parse(text))
    } else {
        Cell::Text(text.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn strict_recognition_decimal_not_generic_number_coercion() {
        for s in ["0", "-0", "42", "-12.50"] {
            assert!(matches!(recognition(s), Cell::Number(_)), "{s}");
        }
        for s in [
            "", "01", "+1", ".5", "1.", "1e2", " 1", "0x10", "--1", "1.2.3",
        ] {
            assert!(matches!(recognition(s), Cell::Text(_)), "{s}");
        }
    }
    #[test]
    fn note_parse_int_and_case_sensitive_mobile_filters() {
        assert_eq!(parse_note("  -12suffix"), -12.0);
        assert_eq!(parse_note("0x10"), 16.0);
        assert!(parse_note("piano").is_nan());
        let event = Event {
            action: "on_mobile_slide".into(),
            device: "phone".into(),
            value: "left".into(),
        };
        assert!(event.matches("on_mobile_slide", "phone", "left"));
        assert!(!event.matches("on_mobile_slide", "phone", "LEFT"));
        assert!(!event.matches("on_mobile_slide", "other", "left"));
    }
}
