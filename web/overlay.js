// DOM layer over the stage: speech/thought bubbles, the ask prompt and
// variable monitors. Shared by the editor, the standalone player and the extension.
const STYLE = `
.neko-overlay{position:absolute;inset:0;pointer-events:none;overflow:hidden;font-family:inherit;container-type:size}
.neko-bubble{position:absolute;transform:translate(-50%,-100%);max-width:42%;padding:7px 11px;border-radius:12px;background:#fff;color:#1d2330;
  border:2px solid #1d2330;font-size:clamp(10px,2.1cqw,16px);line-height:1.35;white-space:pre-wrap;overflow-wrap:anywhere;text-align:center}
.neko-bubble::after{content:"";position:absolute;left:50%;bottom:-9px;width:12px;height:12px;background:#fff;border:2px solid #1d2330;border-top:0;border-left:0;transform:translateX(-50%) rotate(45deg)}
.neko-bubble.think{border-radius:999px;border-style:dashed}.neko-bubble.think::after{border-radius:50%;bottom:-14px;width:8px;height:8px;border:2px solid #1d2330;transform:translateX(-50%)}
.neko-monitors{position:absolute;left:8px;top:8px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.neko-monitor{display:flex;gap:8px;align-items:stretch;background:#f4f6f1;border:1px solid #c9d3c4;border-radius:6px;font-size:12px;color:#1d2330;overflow:hidden;max-width:46cqw}
.neko-monitor b{font-weight:600;padding:4px 0 4px 8px}.neko-monitor span{background:#2f7d4e;color:#fff;padding:4px 8px;font-variant-numeric:tabular-nums;white-space:pre;max-height:30cqh;overflow:auto}
.neko-monitor.list span{background:#fff;color:#1d2330;border-left:1px solid #c9d3c4}
.neko-ask{position:absolute;left:12px;right:12px;bottom:12px;pointer-events:auto;background:#fff;color:#1d2330;border:1px solid #c9d3c4;border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:10px;box-shadow:0 6px 24px #0003}
.neko-ask p{margin:0;font-size:14px;white-space:pre-wrap}
.neko-ask form{display:flex;gap:8px}.neko-ask input{flex:1;min-width:0;font:inherit;font-size:14px;padding:8px 10px;border:1px solid #b9c4b4;border-radius:8px;outline:none;background:#fff;color:#1d2330;color-scheme:light}
.neko-ask input:focus{border-color:#2f7d4e}.neko-ask button{font:inherit;font-size:13px;padding:8px 14px;border-radius:8px;border:1px solid #2f7d4e;background:#2f7d4e;color:#fff;cursor:pointer}
.neko-ask .choices{display:flex;flex-wrap:wrap;gap:8px}.neko-ask .choices button{background:#f4f6f1;color:#1d2330;border-color:#c9d3c4}.neko-ask .choices button:hover{border-color:#2f7d4e}`;

export class StageOverlay {
  constructor(box, renderer, onAnswer) {
    if (!document.getElementById('neko-overlay-style')) {
      const style = document.createElement('style'); style.id = 'neko-overlay-style'; style.textContent = STYLE; document.head.append(style);
    }
    this.renderer = renderer; this.onAnswer = onAnswer;
    this.root = document.createElement('div'); this.root.className = 'neko-overlay';
    this.monitors = document.createElement('div'); this.monitors.className = 'neko-monitors';
    this.root.append(this.monitors); box.append(this.root);
    this.bubbles = new Map(); this.ask = null; this.askId = null; this.monitorKey = '';
  }
  reset() {
    for (const bubble of this.bubbles.values()) bubble.remove();
    this.bubbles.clear(); this.monitors.replaceChildren(); this.monitorKey = '';
    this.ask?.remove(); this.ask = null; this.askId = null;
  }
  apply(frame) {
    const monitors = frame.monitors || [], key = JSON.stringify(monitors);
    if (key !== this.monitorKey) {
      this.monitorKey = key;
      this.monitors.replaceChildren(...monitors.map(m => {
        const row = document.createElement('div'); row.className = `neko-monitor${m.list ? ' list' : ''}`;
        const name = document.createElement('b'), value = document.createElement('span');
        name.textContent = m.name; value.textContent = m.value; row.append(name, value); return row;
      }));
    }
    const ask = frame.ask || null;
    if ((ask?.id ?? null) !== this.askId) this.showAsk(ask);
  }
  showAsk(ask) {
    this.ask?.remove(); this.ask = null; this.askId = ask?.id ?? null;
    if (!ask) return;
    const panel = document.createElement('div'); panel.className = 'neko-ask';
    const question = document.createElement('p'); question.textContent = ask.question; panel.append(question);
    const send = (text, choice) => { if (this.askId !== ask.id) return; this.onAnswer({ kind: 'answer', id: ask.id, text, ...(choice ? { choice } : {}) }); panel.remove(); this.ask = null; };
    if (ask.choices) {
      const list = document.createElement('div'); list.className = 'choices';
      ask.choices.forEach((label, i) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label || `选项 ${i + 1}`; button.onclick = () => send(label, i + 1); list.append(button); });
      panel.append(list);
    } else {
      const form = document.createElement('form'), input = document.createElement('input'), ok = document.createElement('button');
      input.maxLength = 10000; input.setAttribute('aria-label', ask.question || '回答'); ok.textContent = '确定';
      form.onsubmit = event => { event.preventDefault(); send(input.value); };
      input.addEventListener('keydown', event => event.stopPropagation());
      form.append(input, ok); panel.append(form); queueMicrotask(() => input.focus({ preventScroll: true }));
    }
    this.ask = panel; this.root.append(panel);
  }
  // Called every display frame: bubbles follow their sprites.
  update() {
    const r = this.renderer, seen = new Set();
    for (const a of r.sprites) {
      if (!a.dialog || !a.visible) continue;
      seen.add(a.id);
      let bubble = this.bubbles.get(a.id);
      if (!bubble) { bubble = document.createElement('div'); this.bubbles.set(a.id, bubble); this.root.append(bubble); }
      bubble.className = `neko-bubble${a.dialog.think ? ' think' : ''}`;
      if (bubble.textContent !== a.dialog.text) bubble.textContent = a.dialog.text;
      const image = r.images.get(a.style), top = a.y + (image ? image.height * a.scale / 100 * (a.size_y ?? 100) / 100 / 2 : 0);
      bubble.style.left = `${(a.x / r.width + .5) * 100}%`;
      bubble.style.top = `${Math.max(8, (.5 - top / r.height) * 100 - 2)}%`;
    }
    for (const [id, bubble] of this.bubbles) if (!seen.has(id)) { bubble.remove(); this.bubbles.delete(id); }
  }
}
