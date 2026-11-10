// Shared by the editor, standalone player and packaged extension. Events retain quick down/up pairs.
export class StageInput {
  constructor(canvas,renderer,active){
    this.canvas=canvas;this.renderer=renderer;this.active=active;this.pressed=new Set();this.events=[];this.mouse={x:0,y:0};this.pointer=null;
    canvas.addEventListener('keydown',event=>{
      if(!active()||event.ctrlKey||event.metaKey||event.altKey||event.key==='Tab')return;
      const key=this.key(event.keyCode);if(key===null)return;
      if(!this.pressed.has(key)){this.pressed.add(key);this.push({kind:'key',key,down:true});}
      event.preventDefault();
    });
    window.addEventListener('keyup',event=>{const key=this.key(event.keyCode);if(key!==null&&this.pressed.delete(key))this.push({kind:'key',key,down:false});});
    canvas.addEventListener('blur',()=>this.release());window.addEventListener('blur',()=>this.release());
    canvas.addEventListener('pointermove',event=>{
      if(!event.isPrimary||this.pointer&&this.pointer.id!==event.pointerId)return;
      this.position(event);
      // Dragging a draggable sprite moves it in the VM.
      const p=this.pointer;
      if(p?.drag&&p.id===event.pointerId){
        let x=this.mouse.x-p.offset.x,y=this.mouse.y-p.offset.y;
        if(renderer.kitten4){
          // K4 ignores out-of-stage drag moves without advancing old_pos.
          // The exact edges remain valid, unlike the click hit rectangle.
          if(this.mouse.x<-renderer.width/2||this.mouse.x>renderer.width/2||this.mouse.y<-renderer.height/2||this.mouse.y>renderer.height/2)return;
          // Official K4 dragging adds each pointer delta to the sprite's
          // current position, including movement performed by its scripts.
          const sprite=renderer.sprites.find(a=>a.id===p.drag.id)||p.drag;
          const unchanged=sprite===p.drag&&sprite.x===p.rendered.x&&sprite.y===p.rendered.y;
          const base=unchanged?p.position:sprite;
          x=base.x+this.mouse.x-p.last.x;y=base.y+this.mouse.y-p.last.y;
          p.drag=sprite;p.rendered={x:sprite.x,y:sprite.y};p.position={x,y};p.last={...this.mouse};
        }
        this.push({kind:'drag',target:p.drag.id,x,y});
      }
    });
    canvas.addEventListener('pointerdown',event=>{
      // A secondary pointer does not take over the gesture, but Hammer's
      // maxPointers check disqualifies the entire gesture from a swipe.
      if(this.pointer&&this.pointer.id!==event.pointerId)this.pointer.maxPointers=2;
      if(!active()||event.button!==0||!event.isPrimary||this.pointer)return;
      canvas.focus({preventScroll:true});this.position(event);
      const target=renderer.hitTest(this.mouse.x,this.mouse.y),sprite=target&&renderer.sprites.find(a=>a.id===target);
      this.pointer={id:event.pointerId,target,start:{...this.mouse,time:performance.now()},client:{x:event.clientX,y:event.clientY},maxPointers:1,
        drag:sprite?.draggable?sprite:null,offset:sprite?{x:this.mouse.x-sprite.x,y:this.mouse.y-sprite.y}:null,
        position:sprite?{x:sprite.x,y:sprite.y}:null,rendered:sprite?{x:sprite.x,y:sprite.y}:null,last:{...this.mouse}};
      canvas.setPointerCapture(event.pointerId);this.pointerEvent('mouse_down',this.pointer.target);event.preventDefault();
    });
    canvas.addEventListener('pointerup',event=>{
      if(this.pointer?.id!==event.pointerId)return;
      this.position(event);const target=renderer.hitTest(this.mouse.x,this.mouse.y),p=this.pointer,down=p.target,start=p.start;this.pointer=null;
      const elapsed=performance.now()-start.time;
      // Both runtimes first use Hammer 2's CSS-pixel distance and overall
      // velocity gate. Signed equal deltas have offset direction NONE.
      const dx=event.clientX-p.client.x,dy=event.clientY-p.client.y;
      if(p.maxPointers===1&&dx!==dy&&Math.hypot(dx,dy)>10&&Math.max(Math.abs(dx),Math.abs(dy))/elapsed>.3){
        if(renderer.kitten4){
          this.push({kind:'swipe',direction:Math.abs(dx)>=Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up')});
        }else{
          // KN's second gate uses independent signed comparisons, not an
          // absolute dominant axis. Opposite diagonals can emit two actions.
          if(dy<-50&&dy<dx)this.push({kind:'swipe',direction:'up'});
          if(dx<-50&&dx<dy)this.push({kind:'swipe',direction:'left'});
          if(dx>50&&dx>dy)this.push({kind:'swipe',direction:'right'});
          if(dy>50&&dy>dx)this.push({kind:'swipe',direction:'down'});
        }
      }
      const box=canvas.getBoundingClientRect();
      const inside=event.clientX>=box.left&&event.clientX<box.right&&event.clientY>=box.top&&event.clientY<box.bottom;
      if(renderer.kitten4){
        if(target!==down)this.pointerEvent('',down);
        this.pointerEvent(inside?'mouse_up':'',target);
      }else{
        if(target!==down)this.pointerEvent('',down);
        this.pointerEvent(inside?'mouse_up':'',target);
      }
      if(inside&&elapsed<1000&&target===down)this.pointerEvent('mouse_click',target);
      if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointercancel',event=>{
      // KN cancel remains a compatibility release; its official runtime
      // state handling has not been verified (docs/input-kn.md, section 3).
      if(this.pointer?.id===event.pointerId){if(renderer.kitten4)this.releasePointer();else this.release();}
    });
    canvas.addEventListener('lostpointercapture',event=>{if(this.pointer?.id===event.pointerId)this.releasePointer();});
  }
  key(code){if(code>=96&&code<=105)code-=48;return code===13||code===32||code>=37&&code<=40||code>=48&&code<=57||code>=65&&code<=90?String(code):null;}
  push(event){if(this.events.length<256)this.events.push(event);}
  position(event){const box=this.canvas.getBoundingClientRect();if(box.width&&box.height)this.mouse={x:(event.clientX-box.left)/box.width*this.renderer.width-this.renderer.width/2,y:this.renderer.height/2-(event.clientY-box.top)/box.height*this.renderer.height};}
  pointerEvent(state,target){this.push({kind:'pointer',state,target:target||'',...this.mouse});}
  releasePointer(){const p=this.pointer;if(!p)return;this.pointer=null;this.pointerEvent(this.renderer.kitten4?'':'mouse_up',p.target);if(this.canvas.hasPointerCapture(p.id))this.canvas.releasePointerCapture(p.id);}
  release(){for(const key of this.pressed)this.push({kind:'key',key,down:false});this.pressed.clear();this.releasePointer();}
  reset(){this.release();this.events=[];}
  take(){return {events:this.events.splice(0),pressed:[...this.pressed],mouse:{...this.mouse}};}
}
