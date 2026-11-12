//! Cold interpreter arms, separated from the inlined hot dispatch.
use super::*;

impl Engine {
    /// `None` falls through to exec's shared value_error check; `Some` preserves
    /// an original early return, including helpers that return directly.
    #[cold]
    #[inline(never)]
    pub(super) fn exec_cold(
        &mut self,
        index: usize,
        pc: usize,
        op: Op,
        actor: usize,
    ) -> Result<Option<bool>> {
        match op {
            Op::CloudSet(binding, value, change, decrease) => {
                let value = self.eval_value(value, actor);
                self.cloud_set(binding, value, change, decrease);
            }
            Op::CloudList(binding, action, at, value) => {
                let at = at.map(|e| self.eval_value(e, actor));
                let value = value.map(|v| self.eval_value(v, actor));
                self.cloud_list(binding, action, at, value);
            }
            Op::Ranking(binding, show) => {
                if !show || (binding.is_some() && self.cloud.ranking.is_none()) {
                    self.cloud.ranking = binding;
                }
            }
            Op::LegacyPhysics(command, value) => {
                let value = self.eval_value(value, actor);
                let number = if matches!(
                    command,
                    physics::Command::LegacyMass
                        | physics::Command::LegacyGravityOrientation
                        | physics::Command::Flexibility
                ) {
                    match value {
                        Cell::Number(n) => n,
                        _ => f64::NAN,
                    }
                } else {
                    value.number()
                };
                self.physics_command(actor, command, [number, 0.0, 0.0])?;
            }
            Op::K4Media(command) => {
                return self.exec_k4_media(index, actor, command).map(Some);
            }
            Op::KnPanel(command) => {
                return self.exec_kn_panel(index, actor, command).map(Some);
            }
            Op::LegacyPhysicsVector(command, value, dir) => {
                let number = |v| match v {
                    Cell::Number(n) => n,
                    _ => f64::NAN,
                };
                let values = [
                    number(self.eval_value(value, actor)),
                    number(self.eval_value(dir, actor)),
                    0.0,
                ];
                self.physics_command(actor, command, values)?;
            }
            Op::PhysicsVelocity(value, dir) => {
                let number = |v| match v {
                    Cell::Number(n) => n,
                    _ => f64::NAN,
                };
                let values = [
                    number(self.eval_value(value, actor)),
                    number(self.eval_value(dir, actor)),
                    0.0,
                ];
                self.physics_command(actor, physics::Command::LegacyVelocity, values)?;
            }
            Op::Physics(command, a, dir, time) => {
                let values = [
                    self.eval(a, actor),
                    self.eval(dir, actor),
                    self.eval(time, actor),
                ];
                let duration = self.physics_command(actor, command, values)?;
                if let Some(duration) = duration {
                    self.tasks[index].wake = self.time + duration;
                    return Ok(Some(false));
                }
            }
            Op::Extension(call) => return self.exec_extension(index, actor, call).map(Some),
            Op::K4DomainError(message) => {
                let message = self.eval_value(message, actor).text();
                bail!("K4 domain error: {message}");
            }
            Op::K4LegacyChoice => ensure!(!self.sprites[actor].stage, "K4 choice used in scene"),
            Op::KnAwaitVoice => {
                if !self.kn_voice_resolved() {
                    self.tasks[index].pc = pc;
                    return Ok(Some(false));
                }
            }
            Op::Audio(i, play) => {
                let audio = self.eval_value(i, actor);
                if !play {
                    for id in self.audio.stop(&audio) {
                        self.audio_finished(id);
                    }
                }
                self.audio_commands.push(AudioCommand {
                    audio,
                    play,
                    wait: None,
                    property: None,
                });
            }
            Op::SpeechConfig(config) => self.speech_config = config,
            Op::Speech(value, blocking) => {
                let text = self.eval_value(value, actor).text();
                // No headless TTS duration can be inferred from text. As with a
                // failed official online synthesis, no playback lock is taken.
                let wait = (blocking && self.audio.browser && !text.is_empty()).then(|| {
                    let wait = self.next_audio_wait;
                    self.next_audio_wait += 1;
                    self.audio_waits.push((self.tasks[index].id, wait));
                    self.tasks[index].pending += 1;
                    wait
                });
                self.speech_commands.push(SpeechCommand {
                    before_audio: self.audio_commands.len(),
                    language: (self.program.semantics == RuntimeSemantics::Kitten4)
                        .then(|| self.k4_speech_language(&text).to_owned()),
                    text,
                    config: self.speech_config,
                    kitten4: self.program.semantics == RuntimeSemantics::Kitten4,
                    wait,
                });
                if wait.is_some() {
                    return Ok(Some(false));
                }
            }
            Op::AudioProperty(audio, value, rate, change, decrease) => {
                // The official audio module checks typeof, without numeric coercion.
                if let Cell::Number(value) = self.eval_value(value, actor)
                    && !value.is_nan()
                    && (!change || value.is_finite())
                {
                    let audio = self.eval_value(audio, actor);
                    let value = if value.is_finite() {
                        value / 100.0 * if change && decrease { -1.0 } else { 1.0 }
                    } else if value.is_sign_positive() {
                        if rate { 4.0 } else { 1.0 }
                    } else if rate {
                        0.05
                    } else {
                        0.0
                    };
                    self.audio.property(&audio, rate, change, value);
                    self.audio_commands.push(AudioCommand {
                        audio,
                        play: false,
                        wait: None,
                        property: Some(AudioProperty {
                            rate,
                            change,
                            value,
                        }),
                    });
                }
            }
            Op::KnTimer(delay, repeat) => {
                let milliseconds = self.eval_value(delay, actor).number();
                ensure!(
                    self.kn_timers
                        .insert(self.time, self.scheduler_tick, milliseconds, repeat, ())
                        .is_some(),
                    "KN timer limit exceeded"
                );
            }
            Op::KnClearTimer(value) => {
                let id = self.eval_value(value, actor).number();
                self.kn_timers.cancel(id);
            }
            Op::Tell(target, start, wait) => {
                let target = if target == usize::MAX { actor } else { target };
                ensure!(
                    self.tasks.len() < 4096,
                    "task limit exceeded at {}",
                    self.program.sources[pc]
                );
                let script = Script {
                    start,
                    hat: self.program.sources[pc].clone(),
                    actor: target,
                    event: ScriptEvent::Start,
                };
                let mut task = Task::new(self.next_task_id, &script, &self.program);
                self.next_task_id += 1;
                task.locals.clone_from(&self.tasks[index].locals);
                task.local_values
                    .clone_from(&self.tasks[index].local_values);
                if wait {
                    task.waiter = Some(self.tasks[index].id);
                    self.tasks[index].pending += 1;
                }
                self.ready.push_back(self.tasks.len());
                self.tasks.push(task);
                if wait {
                    return Ok(Some(false));
                }
            }
            Op::StageDialog(text, target) => {
                let text = self.eval_value(text, actor).text();
                self.stage_dialog(actor, target, text, index);
                return Ok(Some(false));
            }
            Op::Ask(question, choices) => {
                let question = self.eval_value(question, actor).text();
                let choices = choices.map(|span| {
                    (span.start..span.start + span.len)
                        .map(|k| {
                            let value = self.program.value_args[k as usize];
                            self.eval_value(value, actor).text()
                        })
                        .collect()
                });
                self.asks.push_back(AskRequest {
                    id: self.next_ask,
                    sprite: if self.sprites[actor].stage {
                        String::new()
                    } else {
                        self.sprites[actor].id.clone()
                    },
                    question,
                    choices,
                    task: self.tasks[index].id,
                });
                self.next_ask += 1;
                // Suspended until the viewer answers (see Engine::answer).
                self.tasks[index].pending += 1;
                return Ok(Some(false));
            }
            Op::Video(value, action) => {
                let id = self.eval_value(value, actor).text();
                self.video_action(&id, action, index);
                if self.tasks[index].pending > 0 {
                    return Ok(Some(false));
                }
            }
            Op::AudioWait(value) => {
                let audio = self.eval_value(value, actor);
                let wait = self.next_audio_wait;
                self.next_audio_wait += 1;
                if !self.audio.play(&audio, wait) && !self.audio.browser && self.logs.len() < 1024 {
                    self.logs.push(format!(
                        "音频 {} 时长未知：CLI 按加载失败降级，下一 tick 继续",
                        audio.text()
                    ));
                }
                self.audio_commands.push(AudioCommand {
                    audio,
                    play: true,
                    wait: Some(wait),
                    property: None,
                });
                self.audio_waits.push((self.tasks[index].id, wait));
                self.tasks[index].pending += 1;
                return Ok(Some(false));
            }
            // exec's explicit cold-op whitelist is the only dispatch entry.
            _ => unreachable!("hot opcode dispatched to exec_cold"),
        }
        Ok(None)
    }
}
