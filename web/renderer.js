// Incremental renderer: one instanced capsule draw per pen delta, persistent FBO.
// No CPU stroke history, no Canvas2D path replay, no per-stroke draw calls.
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
const TEXTURE_FRAGMENT = `#version 300 es
precision highp float;uniform sampler2D image;uniform vec4 tint;in vec2 uv;out vec4 outColor;
void main(){outColor=texture(image,uv)*vec4(tint.rgb*tint.a,tint.a);}`;

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

export class StageRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: false });
    if (!gl) throw Error('需要支持 WebGL 2 的浏览器。');
    this.gl = gl; this.pen = program(gl, PEN_VERTEX, PEN_FRAGMENT); this.texture = program(gl, TEXTURE_VERTEX, TEXTURE_FRAGMENT);
    this.penSize = gl.getUniformLocation(this.pen, 'stageSize');
    this.uniform = Object.fromEntries(['stageSize', 'position', 'dimensions', 'angle', 'image', 'tint'].map(k => [k, gl.getUniformLocation(this.texture, k)]));
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
    canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); this.lost = true; this.onError?.('GPU 上下文丢失，请重新加载项目。'); });
  }

  async load(project) {
    const generation = ++this.generation;
    const gl = this.gl;
    for(const query of this.gpuQueries)gl.deleteQuery(query);
    this.gpuQueries=[];this.stats.gpuMs=null;
    for (const item of this.images.values()) gl.deleteTexture(item.texture);
    this.images.clear();
    for(const item of this.textCache.values())gl.deleteTexture(item.texture);
    this.textCache.clear();this.stats.textTextureBytes=0;
    if (this.framebuffer) gl.deleteFramebuffer(this.framebuffer);
    if (this.penTexture) gl.deleteTexture(this.penTexture);
    this.width = Number(project.stageSize?.width || 900); this.height = Number(project.stageSize?.height || 562);
    if (![this.width,this.height].every(n => Number.isFinite(n) && n >= 1 && n <= 8192)) throw Error('无效舞台尺寸');
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const scale = Math.min(this.resolutionScale ?? (devicePixelRatio || 1), 2, limit / Math.max(this.width, this.height));
    this.canvas.width = Math.ceil(this.width * scale); this.canvas.height = Math.ceil(this.height * scale);
    this.canvas.style.aspectRatio = `${this.width}/${this.height}`;
    this.penTexture = this.makeTexture(this.canvas.width, this.canvas.height);
    this.framebuffer = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.penTexture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw Error('GPU 画笔纹理创建失败');
    gl.viewport(0,0,this.canvas.width,this.canvas.height); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    this.stats.framebufferBytes = this.canvas.width * this.canvas.height * 4;
    this.stats.textureBytes = 0;
    const scene = project.scenes?.scenesDict?.[project.scenes.currentSceneId];
    this.backdrop = scene?.currentStyleId;
    this.sceneId=project.scenes?.currentSceneId;this.actorOrder=[...(scene?.actorIds||[])].reverse();this.penLayer=0;
    this.sprites = (scene?.actorIds || []).map(id => {
      const a = project.actors.actorsDict[id];
      return { id, name:a.name, style:a.currentStyleId, x:a.position?.x||0,y:a.position?.y||0,direction:(a.rotation||0)*180/Math.PI,scale:a.scale??100,visible:a.visible!==false,opacity:1 };
    });
    this.spriteIndices=new Map(this.sprites.map((a,i)=>[a.id,i]));
    this.dirty = true;
    const ids = [...new Set([this.backdrop,...(scene?.styles||[]),...this.sprites.flatMap(a=>[a.style,...(project.actors.actorsDict[a.id].styles||[])])].filter(Boolean))];
    await Promise.all(ids.map(async id => {
      const style = project.styles?.stylesDict?.[id]; if (!style?.url) return;
      try {
        const image = new Image(); image.crossOrigin = 'anonymous'; image.src = style.url;
        let timeout;
        try { await Promise.race([image.decode(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('素材加载超时')),15000);})]); }
        finally { clearTimeout(timeout); }
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
        this.images.set(id,{texture,width:image.naturalWidth,height:image.naturalHeight,alpha});
        this.stats.textureBytes += image.naturalWidth * image.naturalHeight * 4;
        this.dirty = true;
      } catch(error) { this.onError?.(`素材 ${style.name || id}: ${error.message}`); }
    }));
  }

  setResolution(scale) {
    if(!Number.isFinite(scale)||scale<.5||scale>2)throw Error('渲染倍率应在 0.5–2 之间');
    this.resolutionScale=scale;
    if(!this.framebuffer||this.lost)return;
    const gl=this.gl,limit=gl.getParameter(gl.MAX_TEXTURE_SIZE);
    scale=Math.min(scale,limit/Math.max(this.width,this.height));
    const width=Math.ceil(this.width*scale),height=Math.ceil(this.height*scale);
    if(width===this.canvas.width&&height===this.canvas.height)return;
    const texture=this.makeTexture(width,height),framebuffer=gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE){
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);
      throw Error('无法创建此分辨率的画笔图层');
    }
    // Resize the persistent pen surface without restarting the game or losing its drawing.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER,this.framebuffer);gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER,framebuffer);
    gl.blitFramebuffer(0,0,this.canvas.width,this.canvas.height,0,0,width,height,gl.COLOR_BUFFER_BIT,gl.LINEAR);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    gl.deleteFramebuffer(this.framebuffer);gl.deleteTexture(this.penTexture);
    this.framebuffer=framebuffer;this.penTexture=texture;
    this.canvas.width=width;this.canvas.height=height;
    this.stats.framebufferBytes=width*height*4;this.stats.gpuMs=null;this.dirty=true;this.render();
  }

  makeTexture(w,h) {
    const gl = this.gl, texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,w,h,0,gl.RGBA,gl.UNSIGNED_BYTE,null); return texture;
  }

  apply(frame, lines) {
    if (this.lost) return;
    if (lines.length % 9 !== 0) throw Error('损坏的画笔实例数据');
    const started = performance.now(), gl = this.gl;
    const stamps=frame.text_stamps||[];
    let last=0;
    for(const stamp of stamps){
      if(!Number.isInteger(stamp.before_line)||stamp.before_line<last||stamp.before_line>lines.length/9)throw Error('损坏的印章绘制顺序');
      last=stamp.before_line;
    }
    this.stats.drawCalls = 0; this.stats.penInstances = lines.length / 9;
    this.stats.textUploads=0;this.stats.textStamps=stamps.length;
    this.collectGpuTimes();
    const layerChanged=Number.isInteger(frame.pen_layer)&&frame.pen_layer!==this.penLayer;
    if(layerChanged)this.penLayer=frame.pen_layer;
    const hasDrawing=frame.clear||frame.reset||lines.length||stamps.length||frame.sprites.length||layerChanged;
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
      this.drawTextStamp(stamp);
    }
    this.drawLines(cursor,lines.length/9-cursor);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);
    let changed=!!frame.reset||layerChanged;
    if(frame.reset){this.sprites=[];this.spriteIndices.clear();}
    for(const a of frame.sprites){
      if(a.id===this.sceneId){changed ||= a.style!==this.backdrop;this.backdrop=a.style;continue;}
      const index=this.spriteIndices.get(a.id),old=index===undefined?null:this.sprites[index];
      changed ||= !old||['style','x','y','direction','scale','visible','opacity'].some(k=>a[k]!==old[k]);
      if(index===undefined){this.spriteIndices.set(a.id,this.sprites.length);this.sprites.push(a);}else this.sprites[index]=a;
    }
    this.dirty ||= changed || frame.clear || lines.length>0 || stamps.length>0;
    this.render(false);
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

  drawTextStamp(stamp){
    if(!stamp.text)return;
    const item=this.textTexture(stamp.text,stamp.size);
    const offset=stamp.align==='right'?item.advance:stamp.align==='center'?item.advance/2:0;
    // Official text stamps rotate by the negative actor rotation, around the anchor.
    const angle=-stamp.direction*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=item.dx-offset,dy=item.dy;
    this.drawTexture(item.texture,stamp.x+dx*c+dy*s,stamp.y-dx*s+dy*c,item.width,item.height,angle,stamp.color);
  }

  drawTexture(texture,x,y,width,height,angle=0,tint=[1,1,1,1]) {
    const gl=this.gl,u=this.uniform;
    gl.useProgram(this.texture); gl.uniform2f(u.stageSize,this.width,this.height); gl.uniform2f(u.position,x,y);
    gl.uniform2f(u.dimensions,width,height); gl.uniform1f(u.angle,angle); gl.uniform1i(u.image,0);
    gl.uniform4fv(u.tint,tint);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texture); gl.drawArrays(gl.TRIANGLES,0,6); this.stats.drawCalls++;
  }

  render(resetStats=true) {
    if (!this.dirty || this.lost || !this.penTexture) return;
    const gl=this.gl,started=performance.now(); if(resetStats)this.stats.drawCalls=0;
    gl.bindFramebuffer(gl.FRAMEBUFFER,null); gl.viewport(0,0,this.canvas.width,this.canvas.height);
    gl.clearColor(1,1,1,1); gl.clear(gl.COLOR_BUFFER_BIT);
    const backdrop=this.images.get(this.backdrop);
    if(backdrop)this.drawTexture(backdrop.texture,0,0,this.width,this.height);
    const layer=Math.min(this.penLayer,this.actorOrder.length);
    for(let i=0;i<=this.actorOrder.length;i++) {
      if(i===layer)this.drawTexture(this.penTexture,0,0,this.width,this.height);
      const a=this.sprites[this.spriteIndices.get(this.actorOrder[i])];if(!a)continue;
      if(!a.visible)continue;
      const image=this.images.get(a.style);
      if(image)this.drawTexture(image.texture,a.x,a.y,image.width*a.scale/100,image.height*a.scale/100,a.direction*Math.PI/180,[1,1,1,a.opacity??1]);
    }
    this.dirty=false; if(resetStats)this.stats.submitMs=performance.now()-started;
  }

  hitTest(x,y){
    for(let i=this.actorOrder.length-1;i>=0;i--){
      const a=this.sprites[this.spriteIndices.get(this.actorOrder[i])];
      if(!a?.visible||!a.scale||(a.opacity??1)<=0)continue;
      const image=this.images.get(a.style);if(!image)continue;
      const angle=a.direction*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),dx=x-a.x,dy=y-a.y;
      const px=Math.floor((c*dx-s*dy)*100/a.scale+image.width/2),py=Math.floor(image.height/2-(s*dx+c*dy)*100/a.scale);
      if(px>=0&&px<image.width&&py>=0&&py<image.height&&image.alpha[py*image.width+px]>0)return a.id;
    }
    return null;
  }
}

export function decodeFrame(buffer) {
  if(buffer.byteLength<4)throw Error('空帧数据');
  const length=new DataView(buffer).getUint32(0,true);
  if(length%4 || length+4>buffer.byteLength || (buffer.byteLength-length-4)%36)throw Error('无效帧数据长度');
  const frame=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,length)));
  return {frame,lines:new Float32Array(buffer,4+length)};
}
