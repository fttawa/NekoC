// Shared by the editor, standalone player and packaged extension. Events retain quick down/up pairs.
export class StageInput {
  constructor(canvas,renderer,active){
    this.canvas=canvas;this.renderer=renderer;this.active=active;this.pressed=new Set();this.events=[];this.mouse={x:0,y:0};this.pointer=null;
    canvas.addEventListener('keydown',event=>{
      if(!active()||event.ctrlKey||event.metaKey||event.altKey||event.key==='Tab')return;
      const key=String(event.keyCode);
      if(!this.pressed.has(key)){this.pressed.add(key);this.push({kind:'key',key,down:true});}
      event.preventDefault();
    });
    window.addEventListener('keyup',event=>{const key=String(event.keyCode);if(this.pressed.delete(key))this.push({kind:'key',key,down:false});});
    canvas.addEventListener('blur',()=>this.release());window.addEventListener('blur',()=>this.release());
    canvas.addEventListener('pointermove',event=>{
      this.position(event);
      // Dragging a draggable sprite moves it in the VM.
      const p=this.pointer;
      if(p?.drag&&p.id===event.pointerId)this.push({kind:'drag',target:p.drag.id,x:this.mouse.x-p.offset.x,y:this.mouse.y-p.offset.y});
    });
    canvas.addEventListener('pointerdown',event=>{
      if(!active()||event.button!==0||!event.isPrimary)return;
      canvas.focus({preventScroll:true});this.position(event);
      const target=renderer.hitTest(this.mouse.x,this.mouse.y),sprite=target&&renderer.sprites.find(a=>a.id===target);
      this.pointer={id:event.pointerId,target,start:{...this.mouse,time:performance.now()},
        drag:sprite?.draggable?sprite:null,offset:sprite?{x:this.mouse.x-sprite.x,y:this.mouse.y-sprite.y}:null};
      canvas.setPointerCapture(event.pointerId);this.pointerEvent('mouse_down',this.pointer.target);event.preventDefault();
    });
    canvas.addEventListener('pointerup',event=>{
      if(this.pointer?.id!==event.pointerId)return;
      this.position(event);const target=renderer.hitTest(this.mouse.x,this.mouse.y),down=this.pointer.target,start=this.pointer.start,dragged=this.pointer.drag;this.pointer=null;
      // A quick stroke of at least 40 stage units is a swipe.
      const dx=this.mouse.x-start.x,dy=this.mouse.y-start.y;
      if(!dragged&&performance.now()-start.time<700&&Math.hypot(dx,dy)>=40)this.push({kind:'swipe',direction:Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'up':'down')});
      this.pointerEvent('mouse_up',target);
      const box=canvas.getBoundingClientRect();
      if(event.clientX>=box.left&&event.clientX<box.right&&event.clientY>=box.top&&event.clientY<box.bottom)this.pointerEvent('mouse_click',target===down?target:null);
      if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointercancel',()=>this.release());
  }
  push(event){if(this.events.length<256)this.events.push(event);}
  position(event){const box=this.canvas.getBoundingClientRect();if(box.width&&box.height)this.mouse={x:(event.clientX-box.left)/box.width*this.renderer.width-this.renderer.width/2,y:this.renderer.height/2-(event.clientY-box.top)/box.height*this.renderer.height};}
  pointerEvent(state,target){this.push({kind:'pointer',state,target:target||'',...this.mouse});}
  release(){for(const key of this.pressed)this.push({kind:'key',key,down:false});this.pressed.clear();if(this.pointer){this.pointerEvent('mouse_up',this.pointer.target);this.pointer=null;}}
  reset(){this.release();this.events=[];}
  take(){return {events:this.events.splice(0),pressed:[...this.pressed],mouse:{...this.mouse}};}
}
