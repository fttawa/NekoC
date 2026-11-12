// Incremental renderer with a persistent FBO: KN instanced capsules, K4 Canvas
// origin disks + closed strokes. No retained CPU stroke history.
import { drawK4PenLines } from './pen-k4.js';
// Transition helpers stay here to avoid another dependency in visual harnesses.
const quadOut = t => 1 - (1 - t) ** 2;
function bounceOut(t) {
  const scale=121/16,unit=11/4;
  if(t<1/unit)return scale*t*t;
  if(t<2/unit)return scale*(t-1.5/unit)**2+3/4;
  if(t<2.5/unit)return scale*(t-2.25/unit)**2+15/16;
  return scale*(t-2.625/unit)**2+63/64;
}
export function transitionKind(transition){
  let kind=transition?.kind||'none';
  if(kind==='fadeInOut')kind='fade_in_out';
  if(kind==='distrot')kind='distort';
  if(kind==='slide'||kind==='bounce')kind+=`_${transition.direction}`;
  return kind;
}
// Display-tree coordinates (positive y down), independently implemented from the
// observed container properties. VM actor coordinates still point upwards.
export function sampleTransition(transition,ms,width,height){
  const kind=transitionKind(transition);
  const outgoing={x:0,y:0,alpha:1,visible:true},incoming={x:0,y:0,alpha:1,visible:true};
  const result={outgoing,incoming,active:true,incomingOnTop:kind.startsWith('bounce_')};
  const match=/^(slide|bounce)_(up|down|left|right)$/.exec(kind);
  if(match){
    const [,mode,direction]=match,duration=mode==='slide'?500:1000;
    if(ms>duration)result.active=false;
    else{
      const p=(mode==='slide'?quadOut:bounceOut)(Math.max(0,ms)/duration);
      const dx=direction==='left'?width:direction==='right'?-width:0;
      const dy=direction==='up'?height:direction==='down'?-height:0;
      incoming.x=dx*(1-p);incoming.y=dy*(1-p);
      if(mode==='slide'){outgoing.x=-dx*p;outgoing.y=-dy*p;}
    }
  }else if(kind==='fade_in_out'){
    if(ms>500)result.active=false;
    else{incoming.alpha=quadOut(Math.max(0,ms)/500);outgoing.alpha=1-incoming.alpha;}
  }else if(kind==='none'||!kind)result.active=false;
  else if(kind==='distort'){
    // Two frozen full-stage screenshots, with independently delayed tweens.
    // The outgoing tween retains its last (unclamped) overshoot until cleanup.
    const out=quadOut(Math.max(0,Math.min(ms,transition.outEnd??ms))/500);
    const into=quadOut(Math.max(0,ms-100)/500);
    outgoing.alpha=1-out;incoming.alpha=into;
    outgoing.angle=-227.8*Math.PI/180*out;
    incoming.angle=189*Math.PI/180*(1-into);
    result.active=ms<=600;result.screenshots=true;
  }else{
    // Unknown names never invoke official completion. Logical scene changes,
    // while the previous scene stays visible (no tween is scheduled).
    incoming.visible=false;result.stalled=true;
  }
  if(!result.active){outgoing.visible=false;incoming.visible=true;}
  return result;
}
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
precision highp float;uniform sampler2D image;uniform vec4 tint;uniform bool packedTint;uniform vec4 fxA;uniform vec2 fxB;uniform vec3 hueWeights;uniform vec2 saturationWeights;uniform vec2 texSize;uniform vec2 repeatUV;uniform bool kitten4;in vec2 uv;out vec4 outColor;
vec3 hsv(vec3 c){vec4 K=vec4(0.,-1./3.,2./3.,-1.);vec4 p=mix(vec4(c.bg,K.wz),vec4(c.gb,K.xy),step(c.b,c.g));vec4 q=mix(vec4(p.xyw,c.r),vec4(c.r,p.yzx),step(p.x,c.r));float d=q.x-min(q.w,q.y);return vec3(abs(q.z+(q.w-q.y)/(6.*d+1e-10)),d/(q.x+1e-10),q.x);}
vec3 rgb(vec3 c){vec3 p=abs(fract(c.xxx+vec3(1.,2./3.,1./3.))*6.-3.);return c.z*mix(vec3(1.),clamp(p-1.,0.,1.),c.y);}
void main(){vec2 p=uv;
if(repeatUV.x>0.)p=fract((p-.5)*repeatUV+.5);
if(fxB.x!=0.){vec2 d=p-.5;float r=length(d)*2.;float a=radians(fxB.x)*max(0.,1.-r);float s=sin(a),c=cos(a);p=.5+mat2(c,-s,s,c)*d;}
if(fxA.w!=0.){p+=vec2(sin(p.y*25.),sin(p.x*25.))*fxA.w/2000.;}
if(abs(fxA.z)>=1.){vec2 cell=max(vec2(1.),vec2(abs(fxA.z)/10.+1.));vec2 n=texSize/cell;p=(floor(p*n)+.5)/n;}
vec4 c=(p.x<0.||p.y<0.||p.x>1.||p.y>1.)?vec4(0.):texture(image,p);
// K4 applies world alpha when rasterizing the filter's input, before its
// colour matrices. Matrix outputs may legitimately exceed the alpha channel.
float alpha=tint.a;
if(kitten4&&(fxA.x!=0.||fxA.y!=0.||fxB.y>0.)){c=floor(c*alpha*255.+.5)/255.;alpha=1.;}
// K4 jt uses PIXI colour matrices, ordered hue -> brightness -> saturate.
// Each pass clamps/quantizes its premultiplied RGBA8 intermediate, not RGB.
// See docs/kitten4-visual3.md. KN retains its existing HSV/weighted-gray policy.
if(kitten4&&c.a>0.){vec3 r=c.rgb/c.a;
if(fxA.x!=0.){r=vec3(dot(r,hueWeights),dot(r,hueWeights.zxy),dot(r,hueWeights.yzx));r=floor(clamp(r*c.a,0.,1.)*255.+.5)/255./c.a;}
if(fxA.y!=0.)r=floor(clamp((r+clamp(fxA.y/100.,-1.,1.))*c.a,0.,1.)*255.+.5)/255./c.a;
if(fxB.y>0.)r=vec3(dot(r,saturationWeights.xyy),dot(r,saturationWeights.yxy),dot(r,saturationWeights.yyx));
c.rgb=r*c.a;
}else{
if(c.a>0.&&(fxA.x!=0.||fxB.y>0.)){vec3 r=c.rgb/c.a;
if(fxA.x!=0.){vec3 h=hsv(r);h.x=fract(h.x+fxA.x/200.);r=rgb(h);}
if(fxB.y>0.){r=mix(r,vec3(dot(r,vec3(.299,.587,.114))),clamp(fxB.y/100.,0.,1.));}
c.rgb=r*c.a;}
if(fxA.y!=0.){c.rgb=clamp(c.rgb+fxA.y/100.*c.a,0.,c.a);}}
outColor=c*(packedTint?tint:vec4(tint.rgb*alpha,alpha));}`;

// Original screen-space resampling passes. K4 filters rasterize the transformed
// actor first: cells remain aligned to the filter rectangle, even on rotation.
const K4_FILTER_VERTEX = `#version 300 es
precision highp float;
uniform vec2 stageSize;uniform vec2 position;uniform vec2 dimensions;uniform float angle;uniform vec2 origin;uniform vec2 extent;
out vec2 uv;
void main(){vec2 corners[6]=vec2[6](vec2(0,0),vec2(1,0),vec2(1,1),vec2(0,0),vec2(1,1),vec2(0,1));vec2 p=corners[gl_VertexID];uv=p*dimensions/extent;vec2 scale=vec2(2.,-2.)/stageSize;vec2 translation=vec2(-1.,1.)+position*scale;gl_Position=vec4((origin+p*dimensions)*scale+translation,0.,1.);}`;
const K4_SPATIAL_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D image;uniform vec2 extent;uniform vec2 center;uniform vec2 origin;
uniform float amount;uniform float radius;uniform bool twist;uniform bool ascii;
in vec2 uv;out vec4 outColor;
// Original row masks drawn from the observed 5x5 glyphs, ordered by luminance.
// Keeping rows separate avoids float bit-packing precision dependencies.
uint glyphRow(int level,int row){
 if(level==0)return uint[5](0u,0u,0u,2u,0u)[row];
 if(level==1)return uint[5](0u,2u,0u,2u,0u)[row];
 if(level==2)return uint[5](4u,31u,4u,10u,0u)[row];
 if(level==3)return uint[5](14u,17u,17u,17u,14u)[row];
 if(level==4)return uint[5](12u,2u,21u,9u,22u)[row];
 if(level==5)return uint[5](14u,17u,14u,17u,14u)[row];
 if(level==6)return uint[5](28u,2u,26u,18u,12u)[row];
 return uint[5](10u,31u,10u,31u,10u)[row];
}
void main(){vec2 q=uv*extent;
vec2 cell=mod(q+origin,amount)/amount;
if(twist){vec2 d=q-center;float r=length(d);if(r<radius){float falloff=(radius-r)/radius;float a=falloff*falloff*amount,s=sin(a),c=cos(a);d=vec2(c*d.x-s*d.y,s*d.x+c*d.y);}q=clamp(center+d,vec2(.5),extent-.5);}
else q=floor((q+origin)/amount)*amount-origin;
if(!twist)q=max(q,vec2(.5));
vec2 p=vec2(q.x/extent.x,1.-q.y/extent.y);
outColor=(q.x<0.||q.y<0.||q.x>extent.x||q.y>extent.y)?vec4(0.):texture(image,p);
if(ascii){float gray=(outColor.r+outColor.g+outColor.b)/3.;int level=0;
 for(int i=2;i<=8;i++)if(gray>float(i)/10.)level=i-1;
 ivec2 dotPosition=ivec2(floor((cell*2.-1.)*vec2(4.,-4.)+2.5));
 if(any(lessThan(dotPosition,ivec2(0)))||any(greaterThan(dotPosition,ivec2(4))))outColor=vec4(0.);
 else outColor*=float((glyphRow(level,dotPosition.y)>>uint(dotPosition.x))&1u);
  }}`;

// Independent three-channel affine matrix pass. Keep rasterization, each colour
// operation and its RGBA8 storage separate; no gamma conversion is involved.
const K4_COLOR_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D image;uniform vec3 rowR;uniform vec3 rowG;uniform vec3 rowB;uniform float bias;
in vec2 uv;out vec4 outColor;
void main(){vec4 c=texture(image,vec2(uv.x,1.-uv.y));vec3 straight=c.a>0.?c.rgb/c.a:c.rgb;
vec3 result=vec3(rowR.x*straight.r,rowG.x*straight.r,rowB.x*straight.r);
result+=vec3(rowR.y*straight.g,rowG.y*straight.g,rowB.y*straight.g);
result+=vec3(rowR.z*straight.b,rowG.z*straight.b,rowB.z*straight.b);
outColor=vec4((result+bias)*c.a,c.a);}`;

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
    this.k4Spatial = program(gl,K4_FILTER_VERTEX,K4_SPATIAL_FRAGMENT);
    this.k4SpatialUniform=Object.fromEntries(['stageSize','position','dimensions','angle','image','extent','center','origin','amount','radius','twist','ascii'].map(k=>[k,gl.getUniformLocation(this.k4Spatial,k)]));
    this.k4Color=program(gl,K4_FILTER_VERTEX,K4_COLOR_FRAGMENT);
    this.k4ColorUniform=Object.fromEntries(['stageSize','position','dimensions','extent','origin','image','rowR','rowG','rowB','bias'].map(k=>[k,gl.getUniformLocation(this.k4Color,k)]));
    this.penSize = gl.getUniformLocation(this.pen, 'stageSize');
    this.uniform = Object.fromEntries(['stageSize', 'position', 'dimensions', 'angle', 'image', 'tint', 'packedTint', 'fxA', 'fxB', 'hueWeights', 'saturationWeights', 'texSize', 'repeatUV', 'kitten4'].map(k => [k, gl.getUniformLocation(this.texture, k)]));
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
    this.transitionClock=()=>performance.now();
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; this.onError?.('GPU 上下文丢失，请重新加载项目。'); });
  }

  async load(project, onProgress=()=>{}) {
    this.clearSceneTransition();
    const generation = ++this.generation;
    this.loadController?.abort();this.loadController=new AbortController();const {signal}=this.loadController;
    for(const item of this.videos.values()){item.element.onseeked=null;item.element.onloadeddata=null;item.element.onerror=null;item.element.pause();item.element.removeAttribute('src');item.element.load();this.gl.deleteTexture(item.texture);}
    this.videos=new Map();this.mediaPaused=false;
    this.kitten4 = Object.hasOwn(project,'_nekocKitten4');
    this.monitorDeclarations=project.variables?.variablesDict||{};
    this.cloudDeclarations=project._nekocKitten4?.source?.cloud_variables||{};
    this.cloudListViews=new Map();
    this.monitorOwners={...project.scenes?.scenesDict,...project.actors?.actorsDict};
    const gl = this.gl;
    for(const entry of this.k4FilterCache?.values()||[])for(const surface of entry.surfaces){gl.deleteFramebuffer(surface.framebuffer);gl.deleteTexture(surface.texture);}
    this.k4FilterCache=new Map();this.stats.k4FilterBytes=0;
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
    const videos=this.skipVideos?[]:Object.entries(project.videos?.videosDict||{});
    const total=ids.length+videos.length;let completed=0;
    const progress=()=>{if(generation===this.generation)onProgress({completed,total});};progress();
    await Promise.all(ids.map(async id => {
      const style = project.styles?.stylesDict?.[id];
      try {
        if(!style?.url)throw Error('缺少素材地址');
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
        const ctx=hit.getContext('2d',this.kitten4?undefined:{willReadFrequently:true});
        if(this.kitten4&&/^data:image\/svg\+xml/i.test(style.url)){
          // Explicit source/destination rectangles select the SVG raster path
          // observed in native SVGResource; the 3-argument overload differs at
          // diagonal antialiasing edges in Chromium.
          ctx.drawImage(image,0,0,image.naturalWidth,image.naturalHeight,0,0,hit.width,hit.height);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,hit);
        }else ctx.drawImage(image,0,0);
        const rgba=ctx.getImageData(0,0,hit.width,hit.height).data,alpha=new Uint8Array(hit.width*hit.height);
        for(let i=0;i<alpha.length;i++)alpha[i]=rgba[i*4+3];
        this.images.set(id,{texture,src:image.src,source:hit,width:image.naturalWidth,height:image.naturalHeight,centerPoint,adaptive:style.adaptive!==false,alpha,rgb:cellColors(rgba,hit.width,hit.height)});
        this.stats.textureBytes += image.naturalWidth * image.naturalHeight * 4;
        this.dirty = true;
      } catch(error) { if(generation===this.generation)this.onError?.(`素材 ${style?.name || id}: ${error.message}`); }
      finally{completed++;progress();}
    }));
    if(generation!==this.generation)return;
    // K4 ki/add_playable: successful decode uses native dimensions * scale;
    // saved width/height are fallback display dimensions, not multiplied again.
    // Video origin is the centre and y points upwards.
    await Promise.all(videos.map(async([id,state])=>{
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
      finally{completed++;progress();}
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
    if(this.kitten4){
      this.clearSceneTransition();
      if(transition&&transitionKind(transition)!=='none'){
        const kind=transitionKind(transition);
        const old={sceneId:this.sceneId,backdrop:this.backdrop,backgroundState:this.backgroundState,
          sprites:this.sprites,spriteIndices:new Map(this.spriteIndices),actorOrder:this.actorOrder,
          penTexture:this.penTexture,penLayer:this.penLayer};
        this.sceneTransition={transition,start:this.transitionClock(),old,
          // Scene order is the project order except bounce, which raises entry.
          incomingOnTop:kind.startsWith('bounce_')||Object.keys(this.scenes).indexOf(sceneId)>Object.keys(this.scenes).indexOf(this.sceneId)};
      }
    }
    this.usePenSurface(sceneId);this.sceneId=sceneId;
    this.sprites=[];this.spriteIndices.clear();this.actorOrder=[];
    this.backdrop=this.scenes?.[sceneId]?.currentStyleId;this.dirty=true;
    this.backgroundState=null;
    if(!this.kitten4&&transition&&this.canvas.animate&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
      const offset={left:'100%',right:'-100%',up:'0 100%',down:'0 -100%'}[transition.direction]||'0 0';
      const frames=/fade|distort|distrot/i.test(transition.kind)?[{opacity:0},{opacity:1}]:[{translate:offset},{translate:'0 0'}];
      this.canvas.animate(frames,{duration:/bounce/i.test(transition.kind)?520:360,easing:/bounce/i.test(transition.kind)?'cubic-bezier(.34,1.56,.64,1)':'ease-out'});
    }
  }

  clearSceneTransition(){
    if(!this.sceneTransition)return;
    for(const surface of this.sceneTransition.screenshots||[]){
      this.gl.deleteFramebuffer(surface.framebuffer);this.gl.deleteTexture(surface.texture);
    }
    const input=this.sceneTransition.filterInput;
    if(input){this.gl.deleteFramebuffer(input.framebuffer);this.gl.deleteTexture(input.texture);}
    this.sceneTransition=null;this.dirty=true;
  }

  drawDistortTransition(transition,state){
    const gl=this.gl,w=this.canvas.width,h=this.canvas.height;
    if(!transition.screenshots){
      const surfaces=[];
      try{
        for(const scene of [transition.old,this]){
          const surface=this.makeSurface(w,h);surfaces.push(surface);
          this.drawScene(surface.framebuffer,scene);
        }
      }catch(error){for(const s of surfaces){gl.deleteFramebuffer(s.framebuffer);gl.deleteTexture(s.texture);}throw error;}
      transition.screenshots=surfaces;
    }
    if(!this.distortProgram){
      // Original shader derived from radial inverse mapping; native evidence:
      // a1xw/Et screenshot lifetime, lvVU/TwistFilter radius and squared falloff.
      this.distortProgram=program(gl,K4_FILTER_VERTEX,`#version 300 es
precision highp float;uniform sampler2D image;uniform vec2 extent;uniform vec2 center;uniform vec2 origin;uniform float radius;uniform float turn;in vec2 uv;out vec4 outColor;
void main(){vec2 p=uv*extent+origin;vec2 d=p-center;float r=length(d);if(r<radius){float t=(radius-r)/radius;float a=t*t*turn;float c=cos(a),s=sin(a);d=vec2(c*d.x-s*d.y,s*d.x+c*d.y);}vec2 q=(center+d-origin)/extent;outColor=texture(image,vec2(q.x,1.-q.y));}`);
      this.distortUniform=Object.fromEntries(['stageSize','position','dimensions','image','extent','center','origin','radius','turn'].map(k=>[k,gl.getUniformLocation(this.distortProgram,k)]));
    }
    // The destination scene remains live underneath both screenshot sprites.
    this.drawScene();
    // Native screenshot sprites rasterize world alpha BEFORE the twist, into a
    // padded RGBA8 filter input. Multiplying after interpolation is not equal.
    const sx=w/this.width,sy=h/this.height,pad=10;
    const fw=2**Math.ceil(Math.log2(w+2*pad*sx)),fh=2**Math.ceil(Math.log2(h+2*pad*sy));
    if(!transition.filterInput)transition.filterInput=this.makeSurface(fw,fh);
    const u=this.distortUniform;
    for(const [i,s]of [state.outgoing,state.incoming].entries()){
      gl.bindFramebuffer(gl.FRAMEBUFFER,transition.filterInput.framebuffer);gl.viewport(0,0,fw,fh);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      const stageW=this.width,stageH=this.height;this.width=fw/sx;this.height=fh/sy;
      const alpha=Math.max(0,Math.min(1,s.alpha)),rgb=Math.round(alpha*255)/255;
      try{this.drawTexture(transition.screenshots[i].texture,pad+stageW/2-this.width/2,this.height/2-pad-stageH/2,stageW,stageH,0,[rgb,rgb,rgb,Math.floor(alpha*255)/255],null,null,null,null,true);}
      finally{this.width=stageW;this.height=stageH;}
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,w,h);
      gl.useProgram(this.distortProgram);gl.uniform2f(u.stageSize,w,h);gl.uniform2f(u.position,0,0);
      gl.uniform2f(u.dimensions,w+2*pad*sx,h+2*pad*sy);gl.uniform1i(u.image,0);gl.uniform2f(u.extent,fw,fh);
      gl.uniform2f(u.origin,-pad*sx,-pad*sy);gl.uniform2f(u.center,w/2,h/2);gl.uniform1f(u.radius,Math.min(w,h));
      gl.uniform1f(u.turn,s.angle);gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,transition.filterInput.texture);gl.drawArrays(gl.TRIANGLES,0,6);this.stats.drawCalls++;
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
    this.clearSceneTransition();
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
    this.k4PenLines=lines;
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
      if(a.soft_mesh!=null)validateSoftMesh(a.soft_mesh);
      if(a.id===this.sceneId){changed ||= a.style!==this.backdrop||JSON.stringify(a)!==JSON.stringify(this.backgroundState);this.backdrop=a.style;this.backgroundState=a;continue;}
      const index=this.spriteIndices.get(a.id),old=index===undefined?null:this.sprites[index];
      changed ||= !old||['style','x','y','direction','scale','visible','opacity','size_x','size_y','rotation_type'].some(k=>a[k]!==old[k])||String(a.effects)!==String(old.effects)||JSON.stringify(a.soft_mesh)!==JSON.stringify(old.soft_mesh);
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
    if(this.kitten4)return drawK4PenLines(this,this.k4PenLines,start,count);
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
    item={texture,source:canvas,width:canvas.width,height:canvas.height,alpha};
    this.spriteTexts.set(key,item);
    if(this.spriteTexts.size>256){const [oldKey,old]=this.spriteTexts.entries().next().value;gl.deleteTexture(old.texture);this.spriteTexts.delete(oldKey);}
    return item;
  }
  spriteImage(a){return a.text?this.spriteTextImage(a.text):this.images.get(a.style);}

  // K4 $n/ti: saved positions are top-left anchors in stage coordinates, not
  // a flex list. Original Canvas drawing of the common scalar skin; no vendor
   // textures or fonts bundled. Non-cloud list/icon skins retain DOM fallback.
  monitorCanvas(monitor,ui){
    const cloud=this.cloudDeclarations?.[monitor.id];
    const state=cloud||this.monitorDeclarations?.[monitor.id];
    if(!this.kitten4||!state)return null;
    if(cloud&&monitor.list)return this.cloudListCanvas(monitor,state,ui?.lists?.[monitor.id]||[]);
    if(monitor.list||(state.theme||'common')!=='common')return null;
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const font='18px "NotoSansCJKsc-Medium", "NotoSansCJKsc"';ctx.font=font;
    const prefix=state.current_entity?`${this.monitorOwners?.[state.current_entity]?.name||''}·`:'';
    const prefixWidth=prefix?Math.ceil(ctx.measureText(prefix).width):0,nameWidth=Math.ceil(ctx.measureText(monitor.name).width),valueWidth=monitor.value?Math.ceil(ctx.measureText(monitor.value).width):6;
    const width=prefixWidth+nameWidth+valueWidth+50,height=52;
    canvas.width=width;canvas.height=height;ctx.font=font;
    const rounded=(x,y,w,h,r,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();};
    rounded(0,0,width,height,11,'#ffad48');
    rounded(prefixWidth+nameWidth+20,10,valueWidth+20,32,11,'#fff');
    ctx.fillStyle='#523939';ctx.fillText(prefix,10,33);
    ctx.fillStyle='#fff';ctx.fillText(monitor.name,10+prefixWidth,33);
    ctx.fillStyle='#000';ctx.fillText(monitor.value,30+prefixWidth+nameWidth,33);
    const scale=Number.isFinite(state.scale)?state.scale:1;
    const position=state.position||{x:10-this.width/2,y:this.height/2-10};
    canvas.className='neko-monitor k4-common';
    canvas.style.cssText=`position:absolute;display:block;border:0;border-radius:0;background:transparent;max-width:none;left:calc(${this.width/2+position.x} * var(--neko-unit));top:calc(${this.height/2-position.y} * var(--neko-unit));width:calc(${width*scale} * var(--neko-unit));height:calc(${height*scale} * var(--neko-unit))`;
    canvas.setAttribute('aria-label',`${prefix}${monitor.name}: ${monitor.value}`);
    return canvas;
  }

  cloudListCanvas(monitor,state,items){
    // Independent Canvas skin from measured PIXI geometry (Yn/di), not vendor assets.
    const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
    const bodyWidth=170+Math.max(0,state.offset?.x||0),bodyHeight=180+Math.floor(Math.max(0,state.offset?.y||0)/45)*45;
    const width=bodyWidth+18,height=bodyHeight+68;
    canvas.width=width;canvas.height=height;
    const rounded=(x,y,w,h,r,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x,y,w,h,r);ctx.fill();};
    rounded(1,1,width-2,height-2,20,'#ffaa2f');
    ctx.strokeStyle='#ccc';ctx.lineWidth=2;ctx.stroke();
    const font='500 20px "PingFangSC-Medium", "PingFang SC"';ctx.font=font;
    const ellipsis=(text,max)=>{text=String(text);if(Math.ceil(ctx.measureText(text).width)<=max)return text;let result='';for(const c of text){if(Math.ceil(ctx.measureText(result+c).width)+Math.ceil(ctx.measureText('...').width)>max)break;result+=c;}return result+'...';};
    const title=ellipsis(monitor.name,bodyWidth-32),titleWidth=Math.ceil(ctx.measureText(title).width);
    const textureText=(text,x,y,color)=>{
      const lines=String(text).split(/\r\n|\r|\n/),font=ctx.font;
      const texture=document.createElement('canvas'),tc=texture.getContext('2d');tc.font=font;
      texture.width=Math.max(6,...lines.map(line=>Math.ceil(tc.measureText(line).width)));
      const lineHeight=font.startsWith('500')?25:23;texture.height=lineHeight*lines.length;
      tc.font=font;tc.fillStyle=color;lines.forEach((line,i)=>tc.fillText(line,0,(font.startsWith('500')?20:18)+i*lineHeight));
      ctx.drawImage(texture,x,y);
    };
    textureText(title,1+(bodyWidth+16-titleWidth)/2,13,'#fff');
    rounded(9,59,bodyWidth,bodyHeight,10,'#fff');
    ctx.save();ctx.clip();
    const rows=bodyHeight/45;
    const view=this.cloudListViews.get(monitor.id)||{index:0,hadItems:false};
    view.hadItems||=items.length>0;
    let index=Math.max(0,Math.min(Math.max(0,items.length-rows),view.index));this.cloudListViews.set(monitor.id,view);
    const paint=()=>{
      ctx.clearRect(9,59,bodyWidth,bodyHeight);ctx.fillStyle='#fff';ctx.fillRect(9,59,bodyWidth,bodyHeight);
      if(!items.length){ctx.font='bold 16px "STHeitiSC-Medium", "Microsoft YaHei"';ctx.fillStyle='#000';ctx.fillText('空',9+bodyWidth/2-8,85);if(!view.hadItems)rounded(9,69,5,112,2.5,'#a3afbf4d');return;}
      ctx.font='bold 17.5px "STHeitiSC-Medium", "Microsoft YaHei"';
      const orderWidth=ctx.measureText(String(Math.min(index+rows,items.length))).width;
      for(let r=0;r<rows;r++){
        const at=index+r,y=59+r*45;
        ctx.fillStyle=r%2?'#f4f5f7':'#fff';ctx.fillRect(9,y,bodyWidth,45);
        if(at>=items.length)continue;
        ctx.fillStyle='#0000007f';ctx.fillText(String(at+1),14,y+29);
        textureText(ellipsis(items[at],bodyWidth-10-45-orderWidth),29+orderWidth,y+11,'#43372e');
      }
      if(items.length>rows){const range=bodyHeight-150,step=range/(items.length-rows);rounded(9+bodyWidth-10,69+index*step,5,112,2.5,'#a3afbf4d');}
    };
    paint();ctx.restore();
    // The resize affordance is an original triangle, not an embedded texture.
    ctx.fillStyle='#000';ctx.beginPath();ctx.moveTo(166,228);ctx.lineTo(174,219);ctx.lineTo(176,219);ctx.lineTo(176,229);ctx.lineTo(166,229);ctx.closePath();ctx.fill();
    const position=state.position||{x:10-this.width/2,y:this.height/2-10};
    canvas.className='neko-monitor k4-cloud-list';
    canvas.style.cssText=`position:absolute;display:block;border:0;border-radius:0;background:transparent;max-width:none;pointer-events:auto;left:calc(${this.width/2+position.x-1} * var(--neko-unit));top:calc(${this.height/2-position.y-1} * var(--neko-unit));width:calc(${width} * var(--neko-unit));height:calc(${height} * var(--neko-unit))`;
    canvas.setAttribute('aria-label',`${monitor.name}: ${items.length} items`);
    let dragY;
    canvas.onpointerdown=e=>{e.stopPropagation();dragY=e.clientY;canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{if(dragY===undefined)return;e.stopPropagation();const delta=Math.trunc((dragY-e.clientY)/(45*canvas.clientWidth/width));if(delta){index=Math.max(0,Math.min(Math.max(0,items.length-rows),index+delta));view.index=index;dragY=e.clientY;ctx.save();ctx.beginPath();ctx.roundRect(9,59,bodyWidth,bodyHeight,10);ctx.clip();paint();ctx.restore();}};
    canvas.onpointerup=e=>{e.stopPropagation();dragY=undefined;};
    canvas.onpointercancel=()=>{dragY=undefined;};
    return canvas;
  }

  drawImageStamp(stamp){
    const image=this.images.get(stamp.style);if(!image)return;
    if(this.kitten4&&image.source)return this.drawK4ImageStamp(stamp,image);
    const {x,y,width,height,angle}=this.kitten4?k4ImageStampGeometry(stamp,image):actorGeometry(stamp,image,false);
    this.drawTexture(image.texture,x,y,width,height,angle,[1,1,1,stamp.opacity??1],stamp.effects,[image.width,image.height]);
  }

  drawK4ImageStamp(stamp,image){
    // The native brush rasterizes the transformed destination in Canvas. A
    // transformed GL quad has different edge coverage on rotated/alpha stamps.
    const g=k4ImageStampGeometry(stamp,image),sx=this.canvas.width/this.width,sy=this.canvas.height/this.height;
    const c=Math.cos(g.angle),s=Math.sin(g.angle),w=Math.abs(g.width),h=Math.abs(g.height);
    if(!w||!h)return;
    const ox=this.width/2+g.x,oy=this.height/2-g.y;
    const corners=[[-w/2,-h/2],[w/2,-h/2],[-w/2,h/2],[w/2,h/2]];
    const xs=corners.map(([x,y])=>(ox+c*x-s*y)*sx),ys=corners.map(([x,y])=>(oy+s*x+c*y)*sy);
    const left=Math.max(0,Math.floor(Math.min(...xs))-2),right=Math.min(this.canvas.width,Math.ceil(Math.max(...xs))+2);
    const top=Math.max(0,Math.floor(Math.min(...ys))-2),bottom=Math.min(this.canvas.height,Math.ceil(Math.max(...ys))+2);
    if(right<=left||bottom<=top)return;
    const canvas=this.stampCanvas??=document.createElement('canvas'),ctx=canvas.getContext('2d');
    canvas.width=right-left;canvas.height=bottom-top;
    ctx.setTransform(sx,0,0,sy,-left,-top);ctx.translate(ox,oy);ctx.rotate(g.angle);
    ctx.scale(Math.sign(g.width),Math.sign(g.height));ctx.drawImage(image.source,-w/2,-h/2,w,h);
    const gl=this.gl,texture=this.stampTexture??=this.makeTexture(1,1);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    this.drawTexture(texture,(left+right)/2/sx-this.width/2,this.height/2-(top+bottom)/2/sy,canvas.width/sx,canvas.height/sy);
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

  drawTexture(texture,x,y,width,height,angle=0,tint=[1,1,1,1],effects=null,texSize=null,repeatUV=null,filterCenter=null,packedTint=false) {
    if(this.kitten4&&effects&&(effects[3]>=1||effects[5]>0||effects[7]>=1)&&!this.k4Filtering)return this.drawK4SpatialTexture(texture,x,y,width,height,angle,tint,effects,texSize,repeatUV,filterCenter);
    if(this.sceneTransform){const t=this.sceneTransform;x+=t.x;y-=t.y;tint=[tint[0],tint[1],tint[2],tint[3]*t.alpha];}
    const gl=this.gl,u=this.uniform,e=effects||NO_EFFECTS;
    gl.useProgram(this.texture); gl.uniform2f(u.stageSize,this.width,this.height); gl.uniform2f(u.position,x,y);
    gl.uniform2f(u.dimensions,width,height); gl.uniform1f(u.angle,angle); gl.uniform1i(u.image,0);
    gl.uniform1i(u.kitten4,this.kitten4?1:0);
    gl.uniform1i(u.packedTint,packedTint?1:0);
    gl.uniform4fv(u.tint,tint);gl.uniform4f(u.fxA,e[0],e[2],e[3],e[4]);gl.uniform2f(u.fxB,e[5],e[6]);
    const theta=e[0]*Math.PI/180,co=Math.cos(theta),base=(1-co)/3,skew=Math.sin(theta)/Math.sqrt(3),gray=Math.min(1,Math.max(0,e[6]/100));
    gl.uniform3f(u.hueWeights,co+base,base-skew,base+skew);gl.uniform2f(u.saturationWeights,1-2*gray/3,gray/3);
    gl.uniform2f(u.texSize,texSize?.[0]||Math.abs(width)||1,texSize?.[1]||Math.abs(height)||1);
    gl.uniform2f(u.repeatUV,repeatUV?.[0]||0,repeatUV?.[1]||0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture); gl.drawArrays(gl.TRIANGLES,0,6); this.stats.drawCalls++;
  }

  drawSoftMesh(a,image){
    const mesh=a.soft_mesh;
    if(!mesh.triangles.length||!mesh.vertices.length)return;
    const sx=this.canvas.width/this.width,sy=this.canvas.height/this.height;
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(const [x,y]of mesh.vertices){const px=(this.width/2+x)*sx,py=(this.height/2-y)*sy;left=Math.min(left,px);right=Math.max(right,px);top=Math.min(top,py);bottom=Math.max(bottom,py);}
    left=Math.floor(left)-1;right=Math.ceil(right)+1;top=Math.floor(top)-1;bottom=Math.ceil(bottom)+1;
    // Keep offstage geometry in the filter input, as with ordinary sprites.
    const pad=a.effects?.[5]>0?20*Math.max(sx,sy):0;
    if(right+pad<=0||bottom+pad<=0||left-pad>=this.canvas.width||top-pad>=this.canvas.height)return;
    const gl=this.gl,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if(right-left>limit||bottom-top>limit)throw Error('Soft mesh exceeds GPU texture limit');
    const canvas=this.softCanvas??=document.createElement('canvas');
    canvas.width=right-left;canvas.height=bottom-top;
    const ctx=canvas.getContext('2d');
    drawSoftMeshTriangles(ctx,image.source,mesh,sx,sy,this.canvas.width/2-left,this.canvas.height/2-top);
    const texture=this.softTexture??=this.makeTexture(1,1);
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,canvas);
    // Effects operate on the deformed raster. This is an independent partial
    // implementation, not a claim of official triangle-edge/subpixel parity.
    this.drawTexture(texture,(left+right)/2/sx-this.width/2,this.height/2-(top+bottom)/2/sy,canvas.width/sx,canvas.height/sy,0,[1,1,1,a.opacity??1],a.effects,[canvas.width,canvas.height],null,{x:a.x,y:a.y});
  }

  drawK4SpatialTexture(texture,x,y,width,height,angle,tint,e,texSize,repeatUV,filterCenter){
    const gl=this.gl,sx=this.canvas.width/this.width,sy=this.canvas.height/this.height;
    const inherited=this.sceneTransform;
    if(inherited){filterCenter??={x,y};x+=inherited.x;y-=inherited.y;tint=[...tint.slice(0,3),tint[3]*inherited.alpha];}
    const c=Math.cos(angle),s=Math.sin(angle),w=Math.abs(width),h=Math.abs(height),pad=e[5]>0?20:0;
    const halfX=(Math.abs(c)*w+Math.abs(s)*h)/2,halfY=(Math.abs(s)*w+Math.abs(c)*h)/2;
    // Filter input is not stage-clipped: a twist can bring offstage pixels back
    // into view. Native background TilingSprites keep the same 20px padding.
    const left=Math.floor((this.width/2+x-halfX-pad)*sx),top=Math.floor((this.height/2-y-halfY-pad)*sy);
    const frameRight=Math.ceil((this.width/2+x+halfX+pad)*sx),frameBottom=Math.ceil((this.height/2-y+halfY+pad)*sy);
    if(frameRight<=0||frameBottom<=0||left>=this.canvas.width||top>=this.canvas.height)return;
    const activeW=frameRight-left,activeH=frameBottom-top;if(activeW<=0||activeH<=0)return;
    // Native intermediate textures come from a power-of-two pool. Sampling the
    // transparent unused area differs from clamping to the active frame edge.
    const screen=left===0&&top===0&&activeW===this.canvas.width&&activeH===this.canvas.height;
    const fw=screen?activeW:2**Math.ceil(Math.log2(activeW)),fh=screen?activeH:2**Math.ceil(Math.log2(activeH));
    const maxTextureSize=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if(!Number.isFinite(fw)||!Number.isFinite(fh)||fw>maxTextureSize||fh>maxTextureSize)throw Error('K4 filter input exceeds GPU texture limit');
    const right=left+fw,bottom=top+fh;
    const target=gl.getParameter(gl.FRAMEBUFFER_BINDING),viewport=gl.getParameter(gl.VIEWPORT);
    const scissor=gl.isEnabled(gl.SCISSOR_TEST),scissorBox=gl.getParameter(gl.SCISSOR_BOX);
    const cache=this.k4FilterCache??=new Map(),key=`${fw}x${fh}`,bytes=fw*fh*8;
    let entry=cache.get(key);
    if(entry){cache.delete(key);cache.set(key,entry);}
    else{
      // Bounded LRU avoids allocation churn when several actors have different
      // bounds. At most one oversized pair is retained; never one full stage
      // pair per actor. Expose its actual bytes separately from pen surfaces.
      while(cache.size&&(cache.size>=4||(this.stats.k4FilterBytes||0)+bytes>32*1024*1024)){
        const [oldKey,old]=cache.entries().next().value;
        for(const surface of old.surfaces){gl.deleteFramebuffer(surface.framebuffer);gl.deleteTexture(surface.texture);}
        cache.delete(oldKey);this.stats.k4FilterBytes-=old.bytes;
      }
      const surfaces=[];
      try{surfaces.push(this.makeSurface(fw,fh));surfaces.push(this.makeSurface(fw,fh));}
      catch(error){for(const surface of surfaces){gl.deleteFramebuffer(surface.framebuffer);gl.deleteTexture(surface.texture);}gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.viewport(...viewport);throw error;}
      entry={surfaces,bytes};cache.set(key,entry);this.stats.k4FilterBytes=(this.stats.k4FilterBytes||0)+bytes;
    }
    const {surfaces}=entry;
    this.k4Filtering=true;this.sceneTransform=null;
    try{
      gl.bindFramebuffer(gl.FRAMEBUFFER,surfaces[0].framebuffer);gl.viewport(0,0,fw,fh);gl.disable(gl.SCISSOR_TEST);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      // The clear input is a premultiplied raster, not a compositing target for
      // the matrix result (whose RGB may exceed alpha).
      // Use the filter rectangle as projection, not a shifted stage viewport:
      // clip-space stage clipping would discard the offstage source geometry.
      const stageW=this.width,stageH=this.height;
      this.width=fw/sx;this.height=fh/sy;
      // Native batch packs RGB by nearest byte but alpha by truncation. They
      // differ at e.g. 65% opacity; preserve both instead of a single scalar.
      const inputTint=repeatUV?tint:[...tint.slice(0,3).map(v=>Math.round(v*tint[3]*255)/255),Math.floor(tint[3]*255)/255];
      try{this.drawTexture(texture,x-((left+right)/2/sx-stageW/2),y-(stageH/2-(top+bottom)/2/sy),width,height,angle,inputTint,null,texSize,repeatUV,null,!repeatUV);}
      finally{this.width=stageW;this.height=stageH;}
      gl.enable(gl.SCISSOR_TEST);gl.scissor(0,fh-activeH,activeW,activeH);
      let input=0;
      const colorPass=(scope,value)=>{
        const output=1-input,u=this.k4ColorUniform;
        gl.bindFramebuffer(gl.FRAMEBUFFER,surfaces[output].framebuffer);gl.viewport(0,0,fw,fh);gl.disable(gl.SCISSOR_TEST);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);
        gl.useProgram(this.k4Color);gl.uniform2f(u.stageSize,fw,fh);gl.uniform2f(u.position,-left,-top);gl.uniform2f(u.origin,left,top);gl.uniform2f(u.dimensions,activeW,activeH);gl.uniform2f(u.extent,fw,fh);gl.uniform1i(u.image,0);
        let rows=[[1,0,0],[0,1,0],[0,0,1]],bias=0;
        if(scope===0){const t=value/180*Math.PI,c=Math.cos(t),v=(1-c)/3,s=Math.sqrt(1/3)*Math.sin(t);rows=[[c+v,v-s,v+s],[v+s,c+v,v-s],[v-s,v+s,c+v]];}
        if(scope===2)bias=Math.min(1,Math.max(-1,value/100));
        if(scope===6){const gray=Math.min(1,Math.max(0,value/100)),diagonal=1-2*gray/3,off=gray/3;rows=[[diagonal,off,off],[off,diagonal,off],[off,off,diagonal]];}
        gl.uniform3fv(u.rowR,rows[0]);gl.uniform3fv(u.rowG,rows[1]);gl.uniform3fv(u.rowB,rows[2]);gl.uniform1f(u.bias,bias);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,surfaces[input].texture);gl.drawArrays(gl.TRIANGLES,0,6);this.stats.drawCalls++;input=output;
      };
      // Rasterization and colour filtering are separate RGBA8 passes: applying
      // a matrix to the unrounded texture sample moves ASCII luminance bins.
      if(e[0]!==0)colorPass(0,e[0]);
      if(e[2]!==0)colorPass(2,e[2]);
      for(const [kind,amount]of [[0,e[3]],[1,e[5]],[2,e[7]]]){
        if(!(amount>0))continue;
        const twist=kind===1,ascii=kind===2;
        // Saturation precedes ASCII in the native filter chain.
        if(ascii&&e[6]>0){
          colorPass(6,e[6]);
        }
        const output=1-input,u=this.k4SpatialUniform;
         const direct=ascii;
        if(direct){gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.viewport(...viewport);gl.scissor(left,this.canvas.height-frameBottom,activeW,activeH);}
        else{gl.bindFramebuffer(gl.FRAMEBUFFER,surfaces[output].framebuffer);gl.viewport(0,0,fw,fh);gl.disable(gl.SCISSOR_TEST);gl.clear(gl.COLOR_BUFFER_BIT);gl.enable(gl.SCISSOR_TEST);}
        // Last ASCII pass uses the destination's projection, rather than an
        // extra POT raster/copy. Integer cell edges otherwise drift by a pixel
        // through a different UV interpolation (see round-9 paired evidence).
         // Container translation/alpha already entered the input raster; do not
         // apply them a second time to the final filtered quad.
        gl.useProgram(this.k4Spatial);gl.uniform2f(u.stageSize,direct?this.canvas.width:fw,direct?this.canvas.height:fh);gl.uniform2f(u.position,direct?0:-left,direct?0:-top);gl.uniform2f(u.dimensions,activeW,activeH);gl.uniform1f(u.angle,0);gl.uniform1i(u.image,0);
        gl.uniform2f(u.extent,fw,fh);gl.uniform2f(u.center,(this.width/2+(filterCenter?.x??x))*sx-left,(this.height/2-(filterCenter?.y??y))*sy-top);
        gl.uniform2f(u.origin,left,top);
        gl.uniform1f(u.amount,twist?amount*10*Math.PI/180:amount*sx);gl.uniform1f(u.radius,Math.hypot(w,h)/2*sx);gl.uniform1i(u.twist,twist?1:0);
        gl.uniform1i(u.ascii,ascii?1:0);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,surfaces[input].texture);gl.drawArrays(gl.TRIANGLES,0,6);this.stats.drawCalls++;input=output;
      }
      if(e[7]>=1)return;
      gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.viewport(...viewport);
      gl.scissor(left,this.canvas.height-frameBottom,activeW,activeH);
      this.drawTexture(surfaces[input].texture,(left+right)/2/sx-this.width/2,this.height/2-(top+bottom)/2/sy,fw/sx,fh/sy,0,[1,1,1,1],[0,0,0,0,0,0,e[7]>=1?0:e[6]]);
    }finally{this.sceneTransform=inherited;this.k4Filtering=false;gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.viewport(...viewport);gl.scissor(...scissorBox);if(!scissor)gl.disable(gl.SCISSOR_TEST);}
  }

  render(resetStats=true) {
    if(this.sceneTransition)this.dirty=true;
    if([...this.videos?.values()||[]].some(v=>v.state.visible!==false&&v.state.playing&&!this.mediaPaused))this.dirty=true;
    if (!this.dirty || this.lost || !this.penTexture) return;
    const gl=this.gl,started=performance.now(); if(resetStats)this.stats.drawCalls=0;
    const transition=this.sceneTransition;
    if(transition&&transitionKind(transition.transition)==='distort'){
      const elapsed=this.transitionClock()-transition.start;
      if(elapsed>500&&transition.transition.outEnd===undefined)transition.transition={...transition.transition,outEnd:elapsed};
    }
    const state=transition&&sampleTransition(transition.transition,this.transitionClock()-transition.start,this.width,this.height);
    if(transition&&state.active&&state.screenshots){
      this.drawDistortTransition(transition,state);
    }else if(transition&&state.active){
      // Keep the leaving scene's actors/pen/backdrop alive, not a CSS transform
      // of the destination canvas. Incoming content is refreshed every frame.
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.canvas.width,this.canvas.height);
      gl.clearColor(1,1,1,1);gl.clear(gl.COLOR_BUFFER_BIT);
      // Container alpha is inherited by EACH child, not applied to a flattened
      // screenshot. This matters where translucent actors overlap a backdrop.
      const draw=(scene,s)=>{if(s.visible)this.drawScene(null,scene,s,false);};
      if(transition.incomingOnTop){draw(transition.old,state.outgoing);draw(this,state.incoming);}
      else{draw(this,state.incoming);draw(transition.old,state.outgoing);}
    }else{
      if(transition)this.clearSceneTransition();
      this.drawScene();
    }
    this.dirty=!!this.sceneTransition; if(resetStats)this.stats.submitMs=performance.now()-started;
  }

  drawScene(framebuffer=null,state=this,transform=null,clear=true){
    const gl=this.gl;
    this.sceneTransform=transform;
    try{
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.viewport(0,0,this.canvas.width,this.canvas.height);
    // Scene layers must stay transparent: white is the stage clear colour, not
    // part of either scene's alpha during cross-fades.
    if(clear){gl.clearColor(...(framebuffer?[0,0,0,0]:[1,1,1,1]));gl.clear(gl.COLOR_BUFFER_BIT);}
    const {backdrop:backdropId,backgroundState,penTexture,penLayer,actorOrder,sprites,spriteIndices}=state;
    const backdrop=this.images.get(backdropId);
    if(backdrop){
      // K4 St.update_adaptive_scale uses COVER, not independent x/y stretch.
      const scale=this.kitten4&&backdrop.adaptive?Math.max(this.width/backdrop.width,this.height/backdrop.height):null;
      if(this.kitten4){
        // Background is a stage-sized TilingSprite; scale changes its tile
        // transform, not the stage rectangle (It.set_scale / St).
        const a=backgroundState,base=scale??1,sx=base*(a?.scale??100)/100*(a?.size_x??100)/100,sy=base*(a?.scale??100)/100*(a?.size_y??100)/100;
        if(sx&&sy)this.drawTexture(backdrop.texture,0,0,this.width,this.height,0,[1,1,1,a?.opacity??1],a?.effects,null,[this.width/(backdrop.width*sx),this.height/(backdrop.height*sy)]);
      }else this.drawTexture(backdrop.texture,0,0,this.width,this.height);
    }
    // Media isn't duplicated into the leaving scene. Cross-scene video z-order
    // during transitions still needs an independent native probe.
    const drawVideos=()=>{if(state!==this)return;const saved=this.sceneTransform;this.sceneTransform=null;try{this.drawVideos();}finally{this.sceneTransform=saved;}};
    // QqDm.h=1: media container above backdrop and below actor/pen content.
    if(!this.videoAbovePen||penLayer>0)drawVideos();
    const layer=Math.min(penLayer,actorOrder.length);
    for(let i=0;i<=actorOrder.length;i++) {
      if(i===layer)this.drawTexture(penTexture,0,0,this.width,this.height);
      if(i===0&&this.videoAbovePen&&penLayer===0)drawVideos();
      const a=sprites[spriteIndices.get(actorOrder[i])];if(!a)continue;
      if(!a.visible)continue;
      const image=this.spriteImage(a);
      if(image&&a.soft_mesh&&image.source){this.drawSoftMesh(a,image);continue;}
      if(image){const {x,y,width,height,angle}=actorGeometry(a,image,this.kitten4);
        this.drawTexture(image.texture,x,y,width,height,angle,[1,1,1,a.opacity??1],a.effects,[image.width,image.height],null,{x:a.x,y:a.y});}
    }
    }finally{this.sceneTransform=null;}
  }

  hitTest(x,y){
    for(let i=this.actorOrder.length-1;i>=0;i--){
      const a=this.sprites[this.spriteIndices.get(this.actorOrder[i])];
      // K4 Lt/Mt and KN 61248 hit areas use original costume alpha, not
      // the ghost-effect opacity (docs/input.md and docs/input-kn.md).
      if(!a?.visible||!a.scale)continue;
      const image=this.spriteImage(a);if(!image)continue;
      if(a.soft_mesh){
        const uv=softMeshUVAt(a.soft_mesh,x,y,image);
        if(uv)return a.id;
        continue;
      }
      const {x:cx,y:cy,width,height,angle}=actorGeometry(a,image,this.kitten4);if(!width||!height||![cx,cy,width,height,angle].every(Number.isFinite))continue;
      const c=Math.cos(angle),s=Math.sin(angle),dx=x-cx,dy=y-cy;
      const px=Math.floor((c*dx-s*dy)*image.width/width+image.width/2),py=Math.floor(image.height/2-(s*dx+c*dy)*image.height/height);
      if(px>=0&&px<image.width&&py>=0&&py<image.height&&image.alpha[py*image.width+px]>0)return a.id;
    }
    return null;
  }
}

const NO_EFFECTS=[0,0,0,0,0,0,0];

// The mesh wire is additive: old frames need no field; an omitted field in a
// later complete sprite snapshot removes the deformation. Bound allocations and
// reject malformed indices before any Canvas/GPU work.
export function validateSoftMesh(mesh){
  if(!mesh||!Array.isArray(mesh.vertices)||mesh.vertices.length>65536||
    !Array.isArray(mesh.triangles)||mesh.triangles.length>131072||
    !mesh.vertices.every(v=>Array.isArray(v)&&v.length===4&&v.every(Number.isFinite)&&Math.abs(v[0])<=1e9&&Math.abs(v[1])<=1e9&&v[2]>=0&&v[2]<=1&&v[3]>=0&&v[3]<=1)||
    !mesh.triangles.every(t=>Array.isArray(t)&&t.length===3&&t.every(i=>Number.isInteger(i)&&i>=0&&i<mesh.vertices.length)))throw Error('损坏的柔体网格');
  return mesh;
}

// Original Canvas2D affine texture mapping. UVs are top-left based, while world
// y is up. Clip in destination pixels before mapping source pixels onto it.
// Degenerate UV/world triangles have no renderable area and are skipped.
export function drawSoftMeshTriangles(ctx,source,mesh,sx=1,sy=1,ox=0,oy=0){
  for(const triangle of mesh.triangles){
    const p=triangle.map(i=>mesh.vertices[i]);
    const [a,b,c]=p.map(([x,y,u,v])=>[ox+x*sx,oy-y*sy,u*source.width,v*source.height]);
    const u1=b[2]-a[2],v1=b[3]-a[3],u2=c[2]-a[2],v2=c[3]-a[3],det=u1*v2-u2*v1;
    const x1=b[0]-a[0],y1=b[1]-a[1],x2=c[0]-a[0],y2=c[1]-a[1];
    if(Math.abs(det)<1e-12||Math.abs(x1*y2-x2*y1)<1e-12)continue;
    const m0=(x1*v2-x2*v1)/det,m1=(y1*v2-y2*v1)/det;
    const m2=(x2*u1-x1*u2)/det,m3=(y2*u1-y1*u2)/det;
    ctx.save();
    try{
      ctx.setTransform(1,0,0,1,0,0);ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.lineTo(c[0],c[1]);ctx.closePath();ctx.clip();
      ctx.setTransform(m0,m1,m2,m3,a[0]-m0*a[2]-m2*a[3],a[1]-m1*a[2]-m3*a[3]);ctx.drawImage(source,0,0);
    }finally{ctx.restore();}
  }
}

// Barycentric hit testing follows deformed triangles, not the old sprite quad.
// Inspect all overlapping triangles so transparent texels pass through.
export function softMeshUVAt(mesh,x,y,image){
  for(let i=mesh.triangles.length-1;i>=0;i--){
    const [a,b,c]=mesh.triangles[i].map(index=>mesh.vertices[index]);
    const bx=b[0]-a[0],by=b[1]-a[1],cx=c[0]-a[0],cy=c[1]-a[1],det=bx*cy-cx*by;
    if(Math.abs(det)<1e-12)continue;
    const dx=x-a[0],dy=y-a[1],s=(dx*cy-cx*dy)/det,t=(bx*dy-dx*by)/det;
    if(s<0||t<0||s+t>1)continue;
    const u=a[2]+s*(b[2]-a[2])+t*(c[2]-a[2]),v=a[3]+s*(b[3]-a[3])+t*(c[3]-a[3]);
    const px=Math.min(image.width-1,Math.max(0,Math.floor(u*image.width))),py=Math.min(image.height-1,Math.max(0,Math.floor(v*image.height)));
    if(image.alpha[py*image.width+px]>0)return [u,v];
  }
  return null;
}
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

// a1xw/Rt.draw_image_stamp floors the Canvas destination rectangle, not the
// pivot/translation. An odd/fractional size therefore shifts the pixel centre.
export function k4ImageStampGeometry(stamp,image){
  const g=actorGeometry(stamp,image,true),w=Math.abs(g.width),h=Math.abs(g.height);
  const width=Math.floor(w)*Math.sign(g.width),height=Math.floor(h)*Math.sign(g.height);
  const dx=(Math.floor(-w/2)+Math.floor(w)/2)*Math.sign(g.width);
  const dy=-(Math.floor(-h/2)+Math.floor(h)/2)*Math.sign(g.height);
  const c=Math.cos(g.angle),s=Math.sin(g.angle);
  return {width,height,angle:g.angle,x:g.x+c*dx+s*dy,y:g.y-s*dx+c*dy};
}

export function decodeFrame(buffer) {
  if(buffer.byteLength<4)throw Error('空帧数据');
  const length=new DataView(buffer).getUint32(0,true);
  if(length%4 || length+4>buffer.byteLength || (buffer.byteLength-length-4)%36)throw Error('无效帧数据长度');
  const frame=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,length)));
  return {frame,lines:new Float32Array(buffer,4+length)};
}
