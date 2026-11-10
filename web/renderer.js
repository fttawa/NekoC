// Incremental renderer: one instanced capsule draw per pen delta, persistent FBO.
// No CPU stroke history or per-stroke draw calls. New fills are rasterized once.
const QUAD = `vec2 corner(){vec2 p[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(0,1),vec2(0,1),vec2(1,0),vec2(1,1));return p[gl_VertexID];}`;
const PEN_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec4 segment;
layout(location=1) in float thickness;
layout(location=2) in vec4 color;
uniform vec2 stageSize;
out vec2 local;flat out float lengthPx;flat out float radius;flat out vec4 tint;
${QUAD}
void main(){vec2 d=segment.zw-segment.xy;lengthPx=length(d);vec2 axis=lengthPx>.0001?d/lengthPx:vec2(1,0);radius=thickness*.5;float margin=1.5;
local=vec2(mix(-radius-margin,lengthPx+radius+margin,corner().x),mix(-radius-margin,radius+margin,corner().y));
vec2 world=segment.xy+axis*local.x+vec2(-axis.y,axis.x)*local.y;gl_Position=vec4(world/(stageSize*.5),0,1);tint=color;}`;
const PEN_FRAGMENT = `#version 300 es
precision highp float;
in vec2 local;flat in float lengthPx;flat in float radius;flat in vec4 tint;out vec4 outColor;
void main(){vec2 p=vec2(local.x-clamp(local.x,0.,lengthPx),local.y);float distanceToEdge=length(p)-radius;float aa=max(fwidth(distanceToEdge),.3);float alpha=(1.-smoothstep(-aa*.5,aa*.5,distanceToEdge))*tint.a;outColor=vec4(tint.rgb*alpha,alpha);}`;
const TEXTURE_VERTEX = `#version 300 es
precision highp float;
uniform vec2 stageSize;uniform vec2 position;uniform vec2 dimensions;uniform float angle;
out vec2 uv;${QUAD}
void main(){uv=corner();vec2 p=(uv-.5)*dimensions;float c=cos(angle),s=sin(angle);p=mat2(c,-s,s,c)*p+position;gl_Position=vec4(p/(stageSize*.5),0,1);}`;
// Sprite effects by native scope: fxA = (color, brightness, pixelate, ripple),
// fxB = (twist, grayscale). Textures are premultiplied; colour effects unpremultiply.
const TEXTURE_FRAGMENT = `#version 300 es
precision highp float;uniform sampler2D image;uniform vec4 tint;uniform vec4 fxA;uniform vec2 fxB;uniform vec2 texSize;uniform vec2 repeatUV;in vec2 uv;out vec4 outColor;
vec3 hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
vec3 rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
void main(){vec2 p=uv;
if(repeatUV.x>0.)p=fract((p-.5)*repeatUV+.5);
if(fxB.x!=0.){vec2 d=p-.5;float r=length(d)*2.;float a=radians(fxB.x)*max(0.,1.-r);float s=sin(a),c=cos(a);p=.5+mat2(c,-s,s,c)*d;}
if(fxA.w!=0.){p+=vec2(sin(p.y*25.),sin(p.x*25.))*fxA.w/2000.;}
if(abs(fxA.z)>=1.){vec2 cell=max(vec2(1.),vec2(abs(fxA.z)/10.+1.));vec2 n=texSize/cell;p=(floor(p*n)+.5)/n;}
vec4 c=(p.x<0.||p.y<0.||p.x>1.||p.y>1.)?vec4(0.):texture(image,p);
if(c.a>0.&&(fxA.x!=0.||fxB.y>0.)){vec3 r=c.rgb/c.a;
if(fxA.x!=0.){vec3 h=hsv(r);h.x=fract(h.x+fxA.x/200.);r=rgb(h);}
if(fxB.y>0.){r=mix(r,vec3(dot(r,vec3(.299,.587,.114))),clamp(fxB.y/100.,0.,1.));}
c.rgb=r*c.a;}
if(fxA.y!=0.){c.rgb=clamp(c.rgb+fxA.y/100.*c.a,0.,c.a);}
outColor=c*vec4(tint.rgb*tint.a,tint.a);}`;

function program(gl, vertex, fragment) {
  const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]].map(([type, source]) => {
    const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
    return s;
  });
  const p = gl.createProgram(); for (const s of shaders) gl.attachShader(p, s); gl.linkProgram(p);
  for (const s of shaders) gl.deleteShader(s);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(p));
  return p;
}

const MAX_SCALE = 4;

// Settle superseded loads immediately, rather than leaving their timers/events alive.
function waitForAsset(promise,signal,message){
  return new Promise((resolve,reject)=>{
    let settled=false;
    const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>done(new DOMException('素材加载已取消','AbortError'));
    const timer=setTimeout(()=>done(Error(message)),15000);
    signal.addEventListener('abort',abort,{once:true});
    promise.then(value=>done(null,value),error=>done(error));
    if(signal.aborted)abort();
  });
}

export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw Error('需要支持 WebGL 2 的浏览器。');
    this.gl = gl; this.pen = program(gl, PEN_VERTEX, PEN_FRAGMENT); this.texture = program(gl, TEXTURE_VERTEX, TEXTURE_FRAGMENT);
    this.penSize = gl.getUniformLocation(this.pen, 'stageSize');
    this.uniform = Object.fromEntries(['stageSize', 'position', 'dimensions', 'angle', 'image', 'tint', 'fxA', 'fxB', 'texSize', 'repeatUV'].map(k => [k, gl.getUniformLocation(this.texture, k)]));
    this.vao = gl.createVertexArray(); this.buffer = gl.createBuffer(); this.bufferCapacity = 0;
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (const [location, count, offset] of [[0,4,0], [1,1,16], [2,4,20]]) {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location,count,gl.FLOAT,false,36,offset); gl.vertexAttribDivisor(location,1);
    }
    gl.bindVertexArray(null); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
    this.images = new Map(); this.sprites = []; this.spriteIndices = new Map(); this.width = 900; this.height = 562; this.dirty = true;
    this.stats = { drawCalls: 0, penInstances: 0, submitMs: 0, framebufferBytes: 0, textureBytes: 0 };
    this.gpuTimer=gl.getExtension('EXT_disjoint_timer_query_webgl2');this.gpuQueries=[];this.stats.gpuMs=null;
    this.textCache = new Map(); this.textCanvas = document.createElement('canvas');
    this.stats.textTextureBytes=0; this.stats.textUploads=0; this.stats.textStamps=0;
    this.generation = 0; this.lost = false;
    this.videos=new Map();this.mediaPaused=false;
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; this.onError?.('GPU 上下文丢失，请重新加载项目。'); });
  }

  async load(project) {
    const generation = ++this.generation;
    this.loadController?.abort();this.loadController=new AbortController();const {signal}=this.loadController;
    for(const item of this.videos.values()){item.element.onseeked=null;item.element.onloadeddata=null;item.element.onerror=null;item.element.pause();item.element.removeAttribute('src');item.element.load();this.gl.deleteTexture(item.texture);}
    this.videos=new Map();this.mediaPaused=false;
    this.kitten4 = Object.hasOwn(project,'_nekocKitten4');
    const gl = this.gl;
    for(const query of this.gpuQueries)gl.deleteQuery(query);
    this.gpuQueries=[];this.stats.gpuMs=null;
    for (const item of this.images.values()) gl.deleteTexture(item.texture);
    this.images.clear();
    for(const item of this.textCache.values())gl.deleteTexture(item.texture);
    for(const item of this.spriteTexts?.values()||[])gl.deleteTexture(item.texture);this.spriteTexts?.clear();
    this.textCache.clear();this.stats.textTextureBytes=0;
    for (const surface of this.surfaces?.values() || []) { gl.deleteFramebuffer(surface.framebuffer); gl.deleteTexture(surface.texture); }
    this.surfaces = new Map();
    this.width = Number(project.stageSize?.width || 900); this.height = Number(project.stageSize?.height || 562);
    if (![this.width,this.height].every(n => Number.isFinite(n) && n >= 1 && n <= 8192)) throw Error('无效舞台尺寸');
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const scale = Math.min(this.resolutionScale === 0 ? this.displayScale() : this.resolutionScale ?? (devicePixelRatio || 1), MAX_SCALE, limit / Math.max(this.width, this.height));
    this.canvas.width = Math.ceil(this.width * scale); this.canvas.height = Math.ceil(this.height * scale);
    this.canvas.style.aspectRatio = `${this.width}/${this.height}`;
    this.stats.textureBytes = 0;
    // Every scene owns a persistent pen surface, created when first shown.
    this.scenes = project.scenes?.scenesDict || {};
    this.usePenSurface(project.scenes?.currentSceneId);
    const scene = project.scenes?.scenesDict?.[project.scenes.currentSceneId];
    this.backdrop = scene?.currentStyleId;
    this.backgroundState = null;
    this.sceneId=project.scenes?.currentSceneId;this.actorOrder=[...(scene?.actorIds||[])];if(!project._nekocKitten4)this.actorOrder.reverse();this.penLayer=0;this.videoAbovePen=false;
    this.sprites = (scene?.actorIds || []).map(id => {
      const a = project.actors.actorsDict[id];
      return { id, name:a.name, style:a.currentStyleId, x:a.position?.x||0,y:a.position?.y||0,direction:(a.rotation||0)*180/Math.PI-(this.kitten4?90:0),scale:a.scale??100,rotation_type:a.rotationType??0,visible:a.visible!==false,opacity:1 };
    });
    this.spriteIndices=new Map(this.sprites.map((a,i)=>[a.id,i]));
    this.dirty = true;
    // Costumes of every scene are decoded up front so scene switches are instant.
    const actors=project.actors?.actorsDict||{};
    const ids = [...new Set(Object.values(this.scenes).flatMap(sc=>[sc.currentStyleId,...(sc.styles||[]),...(sc.actorIds||[]).flatMap(id=>[actors[id]?.currentStyleId,...(actors[id]?.styles||[])])]).filter(Boolean))];
    await Promise.all(ids.map(async id => {
      const style = project.styles?.stylesDict?.[id]; if (!style?.url) return;
      try {
        const centerPoint={x:style.centerPoint?.x??0,y:style.centerPoint?.y??0};
        if(![centerPoint.x,centerPoint.y].every(n=>typeof n==='number'&&Number.isFinite(n)))throw Error('无效造型中心');
        const image = new Image(); image.crossOrigin = 'anonymous'; image.src = style.url;
        try { await waitForAsset(image.decode(),signal,'素材加载超时'); }
        finally { if(signal.aborted)image.removeAttribute('src'); }
        if (generation !== this.generation) return;
        if (image.naturalWidth > limit || image.naturalHeight > limit) throw Error('素材超过 GPU 纹理尺寸上限');
        const texture = this.makeTexture(1,1); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
        // One alpha byte per pixel allows transparent costume regions to pass clicks through.
        const hit=document.createElement('canvas');hit.width=image.naturalWidth;hit.height=image.naturalHeight;
        const ctx=hit.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
        const rgba=ctx.getImageData(0,0,hit.width,hit.height).data,alpha=new Uint8Array(hit.width*hit.height);
        for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
        this.images.set(id,{texture,src:image.src,width:image.naturalWidth,height:image.naturalHeight,centerPoint,adaptive:style.adaptive!==false,alpha,rgb:cellColors(rgba,hit.width,hit.height)});
        this.stats.textureBytes += image.naturalWidth * image.naturalHeight * 4;
        this.dirty = true;
      } catch(error) { if(generation===this.generation)this.onError?.(`素材 ${style.name || id}: ${error.message}`); }
    }));
    if(generation!==this.generation)return;
    // K4 ki/add_playable: successful decode uses native dimensions * scale;
    // saved width/height are fallback display dimensions, not multiplied again.
    // Video origin is the centre and y points upwards.
    await Promise.all(Object.entries(project.videos?.videosDict||{}).map(async([id,state])=>{
      if(this.skipVideos)return;
      const element=document.createElement('video');element.crossOrigin='anonymous';element.preload='auto';element.playsInline=true;
      const item={element,texture:this.makeTexture(1,1),state:{...state,id,playing:false,position:0,generation:0}};this.videos.set(id,item);
      element.onseeked=()=>{if(generation===this.generation&&this.videos.get(id)===item)this.dirty=true;};
      try{
        try{await waitForAsset(new Promise((resolve,reject)=>{
          element.onloadeddata=()=>resolve();element.onerror=()=>reject(Error('视频解码失败'));element.src=state.url;
        }),signal,'视频加载超时');}finally{element.onloadeddata=null;element.onerror=null;}
        if(generation!==this.generation)return;
        const scale=Number.isFinite(state.scale)&&state.scale>=0?state.scale:Math.min(this.width/element.videoWidth,this.height/element.videoHeight,1);
        item.displayWidth=element.videoWidth*scale;item.displayHeight=element.videoHeight*scale;
        item.state.width=item.displayWidth;item.state.height=item.displayHeight;
        this.dirty=true;
      }catch(error){if(generation===this.generation){element.onseeked=null;element.pause();element.removeAttribute('src');element.load();this.gl.deleteTexture(item.texture);this.videos.delete(id);this.onError?.(`视频 ${id}: ${error.message}`);}}
    }));
  }

  videoInfo(){return [...this.videos].filter(([,v])=>Number.isFinite(v.element.duration)&&Number.isFinite(v.displayWidth)&&Number.isFinite(v.displayHeight)).map(([id,v])=>({id,duration:v.element.duration,width:v.displayWidth,height:v.displayHeight}));}
  pauseMedia(paused=true){this.mediaPaused=paused;for(const v of this.videos.values()){if(paused)v.element.pause();else if(v.state.playing)this.playVideo(v);}}
  playVideo(v){v.element.play().catch(error=>{if(this.videos.get(v.state.id)===v&&v.state.playing&&!this.mediaPaused&&error.name!=='AbortError')this.onError?.(`视频 ${v.state.id}: ${error.message}`);});}
  applyVideos(states){
    for(const state of states||[]){const v=this.videos.get(state.id);if(!v)continue;
      const restart=v.state.generation!==state.generation,playing=state.playing&&!this.mediaPaused;
      // Running playback tolerates clock drift; a paused/stepped frame must seek
      // even a small delta, then seeked invalidates the previously drawn frame.
      if(restart||Math.abs(v.element.currentTime-state.position)>(playing ? .25 : .001))v.element.currentTime=state.position;
      const wasPlaying=v.state.playing;v.state={...state,width:v.displayWidth??v.state.width,height:v.displayHeight??v.state.height};
      if(!playing)v.element.pause();else if(restart||!wasPlaying)this.playVideo(v);
    }
    if(states?.length)this.dirty=true;
  }

  drawVideos(){
    const gl=this.gl;
    for(const v of this.videos.values()){
      const s=v.state;if(s.visible===false||v.element.readyState<2)continue;
      gl.bindTexture(gl.TEXTURE_2D,v.texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,v.element);
      this.drawTexture(v.texture,s.x||0,s.y||0,s.width,s.height);
    }
  }

  makeSurface(width,height){
    const gl=this.gl,texture=this.makeTexture(width,height),framebuffer=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    const ok=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
    if(ok){gl.viewport(0,0,width,height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    if(!ok){gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);throw Error('GPU 画笔纹理创建失败');}
    return {texture,framebuffer};
  }
  usePenSurface(sceneId){
    let surface=this.surfaces.get(sceneId);
    if(!surface){surface=this.makeSurface(this.canvas.width,this.canvas.height);this.surfaces.set(sceneId,surface);}
    this.penTexture=surface.texture;this.framebuffer=surface.framebuffer;
    this.stats.framebufferBytes=this.surfaces.size*this.canvas.width*this.canvas.height*4;
  }
  // The VM switched scenes: its sprites arrive in this frame; the scene's pen
  // drawing is kept from its last visit.
  switchScene(sceneId,transition){
    this.usePenSurface(sceneId);this.sceneId=sceneId;
    this.sprites=[];this.spriteIndices.clear();this.actorOrder=[];
    this.backdrop=this.scenes?.[sceneId]?.currentStyleId;this.dirty=true;
    this.backgroundState=null;
    if(transition&&this.canvas.animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const offset={left:'100%',right:'-100%',up:'0 100%',down:'0 -100%'}[transition.direction]||'0 0';
      const frames=/fade|distort|distrot/i.test(transition.kind)?[{opacity:0},{opacity:1}]:[{translate:offset},{translate:'0 0'}];
      this.canvas.animate(frames,{duration:/bounce/i.test(transition.kind)?520:360,easing:/bounce/i.test(transition.kind)?'cubic-bezier(.34,1.56,.64,1)':'ease-out'});
    }
  }

  // Device pixels per stage unit at the stage's current on-screen size, in half steps.
  displayScale() {
    const shown=this.canvas.getBoundingClientRect().width*(devicePixelRatio||1);
    return Math.min(Math.max(Math.ceil(shown/this.width*2)/2,1),MAX_SCALE);
  }

  // 0 follows the display and only ever grows: shrinking would discard pen detail.
  setResolution(scale) {
    if(!Number.isFinite(scale)||(scale!==0&&(scale<.5||scale>2)))throw Error('渲染倍率应为 0（跟随显示）或 0.5–2');
    this.resolutionScale=scale;
    if(!this.framebuffer||this.lost)return;
    if(scale===0)scale=Math.max(this.displayScale(),this.canvas.width/this.width);
    const gl=this.gl,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    scale=Math.min(scale,limit/Math.max(this.width,this.height));
    const width=Math.ceil(this.width*scale),height=Math.ceil(this.height*scale);
    if(width===this.canvas.width&&height===this.canvas.height)return;
    // Resize every scene's pen surface without restarting the game or losing drawings.
    const resized=new Map();
    try{for(const id of this.surfaces.keys())resized.set(id,this.makeSurface(width,height));}
    catch(error){for(const s of resized.values()){gl.deleteFramebuffer(s.framebuffer);gl.deleteTexture(s.texture);}throw Error('无法创建此分辨率的画笔图层');}
    for(const [id,old] of this.surfaces){
      const next=resized.get(id);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,next.framebuffer);
      gl.blitFramebuffer(0,0,this.canvas.width,this.canvas.height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.LINEAR);
      gl.deleteFramebuffer(old.framebuffer);gl.deleteTexture(old.texture);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    this.surfaces=resized;
    this.canvas.width=width;this.canvas.height=height;this.usePenSurface(this.sceneId);this.stats.gpuMs=null;this.dirty=true;this.render();
  }

  makeTexture(w,h) {
    const gl = this.gl, texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null); return texture;
  }

  // present=false only draws pen deltas into the persistent FBO and marks the stage
  // dirty; the caller composites once per display frame with render().
  apply(frame, lines, present = true) {
    this.applyVideos(frame.videos);
    if(typeof frame.video_above_pen==='boolean'&&frame.video_above_pen!==this.videoAbovePen){this.videoAbovePen=frame.video_above_pen;this.dirty=true;}
    this.changed = false;
    if (this.lost) return;
    if (lines.length % 9 !== 0) throw Error('损坏的画笔实例数据');
    const started = performance.now(), gl = this.gl;
    // Text and costume stamps interleave with pen lines by `before_line`.
    const fills=frame.pen_fills||[];
    const rank=(index,key)=>{
      let lo=0,hi=fills.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(fills[mid][key]<=index)lo=mid+1;else hi=mid;}
      return lo*2;
    };
    const stamps=[...(frame.text_stamps||[]).map((s,i)=>({...s,rank:rank(i,'before_text')})),...(frame.image_stamps||[]).map((s,i)=>({...s,image:true,rank:rank(i,'before_image')}))];
    for(const list of [frame.text_stamps||[],frame.image_stamps||[],frame.pen_fills||[]]){
      let last=0;
      for(const stamp of list){
        if(!Number.isInteger(stamp.before_line)||stamp.before_line<last||stamp.before_line>lines.length/9)throw Error('损坏的印章绘制顺序');
        last=stamp.before_line;
      }
    }
    // Fills carry per-kind cursors to preserve ties with text/image stamps without
    // changing old frame headers or the packed 9-float line format.
    let lastText=0,lastImage=0;
    for(const [i,fill]of fills.entries()){
      if(!Number.isInteger(fill.before_text)||fill.before_text<lastText||fill.before_text>(frame.text_stamps||[]).length||
        !Number.isInteger(fill.before_image)||fill.before_image<lastImage||fill.before_image>(frame.image_stamps||[]).length||
        !Array.isArray(fill.points)||fill.points.length<3||fill.points.length>65536||
        !fill.points.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e9))||
        !Array.isArray(fill.color)||fill.color.length!==4||!fill.color.every(v=>Number.isFinite(v)&&v>=0&&v<=1))throw Error('损坏的填充路径');
      lastText=fill.before_text;lastImage=fill.before_image;
      stamps.push({...fill,fill:true,rank:i*2+1});
    }
    stamps.sort((a,b)=>a.before_line-b.before_line||a.rank-b.rank);
    if(frame.scene&&frame.scene!==this.sceneId)this.switchScene(frame.scene,frame.transition);
    this.stats.drawCalls = 0; this.stats.penInstances = lines.length / 9;
    this.stats.textUploads=0;this.stats.textStamps=stamps.length;
    this.collectGpuTimes();
    const layerChanged=Number.isInteger(frame.pen_layer)&&frame.pen_layer!==this.penLayer;
    if(layerChanged)this.penLayer=frame.pen_layer;
    const hasDrawing=frame.clear||frame.reset||lines.length||stamps.length||frame.sprites.length||layerChanged||frame.order||frame.removed?.length;
    const query=hasDrawing&&this.gpuTimer&&this.gpuQueries.length<4?gl.createQuery():null;
    if(query)gl.beginQuery(this.gpuTimer.TIME_ELAPSED_EXT,query);
    try {
    gl.bindFramebuffer(gl.FRAMEBUFFER,this.framebuffer); gl.viewport(0,0,this.canvas.width,this.canvas.height);
    if (frame.clear) { gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); }
    if (lines.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
      if (lines.byteLength > this.bufferCapacity) {
        this.bufferCapacity = 2 ** Math.ceil(Math.log2(lines.byteLength)); gl.bufferData(gl.ARRAY_BUFFER,this.bufferCapacity,gl.DYNAMIC_DRAW);
      }
      gl.bufferSubData(gl.ARRAY_BUFFER,0,lines);
    }
    let cursor=0;
    for(const stamp of stamps){
      this.drawLines(cursor,stamp.before_line-cursor);cursor=stamp.before_line;
      if(stamp.fill)this.drawPenFill(stamp);else if(stamp.image)this.drawImageStamp(stamp);else this.drawTextStamp(stamp);
    }
    this.drawLines(cursor,lines.length/9-cursor);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    let changed=!!frame.reset||layerChanged;
    if(frame.reset){this.sprites=[];this.spriteIndices.clear();}
    // Deleted clones and layer changes (the VM sends ids back to front).
    if(frame.removed?.length){const gone=new Set(frame.removed);this.sprites=this.sprites.filter(a=>!gone.has(a.id));this.spriteIndices=new Map(this.sprites.map((a,i)=>[a.id,i]));changed=true;}
    if(Array.isArray(frame.order)){this.actorOrder=frame.order;changed=true;}
    for(const a of frame.sprites){
      if(a.id===this.sceneId){changed ||= a.style!==this.backdrop||JSON.stringify(a)!==JSON.stringify(this.backgroundState);this.backdrop=a.style;this.backgroundState=a;continue;}
      const index=this.spriteIndices.get(a.id),old=index===undefined?null:this.sprites[index];
      changed ||= !old||['style','x','y','direction','scale','visible','opacity','size_x','size_y','rotation_type'].some(k=>a[k]!==old[k])||String(a.effects)!==String(old.effects);
      if(index===undefined){this.spriteIndices.set(a.id,this.sprites.length);this.sprites.push(a);}else this.sprites[index]=a;
    }
    this.changed = changed || !!frame.clear || lines.length>0 || stamps.length>0;
    this.dirty ||= this.changed;
    if(present)this.render(false);
    } finally {if(query){gl.endQuery(this.gpuTimer.TIME_ELAPSED_EXT);this.gpuQueries.push(query);}}
    this.stats.submitMs = performance.now() - started;
  }

  collectGpuTimes(){
    if(!this.gpuTimer||this.lost||!this.gpuQueries.length)return;
    const gl=this.gl;
    if(gl.getParameter(this.gpuTimer.GPU_DISJOINT_EXT)){
      for(const query of this.gpuQueries)gl.deleteQuery(query);
      this.gpuQueries=[];this.stats.gpuMs=null;return;
    }
    while(this.gpuQueries.length&&gl.getQueryParameter(this.gpuQueries[0],gl.QUERY_RESULT_AVAILABLE)){
      const query=this.gpuQueries.shift();this.stats.gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(query);
    }
  }

  drawLines(start,count){
    if(!count)return;
    const gl=this.gl;
    gl.useProgram(this.pen);gl.uniform2f(this.penSize,this.width,this.height);
    gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);
    for(const [location,size,offset]of [[0,4,0],[1,1,16],[2,4,20]])gl.vertexAttribPointer(location,size,gl.FLOAT,false,36,start*36+offset);
    gl.drawArraysInstanced(gl.TRIANGLES,0,6,count);this.stats.drawCalls++;gl.bindVertexArray(null);
  }

  drawPenFill(fill){
    // Canvas supplies nonzero winding and antialiasing for concave/self-crossing
    // paths, just like official Rt.draw_fill_pattern; only this delta is uploaded.
    const gl=this.gl,canvas=this.fillCanvas??=document.createElement('canvas');
    const sx=this.canvas.width/this.width,sy=this.canvas.height/this.height;
    let left=this.canvas.width,right=0,top=this.canvas.height,bottom=0;
    for(const [x,y]of fill.points){const px=(x+this.width/2)*sx,py=(this.height/2-y)*sy;left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}
    left=Math.max(0,Math.floor(left)-1);right=Math.min(this.canvas.width,Math.ceil(right)+1);
    top=Math.max(0,Math.floor(top)-1);bottom=Math.min(this.canvas.height,Math.ceil(bottom)+1);
    if(right<=left||bottom<=top)return;
    canvas.width=right-left;canvas.height=bottom-top;
    const ctx=canvas.getContext('2d');
    ctx.setTransform(sx,0,0,-sy,this.canvas.width/2-left,this.canvas.height/2-top);
    ctx.fillStyle=`rgb(${fill.color.slice(0,3).map(v=>Math.round(v*255)).join(',')})`;
    ctx.beginPath();ctx.moveTo(...fill.points[0]);
    for(let i=1;i<fill.points.length;i++)ctx.lineTo(...fill.points[i]);
    ctx.closePath();ctx.fill();
    const texture=this.fillTexture??=this.makeTexture(1,1);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    this.drawTexture(texture,(left+right)/2/sx-this.width/2,this.height/2-(top+bottom)/2/sy,canvas.width/sx,canvas.height/sy);
  }

  textTexture(text,size){
    const key=JSON.stringify([text,size]),cached=this.textCache.get(key);
    if(cached){this.textCache.delete(key);this.textCache.set(key,cached);return cached;}
    const gl=this.gl,canvas=this.textCanvas,ctx=canvas.getContext('2d');
    const font=`bold ${size}px Arial, "Microsoft YaHei", sans-serif`;
    ctx.font=font;ctx.textBaseline='middle';
    const metrics=ctx.measureText(text),pad=2;
    const left=-Math.max(0,metrics.actualBoundingBoxLeft),right=Math.max(metrics.width,metrics.actualBoundingBoxRight);
    const top=-Math.max(size,metrics.actualBoundingBoxAscent),bottom=Math.max(size,metrics.actualBoundingBoxDescent);
    const width=Math.max(1,Math.ceil(right-left+2*pad)),height=Math.max(1,Math.ceil(bottom-top+2*pad));
    const bytes=width*height*4,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE),maxBytes=16*1024*1024;
    if(width>limit||height>limit||bytes>maxBytes)throw Error('文字印章超过纹理缓存上限');
    while(this.textCache.size>=128||this.stats.textTextureBytes+bytes>maxBytes){
      const [oldKey,old]=this.textCache.entries().next().value;
      gl.deleteTexture(old.texture);this.textCache.delete(oldKey);this.stats.textTextureBytes-=old.bytes;
    }
    canvas.width=width;canvas.height=height;
    ctx.font=font;ctx.textBaseline='middle';ctx.fillStyle='white';ctx.fillText(text,pad-left,pad-top);
    const texture=this.makeTexture(1,1);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    const item={texture,width,height,bytes,advance:metrics.width,dx:left-pad+width/2,dy:-(top-pad+height/2)};
    this.textCache.set(key,item);this.stats.textTextureBytes+=bytes;this.stats.textUploads++;
    return item;
  }

  // A sprite rendered as text (self_text_effect_text): centred lines, cached per look.
  spriteTextImage(look){
    const key=`${look.size}|${look.color}|${look.text}`;
    this.spriteTexts??=new Map();
    let item=this.spriteTexts.get(key);
    if(item){this.spriteTexts.delete(key);this.spriteTexts.set(key,item);return item;}
    const gl=this.gl,lines=String(look.text).split('\n'),size=Math.max(1,look.size),font=`${size}px "PingFang SC","Microsoft YaHei",sans-serif`;
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.font=font;const lineHeight=Math.ceil(size*1.25);
    const width=Math.max(1,Math.ceil(Math.max(...lines.map(line=>ctx.measureText(line).width)))),height=Math.max(1,lineHeight*lines.length);
    const limit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    canvas.width=Math.min(width,limit);canvas.height=Math.min(height,limit);
    ctx.font=font;ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillStyle=look.color||'#000000';
    lines.forEach((line,i)=>ctx.fillText(line,canvas.width/2,lineHeight*(i+.5)));
    const texture=this.makeTexture(1,1);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,alpha=new Uint8Array(canvas.width*canvas.height);
    for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
    item={texture,width:canvas.width,height:canvas.height,alpha};
    this.spriteTexts.set(key,item);
    if(this.spriteTexts.size>256){const [oldKey,old]=this.spriteTexts.entries().next().value;gl.deleteTexture(old.texture);this.spriteTexts.delete(oldKey);}
    return item;
  }
  spriteImage(a){return a.text?this.spriteTextImage(a.text):this.images.get(a.style);}

  drawImageStamp(stamp){
    const image=this.images.get(stamp.style);if(!image)return;
    const {x,y,width,height,angle}=actorGeometry(stamp,image,this.kitten4);
    this.drawTexture(image.texture,x,y,width,height,angle,[1,1,1,stamp.opacity??1],stamp.effects,[image.width,image.height]);
  }

  // Costume sizes plus opacity masks (<=128x128, 1 bit per cell) for VM collisions;
  // with `colors`, also each cell's RGB for bump_into_color.
  costumeInfo(colors=false){
    const out=[];
    for(const [id,image] of this.images){
      const mw=Math.min(image.width,128),mh=Math.min(image.height,128),bits=new Uint8Array(Math.ceil(mw*mh/8));
      for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
        const sx=Math.min(image.width-1,Math.floor((x+.5)*image.width/mw)),sy=Math.min(image.height-1,Math.floor((y+.5)*image.height/mh));
        if(image.alpha[sy*image.width+sx]>0){const bit=y*mw+x;bits[bit>>3]|=1<<(bit&7);}
      }
      let binary='';for(let i=0;i<bits.length;i+=8192)binary+=String.fromCharCode(...bits.subarray(i,i+8192));
      const info={id,width:image.width,height:image.height,centerPoint:image.centerPoint??{x:0,y:0},mask_width:mw,mask_height:mh,mask:btoa(binary)};
      if(colors&&image.rgb){let text='';for(let i=0;i<image.rgb.length;i+=8190)text+=String.fromCharCode(...image.rgb.subarray(i,i+8190));info.rgb=btoa(text);}
      out.push(info);
    }
    return out;
  }

  drawTextStamp(stamp){
    if(!stamp.text)return;
    if(this.kitten4)return this.drawK4TextStamp(stamp);
    const item=this.textTexture(stamp.text,stamp.size);
    const offset=stamp.align==='right'?item.advance:stamp.align==='center'?item.advance/2:0;
    // Keep the legacy KN stamp orientation policy.
    const angle=-stamp.direction*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=item.dx-offset,dy=item.dy;
    this.drawTexture(item.texture,stamp.x+dx*c+dy*s,stamp.y-dx*s+dy*c,item.width,item.height,angle,stamp.color);
  }

  drawK4TextStamp(stamp){
    // Rt.draw_text_stamp rasterizes AFTER rotating the Canvas context. Rotating
    // a pre-rasterized glyph texture instead applies a second interpolation and
    // changes small/CJK glyphs. Upload just the resulting pixel-aligned bounds.
    const canvas=this.stampCanvas??=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const font=`bold ${stamp.size}px Arial, "Microsoft YaHei"`,angle=stamp.direction*Math.PI/180;
    ctx.font=font;ctx.textBaseline='middle';ctx.textAlign=stamp.align;
    const m=ctx.measureText(stamp.text),c=Math.cos(angle),s=Math.sin(angle);
    const sx=this.canvas.width/this.width,sy=this.canvas.height/this.height;
    const ox=this.width/2+stamp.x,oy=this.height/2-stamp.y;
    const corners=[[-m.actualBoundingBoxLeft,-m.actualBoundingBoxAscent],[m.actualBoundingBoxRight,-m.actualBoundingBoxAscent],[-m.actualBoundingBoxLeft,m.actualBoundingBoxDescent],[m.actualBoundingBoxRight,m.actualBoundingBoxDescent]];
    const xs=corners.map(([x,y])=>(ox+c*x-s*y)*sx),ys=corners.map(([x,y])=>(oy+s*x+c*y)*sy);
    const left=Math.max(0,Math.floor(Math.min(...xs))-2),right=Math.min(this.canvas.width,Math.ceil(Math.max(...xs))+2);
    const top=Math.max(0,Math.floor(Math.min(...ys))-2),bottom=Math.min(this.canvas.height,Math.ceil(Math.max(...ys))+2);
    if(right<=left||bottom<=top)return;
    canvas.width=right-left;canvas.height=bottom-top;
    ctx.setTransform(sx,0,0,sy,-left,-top);ctx.translate(ox,oy);ctx.rotate(angle);
    ctx.font=font;ctx.textBaseline='middle';ctx.textAlign=stamp.align;
    ctx.fillStyle=`rgb(${stamp.color.slice(0,3).map(v=>Math.round(v*255)).join(',')})`;ctx.globalAlpha=stamp.color[3];ctx.fillText(stamp.text,0,0);
    const gl=this.gl,texture=this.stampTexture??=this.makeTexture(1,1);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    this.drawTexture(texture,(left+right)/2/sx-this.width/2,this.height/2-(top+bottom)/2/sy,canvas.width/sx,canvas.height/sy);
  }

  drawTexture(texture,x,y,width,height,angle=0,tint=[1,1,1,1],effects=null,texSize=null,repeatUV=null) {
    const gl=this.gl,u=this.uniform,e=effects||NO_EFFECTS;
    gl.useProgram(this.texture); gl.uniform2f(u.stageSize,this.width,this.height); gl.uniform2f(u.position,x,y);
    gl.uniform2f(u.dimensions,width,height); gl.uniform1f(u.angle,angle); gl.uniform1i(u.image,0);
    gl.uniform4fv(u.tint,tint);gl.uniform4f(u.fxA,e[0],e[2],e[3],e[4]);gl.uniform2f(u.fxB,e[5],e[6]);
    gl.uniform2f(u.texSize,texSize?.[0]||Math.abs(width)||1,texSize?.[1]||Math.abs(height)||1);
    gl.uniform2f(u.repeatUV,repeatUV?.[0]||0,repeatUV?.[1]||0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture); gl.drawArrays(gl.TRIANGLES,0,6); this.stats.drawCalls++;
  }

  render(resetStats=true) {
    if([...this.videos?.values()||[]].some(v=>v.state.visible!==false&&v.state.playing&&!this.mediaPaused))this.dirty=true;
    if (!this.dirty || this.lost || !this.penTexture) return;
    const gl=this.gl,started=performance.now(); if(resetStats)this.stats.drawCalls=0;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT);
    const backdrop=this.images.get(this.backdrop);
    if(backdrop){
      // K4 St.update_adaptive_scale uses COVER, not independent x/y stretch.
      const scale=this.kitten4&&backdrop.adaptive?Math.max(this.width/backdrop.width,this.height/backdrop.height):null;
      if(this.kitten4){
        // Background is a stage-sized TilingSprite; scale changes its tile
        // transform, not the stage rectangle (It.set_scale / St).
        const a=this.backgroundState,base=scale??1,sx=base*(a?.scale??100)/100*(a?.size_x??100)/100,sy=base*(a?.scale??100)/100*(a?.size_y??100)/100;
        if(sx&&sy)this.drawTexture(backdrop.texture,0,0,this.width,this.height,0,[1,1,1,a?.opacity??1],a?.effects,null,[this.width/(backdrop.width*sx),this.height/(backdrop.height*sy)]);
      }else this.drawTexture(backdrop.texture,0,0,this.width,this.height);
    }
    // QqDm.h=1: media container above backdrop and below actor/pen content.
    if(!this.videoAbovePen||this.penLayer>0)this.drawVideos();
    const layer=Math.min(this.penLayer,this.actorOrder.length);
    for(let i=0;i<=this.actorOrder.length;i++) {
      if(i===layer)this.drawTexture(this.penTexture,0,0,this.width,this.height);
      if(i===0&&this.videoAbovePen&&this.penLayer===0)this.drawVideos();
      const a=this.sprites[this.spriteIndices.get(this.actorOrder[i])];if(!a)continue;
      if(!a.visible)continue;
      const image=this.spriteImage(a);
      if(image){const {x,y,width,height,angle}=actorGeometry(a,image,this.kitten4);
        this.drawTexture(image.texture,x,y,width,height,angle,[1,1,1,a.opacity??1],a.effects,[image.width,image.height]);}
    }
    this.dirty=false; if(resetStats)this.stats.submitMs=performance.now()-started;
  }

  hitTest(x,y){
    for(let i=this.actorOrder.length-1;i>=0;i--){
      const a=this.sprites[this.spriteIndices.get(this.actorOrder[i])];
      if(!a?.visible||!a.scale||(a.opacity??1)<=0)continue;
      const image=this.spriteImage(a);if(!image)continue;
      const {x:cx,y:cy,width,height,angle}=actorGeometry(a,image,this.kitten4);if(!width||!height||![cx,cy,width,height,angle].every(Number.isFinite))continue;
      const c=Math.cos(angle),s=Math.sin(angle),dx=x-cx,dy=y-cy;
      const px=Math.floor((c*dx-s*dy)*image.width/width+image.width/2),py=Math.floor(image.height/2-(s*dx+c*dy)*image.height/height);
      if(px>=0&&px<image.width&&py>=0&&py<image.height&&image.alpha[py*image.width+px]>0)return a.id;
    }
    return null;
  }
}

const NO_EFFECTS=[0,0,0,0,0,0,0];
// RGB at the centre of each costume-info cell (same <=128x128 grid as the mask).
function cellColors(rgba,width,height){
  const mw=Math.min(width,128),mh=Math.min(height,128),out=new Uint8Array(mw*mh*3);
  for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
    const sx=Math.min(width-1,Math.floor((x+.5)*width/mw)),sy=Math.min(height-1,Math.floor((y+.5)*height/mh)),i=(sy*width+sx)*4,o=(y*mw+x)*3;
    out[o]=rgba[i];out[o+1]=rgba[i+1];out[o+2]=rgba[i+2];
  }
  return out;
}
/** Whether a project senses colours (bump_into_color), so costume colours are sent. */
export function sensesColor(project){return JSON.stringify(project?.actors||{}).includes('"bump_into_color"')||JSON.stringify(project?.scenes||{}).includes('"bump_into_color"');}
// Drawn size and angle: width/height percentages on top of scale, rotation type
// 0 free, 1 left-right flip (negative width), 2 upright.
export function spriteGeometry(a,image,kitten4=false){
  const scale=a.scale/100;let width=image.width*scale*(a.size_x??100)/100,height=image.height*scale*(a.size_y??100)/100,angle=a.direction*Math.PI/180;
  if(a.rotation_type===2)angle=0;
  // K4 Lt.set_rotation: heading is CCW from right, flips at [90,270).
  // Wire direction has already subtracted the K4 costume turn (90 degrees).
  else if(a.rotation_type===1){const d=((a.direction%360)+540)%360-180;angle=0;if(kitten4?(d<=-90||d>90):d<0)width=-width;}
  return {width,height,angle};
}

// Texture centre after the existing draw-angle/rotation-type policy. Pivot is
// relative to the image centre in unscaled pixels (x right, y down), not actor
// position, CSS pixels or the collision mask grid. Text images have no pivot.
function actorGeometry(a,image,kitten4=false){
  const geometry=spriteGeometry(a,image,kitten4),{width,height,angle}=geometry;
  const px=image.centerPoint?.x??0,py=image.centerPoint?.y??0;
  const dx=-px*width/image.width,dy=py*height/image.height,c=Math.cos(angle),s=Math.sin(angle);
  return {...geometry,x:a.x+c*dx+s*dy,y:a.y-s*dx+c*dy};
}

export function decodeFrame(buffer) {
  if(buffer.byteLength<4)throw Error('空帧数据');
  const length=new DataView(buffer).getUint32(0,true);
  if(length%4 || length+4>buffer.byteLength || (buffer.byteLength-length-4)%36)throw Error('无效帧数据长度');
  const frame=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,length)));
  return {frame,lines:new Float32Array(buffer,4+length)};
}
