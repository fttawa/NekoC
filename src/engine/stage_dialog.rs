//! Blocking stage introductions, separate from nonblocking actor speech bubbles.
//! Official evidence: player_v2 / lt.create_stage_dialog, tn.on_mouse_up and ze.
use super::*;

#[derive(Clone, Debug, Serialize)]
pub struct StageDialogRequest {
    pub id: u64,
    pub target: String,
    pub name: String,
    pub text: String,
    pub visible_text: String,
    pub printing: bool,
    pub more: bool,
    #[serde(skip)]
    pub(super) task: u64,
    #[serde(skip)]
    pages: VecDeque<String>,
    #[serde(skip)]
    elapsed: f64,
}

impl Engine {
    pub(super) fn stage_dialog(&mut self, actor: usize, target: usize, text: String, task: usize) {
        let target = if target == usize::MAX { actor } else { target };
        let target = self.sprites[target].origin;
        if !self.sprites[target].alive {
            return;
        }
        // Official dialog layout: 12px margins, 100px actor preview (30 for
        // scenes), 20px preview inset, and 22px content. The headless VM estimates
        // glyph widths; official JfQ3.T measures PIXI text with the installed font.
        // Exact proportional-font page boundaries are not yet reproduced.
        let width = self.program.width
            - if self.sprites[target].stage {
                86.0
            } else {
                176.0
            };
        let mut pages = pages(&text, width.max(44.0));
        let text = pages.pop_front().unwrap();
        self.stage_dialogs.push_back(StageDialogRequest {
            id: self.next_ask,
            target: self.sprites[target].id.clone(),
            name: self.sprites[target].name.clone(),
            text,
            visible_text: String::new(),
            printing: true,
            more: !pages.is_empty(),
            task: self.tasks[task].id,
            pages,
            elapsed: 0.0,
        });
        self.next_ask += 1;
        self.tasks[task].pending += 1;
    }

    pub fn pending_stage_dialog(&self) -> Option<&StageDialogRequest> {
        self.stage_dialogs
            .front()
            .filter(|d| self.asks.front().is_none_or(|ask| d.id < ask.id))
    }

    /// A release inside the dialog: finish printing, turn a page, or unlock.
    /// IDs never reset on restart, so stale browser input cannot dismiss a new UI.
    pub fn stage_dialog_click(&mut self, id: u64) {
        if self.pending_stage_dialog().is_none_or(|d| d.id != id) {
            return;
        }
        let dialog = self.stage_dialogs.front_mut().unwrap();
        if dialog.printing {
            dialog.printing = false;
            dialog.visible_text.clone_from(&dialog.text);
        } else if let Some(text) = dialog.pages.pop_front() {
            dialog.text = text;
            dialog.visible_text.clear();
            dialog.more = !dialog.pages.is_empty();
            dialog.printing = true;
            dialog.elapsed = 0.0;
        } else {
            let dialog = self.stage_dialogs.pop_front().unwrap();
            if let Some(task) = self
                .tasks
                .iter_mut()
                .find(|t| t.id == dialog.task && !t.done)
            {
                task.pending = task.pending.saturating_sub(1);
            }
        }
    }

    pub(super) fn tick_stage_dialog(&mut self, dt: f64) {
        if self.pending_stage_dialog().is_some() {
            let dialog = self.stage_dialogs.front_mut().unwrap();
            if !dialog.printing {
                return;
            }
            dialog.elapsed += dt;
            let count = (dialog.elapsed / 0.05).ceil() as usize;
            dialog.visible_text = dialog.text.chars().take(count).collect();
            if dialog.elapsed >= dialog.text.encode_utf16().count() as f64 * 0.05 {
                dialog.printing = false;
                dialog.visible_text.clone_from(&dialog.text);
            }
        }
    }
}

fn pages(text: &str, width: f64) -> VecDeque<String> {
    let text = if text.is_empty() { " " } else { text };
    let mut pages = VecDeque::new();
    let mut page = String::new();
    let mut used = 0.0;
    // Two lines per page, with room for the continuation mark/hyphens.
    let limit = width * 2.0 - 28.0;
    for ch in text.chars() {
        let size = if ch.is_ascii() { 11.0 } else { 22.0 };
        if used + size > limit && !page.is_empty() {
            pages.push_back(std::mem::take(&mut page));
            used = 0.0;
        }
        page.push(ch);
        used += size;
    }
    pages.push_back(page);
    pages
}
