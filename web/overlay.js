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
.neko-ask-row{display:flex;gap:8px}.neko-ask input{flex:1;min-width:0;font:inherit;font-size:14px;padding:8px 10px;border:1px solid #b9c4b4;border-radius:8px;outline:none;background:#fff;color:#1d2330;color-scheme:light}
.neko-ask input:focus{border-color:#2f7d4e}.neko-ask button{font:inherit;font-size:13px;padding:8px 14px;border-radius:8px;border:1px solid #2f7d4e;background:#2f7d4e;color:#fff;cursor:pointer}
.neko-ask .choices{display:flex;flex-wrap:wrap;gap:8px}.neko-ask .choices button{background:#f4f6f1;color:#1d2330;border-color:#c9d3c4}.neko-ask .choices button:hover{border-color:#2f7d4e}
.neko-stage-dialog{position:absolute;left:calc(12 * var(--neko-unit));right:calc(12 * var(--neko-unit));bottom:calc(12 * var(--neko-unit));height:calc(180 * var(--neko-unit));pointer-events:auto;background:#fff;color:#333;font-family:"Microsoft YaHei",sans-serif;cursor:pointer}
.neko-stage-dialog::before{content:"";position:absolute;inset:calc(-1 * var(--neko-unit));border:calc(2 * var(--neko-unit)) solid #d9d6ce;border-radius:calc(5 * var(--neko-unit));pointer-events:none}
.neko-stage-dialog img{position:absolute;left:calc(20 * var(--neko-unit));top:50%;transform:translateY(-50%);object-fit:contain}
/* PIXI text uses grayscale canvas textures, not LCD subpixel glyphs. */
.neko-stage-dialog b,.neko-stage-dialog p,.neko-stage-dialog button{position:absolute;margin:0;padding:0;border:0;font-family:inherit;font-weight:normal;white-space:pre;letter-spacing:normal;opacity:.9999}
.neko-stage-dialog b{left:calc(132 * var(--neko-unit));top:calc(20 * var(--neko-unit));color:#498ad9;font-size:calc(21 * var(--neko-unit));line-height:calc(26 * var(--neko-unit))}
.neko-stage-dialog p{left:calc(132 * var(--neko-unit));right:calc(32 * var(--neko-unit));top:calc(52 * var(--neko-unit));font-size:calc(22 * var(--neko-unit));line-height:calc(28 * var(--neko-unit));white-space:pre-wrap;overflow-wrap:anywhere}
.neko-stage-dialog button{right:calc(37 * var(--neko-unit));top:calc(145 * var(--neko-unit));background:transparent;color:#aeaeae;font-size:calc(21 * var(--neko-unit));line-height:calc(26 * var(--neko-unit));cursor:pointer}
.neko-stage-dialog button::after{content:"";position:absolute;left:calc(91 * var(--neko-unit));top:calc(5 * var(--neko-unit));width:calc(11 * var(--neko-unit));height:calc(15 * var(--neko-unit));background:#aeaeae;clip-path:polygon(0 0,100% 50%,0 100%);border-radius:calc(2 * var(--neko-unit))}
.neko-stage-dialog.scene b,.neko-stage-dialog.scene p{left:calc(42 * var(--neko-unit))}
.neko-bubble.k4{transform:none;max-width:none;box-sizing:content-box;min-width:calc(68 * var(--neko-unit));width:max-content;padding:calc(15 * var(--neko-unit)) calc(20 * var(--neko-unit));border:0;border-radius:calc(16 * var(--neko-unit));font-family:"PingFangSC-Medium","Microsoft YaHei",sans-serif;font-size:calc(26 * var(--neko-unit));line-height:calc(36 * var(--neko-unit));color:#666;white-space:pre-wrap;text-align:left;filter:drop-shadow(calc(2.12132 * var(--neko-unit)) calc(2.12132 * var(--neko-unit)) 0 #00000026)}
.neko-bubble.k4 span{display:block;max-width:calc(208 * var(--neko-unit));position:relative;top:calc(3 * var(--neko-unit));opacity:.9999;overflow-wrap:anywhere}
.neko-bubble.k4::after{left:calc(19.8 * var(--neko-unit));bottom:calc(-25 * var(--neko-unit));width:calc(30 * var(--neko-unit));height:calc(25 * var(--neko-unit));border:0;transform:none;clip-path:polygon(16.6667% 0,0 100%,100% 0)}
.neko-bubble.k4.flipped::after{left:auto;right:calc(19.8 * var(--neko-unit));transform:scaleX(-1)}
.neko-bubble.k4.think{border-style:none;border-radius:calc(33 * var(--neko-unit))}
.neko-bubble.k4.think::before,.neko-bubble.k4.think::after{content:"";position:absolute;background:#fff;border:0;border-radius:50%;clip-path:none;transform:none}
.neko-bubble.k4.think::before{left:calc(12 * var(--neko-unit));bottom:calc(-30 * var(--neko-unit));width:calc(26 * var(--neko-unit));height:calc(20 * var(--neko-unit))}
.neko-bubble.k4.think::after{left:calc(-3 * var(--neko-unit));bottom:calc(-46 * var(--neko-unit));width:calc(16 * var(--neko-unit));height:calc(12 * var(--neko-unit))}
.neko-bubble.k4.think.flipped::before{left:auto;right:calc(12 * var(--neko-unit))}.neko-bubble.k4.think.flipped::after{left:auto;right:calc(-3 * var(--neko-unit))}
.neko-ask.k4-choice{left:calc(10 * var(--neko-unit));right:calc(10 * var(--neko-unit));bottom:calc(10 * var(--neko-unit));padding:0;display:block;border:0;border-radius:calc(9 * var(--neko-unit));box-shadow:none;font-family:"Microsoft YaHei",sans-serif;filter:drop-shadow(calc(2.12132 * var(--neko-unit)) calc(2.12132 * var(--neko-unit)) 0 #00000026)}
.neko-ask.k4-choice p{position:absolute;bottom:100%;left:0;width:calc(600 * var(--neko-unit));height:var(--choice-height);box-sizing:border-box;padding:0 calc(16 * var(--neko-unit));display:flex;align-items:center;border-radius:calc(6 * var(--neko-unit)) calc(6 * var(--neko-unit)) 0 0;background:#fff;font-size:calc(22 * var(--neko-unit));color:#000;white-space:nowrap;overflow:hidden;opacity:.9999}
.neko-ask.k4-choice .choices{display:grid;grid-template-columns:repeat(2,1fr);gap:0;outline:calc(1 * var(--neko-unit)) solid #d8d8d8;border-radius:inherit}
.neko-ask.k4-choice .choices button{height:var(--choice-height);padding:0;border:calc(1 * var(--neko-unit)) solid #d8d8d8;background:#fff;color:#000;border-radius:calc(9 * var(--neko-unit));font-size:calc(22 * var(--neko-unit));font-weight:normal;opacity:.9999}
.neko-ask.k4-choice .choices button:hover{background:#297eff;color:#fff}`;

export class StageOverlay {
  constructor(box, renderer, onAnswer) {
    if (!document.getElementById('neko-overlay-style')) {
      const style = document.createElement('style'); style.id = 'neko-overlay-style'; style.textContent = STYLE; document.head.append(style);
    }
    this.renderer = renderer; this.onAnswer = onAnswer;
    this.project = null; this.previews = new Map();
    // Retain canonical display metadata without extending the VM's Monitor contract
    // or teaching StageRenderer about DOM widgets. Each overlay owns its renderer.
    if (renderer.load) {
      const load = renderer.load;
      renderer.load = async (project, ...rest) => {
        this.project = project; this.previews.clear(); this.monitorKey = '';
        const result = await load.call(renderer, project, ...rest);
        await Promise.all((renderer.kitten4 ? [...renderer.images.values()] : []).filter(image => image.src).map(async image => {
          const preview = new Image(); preview.alt = ''; preview.src = image.src;
          try { await preview.decode(); this.previews.set(image.src, preview); } catch { /* Renderer reports asset failures. */ }
        }));
        return result;
      };
    }
    this.root = document.createElement('div'); this.root.className = 'neko-overlay';
    this.monitors = document.createElement('div'); this.monitors.className = 'neko-monitors';
    this.root.append(this.monitors); box.append(this.root);
    this.bubbles = new Map(); this.ask = null; this.askId = null; this.monitorKey = '';
    this.stageDialog = null; this.ranking = null;
  }
  reset() {
    const restore=this.root.contains(document.activeElement);
    for (const bubble of this.bubbles.values()) bubble.remove();
    this.bubbles.clear(); this.monitors.replaceChildren(); this.monitorKey = '';
    this.renderer.cloudListViews?.clear();
    this.ask?.remove(); this.ask = null; this.askId = null;
    this.stageDialog?.remove(); this.stageDialog = null;
    this.ranking?.remove(); this.ranking = null;
    if(restore)this.renderer.canvas?.focus({preventScroll:true});
  }
  apply(frame) {
    this.root.style.setProperty('--neko-unit', `${100 / this.renderer.width}cqw`);
    this.monitors.style.left = this.monitors.style.top = this.renderer.kitten4 ? '0' : '';
    const monitors = frame.monitors || [], key = JSON.stringify([monitors,frame.cloud_ui?.lists]);
    if (key !== this.monitorKey) {
      this.monitorKey = key;
      this.monitors.replaceChildren(...monitors.map(m => {
        const canvas = this.renderer.monitorCanvas?.(m,frame.cloud_ui); if (canvas) return canvas;
        const row = document.createElement('div'); row.className = `neko-monitor${m.list ? ' list' : ''}`;
        const name = document.createElement('b'), value = document.createElement('span');
        name.textContent = m.name; value.textContent = m.value; row.append(name, value); return row;
      }));
    }
    const ask = frame.ask || null;
    const newAsk = (ask?.id ?? null) !== this.askId;
    if (newAsk) this.showAsk(ask);
    if (!newAsk && this.ask?.classList.contains('k4-choice')) {
      // cn.pop_selection moves ceil(distance/4) once per official update.
      this.askDistance -= Math.ceil(this.askDistance / 4);
      this.ask.style.transform = `translateY(calc(${this.askDistance} * var(--neko-unit)))`;
    }
    this.showStageDialog(frame.stage_dialog || null);
    this.showRanking(frame.cloud_ui?.ranking||null);
  }
  showRanking(ranking) {
    if (ranking && this.ranking?.dataset.variable === ranking.variable) return;
    this.ranking?.remove(); this.ranking = null;
    if (!ranking || !this.renderer.kitten4) return;
    // Anonymous offline shell. No official images/fonts or fake ranking rows.
    // Measured default wide-stage DOM: 555x400; current-user then empty loading body.
    const panel=document.createElement('div');panel.className='neko-ranking';panel.dataset.variable=ranking.variable;
    panel.setAttribute('role','dialog');panel.setAttribute('aria-label','排行榜');
    const scale=Math.min(this.renderer.width/555,1),unit='var(--neko-unit)';
    panel.style.cssText=`position:absolute;pointer-events:auto;left:50%;top:50%;width:calc(555 * ${unit});height:calc(400 * ${unit});transform:translate(-50%,-50%) scale(${scale});background:#d1eeff;border-radius:calc(20 * ${unit});box-shadow:0 calc(2 * ${unit}) calc(4 * ${unit}) #0006;font:calc(16 * ${unit})/1.15 "Helvetica Neue",Helvetica,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",Arial,sans-serif;color:#000`;
    const create=(tag,cls,css,text)=>{const e=document.createElement(tag);e.className=cls;e.style.cssText=css;if(text!==undefined)e.textContent=text;return e;};
    const size=n=>`calc(${n} * ${unit})`;
    const header=create('div','ranking-header',`height:${size(90)};display:flex;align-items:center;justify-content:center`);
    const title=create('span','header-text',`font-size:${size(54.55)};color:#fff;-webkit-text-stroke:${size(2)} #4ca0ca`,'排行榜');
    const close=create('button','close-btn',`position:absolute;right:${size(5)};top:${size(5)};border:0;background:none;color:white;font-size:${size(44)};line-height:1;width:${size(38)};height:${size(38)};padding:0;cursor:pointer`,'×');close.type='button';close.setAttribute('aria-label','关闭排行榜');
    close.onclick=()=>{panel.hidden=true;this.onAnswer({kind:'ranking_close'});};header.append(title,close);
    const user=create('div','current-user',`position:relative;margin:0 ${size(25)};height:${size(74)};border-radius:${size(20)};background:#fff;display:flex;align-items:center;box-shadow:0 ${size(2)} ${size(4)} #0004`);
    const rank=create('span','ranking-num',`margin-left:${size(22)};width:${size(33)};font-size:${size(27)};color:#ccc;text-align:center`,'-');
    const avatar=create('div','current-user-avatar',`margin:${size(10)};width:${size(50)};height:${size(50)};border:${size(2)} solid #ddd;border-radius:50%;background:#eee;flex-shrink:0`);avatar.setAttribute('role','img');avatar.setAttribute('aria-label','匿名头像');
    const nickname=create('span','nickname',`width:${size(150)};font: ${size(23)} PingFangSC-Regular,sans-serif`,'未登录用户');
    const n=ranking.value,value=typeof n!=='number'?'-':Math.ceil(Math.log(n+1)/Math.LN10)<=10?String(n):n.toExponential(5);
    const score=create('span','score',`position:absolute;right:${size(15)};font:${size(26)} PingFangSC-Semibold,sans-serif;color:#ff8048`,value);user.append(rank,avatar,nickname,score);
    const content=create('div','ranking-content',`margin:${size(20)} ${size(24)};height:${size(190)};box-sizing:border-box;padding-top:${size(5)};background:#fff;border-radius:${size(20)};overflow:hidden`);
    const scroll=create('div','scroll-container','height:100%');
    const loading=create('div','loading','height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center');
    const icon=create('div','loading-icon',`width:${size(100)};height:${size(100)};box-sizing:border-box;border:${size(5)} solid #d1eeff;border-right-color:transparent;border-radius:50%`);icon.setAttribute('role','img');icon.setAttribute('aria-label','loading');
    const label=create('div','loading-label',`font:${size(18)} PingFangSC-Regular,sans-serif;color:#aeaeae;margin-top:${size(8)}`,'loading');loading.append(icon,label);scroll.append(loading);content.append(scroll);panel.append(header,user,content);
    for(const type of ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','keydown','keyup'])panel.addEventListener(type,e=>e.stopPropagation());
    this.root.append(panel);this.ranking=panel;
  }
  showStageDialog(dialog) {
    if (dialog && this.stageDialog?.dataset.id === String(dialog.id)) {
      this.stageDialog.querySelector('p').textContent = dialog.visible_text ?? dialog.text;
      this.stageDialog.querySelector('button').textContent = '点击继续';
      delete this.stageDialog.dataset.sent;
      return;
    }
    const restore=this.stageDialog?.contains(document.activeElement);
    this.stageDialog?.remove(); this.stageDialog = null;
    if (!dialog) {if(restore)this.renderer.canvas?.focus({preventScroll:true});return;}
    const panel = document.createElement('div'); panel.className = 'neko-stage-dialog';
    panel.dataset.id = String(dialog.id);
    panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', dialog.name || '舞台对话');
    const actor = this.renderer.sprites.find(a => a.id === dialog.target);
    const image = actor && this.renderer.spriteImage(actor);
    const preview = this.previews.get(image?.src) || document.createElement('img'); preview.alt = '';
    if (image?.src) {
      if (preview.src !== image.src) preview.src = image.src;
      const ratio = image.width / image.height;
      preview.style.width = `calc(${ratio > 1 ? 100 : 100 * ratio} * var(--neko-unit))`;
      preview.style.height = `calc(${ratio > 1 ? 100 / ratio : 100} * var(--neko-unit))`;
    } else { preview.style.display = 'none'; if (!actor) panel.classList.add('scene'); }
    const name = document.createElement('b'), text = document.createElement('p'), next = document.createElement('button');
    name.textContent = dialog.name; text.textContent = dialog.visible_text ?? dialog.text;
    next.type = 'button'; next.textContent = '点击继续';
    // Do not leak dialog clicks/keys into project hats or stage pointer state.
    const consume = event => event.stopPropagation();
    for (const type of ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','keydown','keyup']) panel.addEventListener(type, consume);
    panel.onclick = event => {
      event.stopPropagation();
      if (panel.dataset.sent) return;
      panel.dataset.sent = 'true';
      this.onAnswer({ kind: 'stage_dialog_click', id: dialog.id });
    };
    panel.append(preview, name, text, next); this.root.append(panel); this.stageDialog = panel;
    this.focusControl(next);
  }
  focusControl(control){
    queueMicrotask(()=>{
      if(!control?.isConnected||document.querySelector('dialog[open]'))return;
      const active=document.activeElement;
      if(active===document.body||active===this.renderer.canvas||this.root.contains(active))control.focus({preventScroll:true});
    });
  }
  showAsk(ask) {
    const restore=this.ask?.contains(document.activeElement);
    this.ask?.remove(); this.ask = null; this.askId = ask?.id ?? null;
    if (!ask) {if(restore)this.renderer.canvas?.focus({preventScroll:true});return;}
    const panel = document.createElement('div'); panel.className = 'neko-ask';
    panel.setAttribute('role','group');panel.setAttribute('aria-label',ask.question||'回答问题');
    const question = document.createElement('p'); question.textContent = ask.question; panel.append(question);
    const send = (text, choice) => { if (this.askId !== ask.id) return; this.onAnswer({ kind: 'answer', id: ask.id, text, ...(choice ? { choice } : {}) }); panel.remove(); this.ask = null; };
    if (ask.choices) {
      if (this.renderer.kitten4) {
        panel.classList.add('k4-choice');
        for (const type of ['pointerdown','pointerup','mousedown','mouseup','touchstart','touchend','keydown','keyup']) panel.addEventListener(type, event => event.stopPropagation());
        const height = this.renderer.height * .0888;
        panel.style.setProperty('--choice-height', `calc(${height} * var(--neko-unit))`);
        const rows = Math.ceil(ask.choices.length / 2);
        this.askDistance = rows * height + 10;
        panel.style.transform = `translateY(calc(${this.askDistance} * var(--neko-unit)))`;
        const actor = this.renderer.sprites.find(a => a.id === ask.sprite);
        if (actor?.visible) question.hidden = true;
        question.style.lineHeight = 'calc(28 * var(--neko-unit))';
      }
      const list = document.createElement('div'); list.className = 'choices';
      ask.choices.forEach((label, i) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label || `选项 ${i + 1}`;
        if (this.renderer.kitten4) button.style.lineHeight = 'calc(28 * var(--neko-unit))';
        button.onclick = () => send(label, i + 1); list.append(button);
      });
      panel.append(list);
      this.focusControl(list.querySelector('button'));
    } else {
      // No form submission: sandboxed forum iframes lack allow-forms and would block it.
      const form = document.createElement('div'), input = document.createElement('input'), ok = document.createElement('button');
      form.className = 'neko-ask-row'; ok.type = 'button';
      input.maxLength = 10000; input.setAttribute('aria-label', ask.question || '回答'); ok.textContent = '确定';
      ok.onclick = () => send(input.value);
      input.addEventListener('keydown', event => {
        event.stopPropagation();
        if (event.key !== 'Enter' || event.isComposing) return;
        event.preventDefault();
        // The panel is gone before Enter is released; the project must not see that keyup.
        addEventListener('keyup', up => { if (up.key === 'Enter') up.stopImmediatePropagation(); }, { capture: true, once: true });
        send(input.value);
      });
      form.append(input, ok); panel.append(form); this.focusControl(input);
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
      if (r.kitten4) {
        bubble.classList.add('k4');
        let content = bubble.querySelector('span');
        if (!content) { content = document.createElement('span'); content.textContent = a.dialog.text; bubble.replaceChildren(content); }
        const unit = this.root.clientWidth / r.width;
        if (!unit) continue;
        bubble.style.width = 'max-content';
        const width = Math.ceil(bubble.getBoundingClientRect().width / unit), height = bubble.offsetHeight / unit;
        bubble.style.width = `calc(${width - 40} * var(--neko-unit))`;
        const image = r.spriteImage(a), sizeX = Math.abs(a.scale * (a.size_x ?? 100) / 10000), sizeY = Math.abs(a.scale * (a.size_y ?? 100) / 10000);
        const angle = a.rotation_type === 0 ? (a.direction ?? 0) * Math.PI / 180 : 0;
        const actorHeight = image ? Math.abs(image.height * sizeY * Math.cos(angle)) + Math.abs(image.width * sizeX * Math.sin(angle)) : 0;
        const tail = a.dialog.think ? 46 : 25;
        let x = r.width / 2 + a.x, y = r.height / 2 - a.y - actorHeight / 2 - height - tail;
        const flipped = x + width > r.width;
        if (flipped) x = Math.min(x, r.width) - width;
        x = Math.max(0, x); y = Math.max(0, Math.min(y, r.height - height - tail));
        bubble.classList.toggle('flipped', flipped);
        bubble.style.left = `${x / r.width * 100}%`;
        bubble.style.top = `${y / r.height * 100}%`;
        continue;
      }
      const image = r.spriteImage(a), top = a.y + (image ? image.height * a.scale / 100 * (a.size_y ?? 100) / 100 / 2 : 0);
      bubble.style.left = `${(a.x / r.width + .5) * 100}%`;
      bubble.style.top = `${Math.max(8, (.5 - top / r.height) * 100 - 2)}%`;
    }
    for (const [id, bubble] of this.bubbles) if (!seen.has(id)) { bubble.remove(); this.bubbles.delete(id); }
  }
}
