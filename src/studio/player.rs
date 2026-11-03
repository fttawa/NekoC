use crate::runtime::{Runtime, RuntimeEvent, RuntimeSnapshot};
use anyhow::{Result, anyhow};
use serde_json::Value;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::thread::{self, JoinHandle};

enum Command {
    Tick(Vec<RuntimeEvent>),
    Stop,
}

/// The worker owns immutable project storage, avoiding self-referential structs,
/// unsafe lifetime extensions and full replay on each UI frame.
pub struct Player {
    commands: SyncSender<Command>,
    replies: Receiver<Result<RuntimeSnapshot, String>>,
    worker: Option<JoinHandle<()>>,
    pending: bool,
}

impl Player {
    pub fn start(project: Value) -> Result<Self> {
        let (commands, inbox) = mpsc::sync_channel(1);
        let (outbox, replies) = mpsc::channel();
        let worker = thread::Builder::new()
            .name("nekoc-runtime".into())
            .spawn(move || {
                let mut runtime = match Runtime::from_project(&project) {
                    Ok(runtime) => runtime,
                    Err(error) => {
                        let _ = outbox.send(Err(error.to_string()));
                        return;
                    }
                };
                runtime.set_cooperative(true);
                runtime.start();
                while let Ok(Command::Tick(events)) = inbox.recv() {
                    for event in events {
                        runtime.dispatch_event(&event);
                    }
                    let result = runtime
                        .run_ticks(1)
                        .map(|()| runtime.snapshot())
                        .map_err(|e| e.to_string());
                    let failed = result.is_err();
                    if outbox.send(result).is_err() || failed {
                        break;
                    }
                }
            })?;
        Ok(Self {
            commands,
            replies,
            worker: Some(worker),
            pending: false,
        })
    }

    pub fn tick(&mut self, events: Vec<RuntimeEvent>) -> Result<bool> {
        if self.pending {
            return Ok(false);
        }
        self.commands
            .send(Command::Tick(events))
            .map_err(|_| anyhow!("runtime worker stopped"))?;
        self.pending = true;
        Ok(true)
    }

    pub fn poll(&mut self) -> Option<Result<RuntimeSnapshot, String>> {
        match self.replies.try_recv() {
            Ok(reply) => {
                self.pending = false;
                Some(reply)
            }
            Err(mpsc::TryRecvError::Empty) => None,
            Err(mpsc::TryRecvError::Disconnected) if self.pending => {
                self.pending = false;
                Some(Err("runtime worker disconnected".into()))
            }
            Err(_) => None,
        }
    }

    pub fn is_pending(&self) -> bool {
        self.pending
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        let _ = self.commands.send(Command::Stop);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}
