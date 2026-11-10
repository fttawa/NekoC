// Repository-owned replay format. Coordinates are centred stage units; times are ms.
export function validateInputScript(script, frames = Number.MAX_SAFE_INTEGER) {
  if (script?.schema !== 'nekoc-input-v1' || !Array.isArray(script.events)) throw new Error('Expected nekoc-input-v1 events');
  let frame = 1, time = 0;
  for (const e of script.events) {
    if (!Number.isSafeInteger(e.frame) || e.frame < frame || e.frame > frames) throw new Error('Input frames must be ordered and within the trace');
    if (!Number.isFinite(e.time_ms) || e.time_ms < time) throw new Error('Input time_ms must be finite and nondecreasing');
    if (!['keydown','keyup','pointerdown','pointermove','pointerup','pointercancel'].includes(e.type)) throw new Error(`Unknown input type: ${e.type}`);
    if (e.type.startsWith('key')) {
      if (!Number.isInteger(e.key_code) || e.key_code < 0 || e.key_code > 255) throw new Error('Invalid key_code');
    } else {
      if (![e.x,e.y].every(Number.isFinite) || !['mouse','touch'].includes(e.pointer_type ?? 'mouse')) throw new Error('Invalid pointer');
    }
    frame = e.frame; time = e.time_ms;
  }
  return script;
}

// Runs in the official page, before RuntimeManager.update. Do not call domain
// responders or supply guessed hit IDs: the original PIXI/Hammer layers do that.
export function installInputReplay(script) {
  const req = window.__k4OracleRequire, stage = req('a1xw').a();
  const runtime = window.__k4OracleContainer.get(window.__k4OracleBinding.RuntimeManager);
  const app = stage.core.app.get_app(), canvas = app.view;
  const epoch = Date.now();
  const observations = window.__k4InputObservations = [];
  for (const type of ['stage:swipe','actor:drag_move']) stage.core.events.add_listener(type, event => {
    observations.push({frame:window.__k4Oracle.frames.length+1,type,target:event.target_id,
      ...(type==='stage:swipe'?{direction:event.data.direction}:{position:event.data.position})});
  });
  let at = 0;
  const update = runtime.update;
  runtime.update = function (...args) {
    const frame = window.__k4Oracle.frames.length + 1;
    while (at < script.events.length && script.events[at].frame === frame) {
      const e = script.events[at++];
      // Hammer and click duration use Date, not the scheduler Clock. Override
      // only during input dispatch; no block/timer reporter sees this clock.
      window.__k4InputTime = epoch + e.time_ms;
      try {
        if (e.type.startsWith('key')) {
          document.body.dispatchEvent(new KeyboardEvent(e.type, { bubbles:true, keyCode:e.key_code, which:e.key_code }));
          continue;
        }
        // Synchronise transforms without advancing the VM or browser clocks.
        app.renderer.render(app.stage);
        const box = canvas.getBoundingClientRect();
        const init = { bubbles:true, cancelable:true, clientX:box.left+(e.x+app.renderer.width/2)*box.width/app.renderer.width,
          clientY:box.top+(app.renderer.height/2-e.y)*box.height/app.renderer.height,
          pointerId:1, pointerType:e.pointer_type ?? 'mouse', isPrimary:true, button:0, buttons:e.type==='pointerup'?0:1 };
        if (e.pointer_type === 'touch') {
          const touch = new Touch({ identifier:1, target:canvas, clientX:init.clientX, clientY:init.clientY });
          const end = ['pointerup','pointercancel'].includes(e.type);
          const type = {pointerdown:'touchstart',pointermove:'touchmove',pointerup:'touchend',pointercancel:'touchcancel'}[e.type];
          canvas.dispatchEvent(new TouchEvent(type, {bubbles:true,cancelable:true,touches:end?[]:[touch],targetTouches:end?[]:[touch],changedTouches:[touch]}));
        }
        canvas.dispatchEvent(new PointerEvent(e.type, init));
      } finally { window.__k4InputTime = null; }
    }
    return update.apply(this, args);
  };
}
