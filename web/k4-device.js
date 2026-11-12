// Browser device boundary for the Kitten4 host APIs.
//
// Device sensors are deliberately not inferred from pointer/touch input.  A
// caller must explicitly send remote button/slide/slope/shake events; local
// motion and orientation sensors are the only implicit browser inputs here.
export class K4DeviceHost {
  constructor(environment=globalThis,options={}) {
    this.env=environment||globalThis;
    this.window=this.env.window||this.env;
    this.navigator=this.env.navigator;
    this.maxEvents=options.maxEvents??256;
    const height=Number(this.window.innerHeight),width=Number(this.window.innerWidth);
    this.portrait=Number.isFinite(height)&&Number.isFinite(width)?height>=width:false;
    this.events=[];
    this.motionAllowed=null;this.orientationAllowed=null;this.unavailable=true;
    this.started=false;this.closed=false;this.permission=null;
    this.onMotion=this.onMotion.bind(this);this.onOrientation=this.onOrientation.bind(this);
  }

  // Safe to call from a play/start click.  Permission APIs are iOS-specific;
  // browsers without them simply expose their sensors through addEventListener.
  async requestPermission() {
    if(this.permission)return this.permission;
    if(this.started&&this.motionAllowed!==false&&this.orientationAllowed!==false)return this.status('ready');
    const permission=this.requestPermissionImpl();this.permission=permission;
    try { return await permission; }
    finally { if(this.permission===permission)this.permission=null; }
  }

  async requestPermissionImpl() {
    this.closed=false;
    const generation=this.generation=(this.generation||0)+1;
    // Invoke BOTH permission requests before awaiting either: transient user
    // activation may no longer be available after the first prompt settles.
    const requests=[['motion',this.window.DeviceMotionEvent],['orientation',this.window.DeviceOrientationEvent]].map(([name,ctor])=>{
      if(!ctor)return Promise.resolve([name,null]);
      this.unavailable=false;
      try {
        const result=typeof ctor.requestPermission==='function'?ctor.requestPermission():'granted';
        return Promise.resolve(result).then(value=>[name,value==='granted'],()=>[name,false]);
      } catch {
        return Promise.resolve([name,false]);
      }
    });
    const results=await Promise.all(requests);
    if(this.closed||generation!==this.generation)return this.status();
    for(const [name,allowed] of results)this[`${name}Allowed`]=allowed;
    this.start();
    return this.status();
  }

  status(fallback='pending') {
    if(this.unavailable)return 'unavailable';
    if(this.motionAllowed===false||this.orientationAllowed===false)return 'denied';
    if(this.started)return 'ready';
    return fallback;
  }

  start() {
    if(this.closed)return;
    const target=this.window;
    if(!target?.addEventListener)return;
    if(this.started){target.removeEventListener('devicemotion',this.onMotion);target.removeEventListener('deviceorientation',this.onOrientation);}
    if(this.motionAllowed===true)target.addEventListener('devicemotion',this.onMotion);
    if(this.orientationAllowed===true)target.addEventListener('deviceorientation',this.onOrientation);
    this.started=true;
  }

  stop() {
    this.closed=true;this.generation=(this.generation||0)+1;
    const target=this.window;
    if(this.started&&target?.removeEventListener) {
      target.removeEventListener('devicemotion',this.onMotion);
      target.removeEventListener('deviceorientation',this.onOrientation);
    }
    this.started=false;this.permission=null;this.events=[];
  }

  close() { this.stop(); }

  onMotion(event) {
    if(this.closed||this.motionAllowed!==true)return;
    const acceleration=event?.accelerationIncludingGravity;
    const x=acceleration?.x,y=acceleration?.y,z=acceleration?.z;
    if(![x,y,z].every(Number.isFinite))return;
    const time=event?.timeStamp;
    if(!Number.isFinite(time))return;
    this.push({kind:'device_motion',x,y,z,time_ms:time});
  }

  onOrientation(event) {
    if(this.closed||this.orientationAllowed!==true)return;
    const beta=event?.beta,gamma=event?.gamma;
    if(!Number.isFinite(beta)||!Number.isFinite(gamma))return;
    this.push({kind:'device_orientation',beta,gamma,portrait:this.portrait});
  }

  push(event) {
    if(this.closed)return false;
    if(this.events.length<this.maxEvents)this.events.push(event);
    else return false;
    return true;
  }

  // Explicit remote-device inputs.  These never attach to or reinterpret
  // local pointer/touch events.
  sendDeviceEvent(action,device,value='') {
    if(typeof action!=='string'||typeof device!=='string'||typeof value!=='string')return false;
    return this.push({kind:'device_event',action,device,value});
  }
  sendButton(device,event,button) {
    if(typeof device!=='string'||typeof event!=='string'||typeof button!=='string')return false;
    return this.push({kind:'mobile_button',device,event,button});
  }
  sendSlide(device,value) { return this.sendDeviceEvent('on_mobile_slide',device,value); }
  sendSlope(device,value) { return this.sendDeviceEvent('on_mobile_slope',device,value); }
  sendShake(device) { return this.sendDeviceEvent('on_mobile_shake',device,''); }

  // Short names are convenient for host integrations and keep the wire names
  // out of UI code.
  button(device,event,button) { return this.sendButton(device,event,button); }
  mobileButton(device,event,button) { return this.sendButton(device,event,button); }
  slide(device,value) { return this.sendSlide(device,value); }
  mobileSlide(device,value) { return this.sendSlide(device,value); }
  slope(device,value) { return this.sendSlope(device,value); }
  mobileSlope(device,value) { return this.sendSlope(device,value); }
  shake(device) { return this.sendShake(device); }
  mobileShake(device) { return this.sendShake(device); }

  take(limit=Infinity) {
    const count=Math.max(0,Math.min(this.events.length,Number.isFinite(limit)?Math.floor(limit):this.events.length));
    return this.events.splice(0,count);
  }

  apply(frame) {
    if(this.closed)return;
    const output=frame?.k4_media_output;
    if(!Array.isArray(output))return;
    const vibrate=this.navigator?.vibrate;
    if(typeof vibrate!=='function')return;
    for(const command of output) {
      if(command?.kind!=='vibrate'||!Array.isArray(command.pattern_ms))continue;
      const pattern=command.pattern_ms;
      // Preserve the domain's raw signed duration. The official block passes
      // it to Vibrate before the browser performs platform normalization.
      if(!pattern.every(Number.isFinite))continue;
      try { vibrate.call(this.navigator,pattern); } catch { /* unsupported/denied is not success */ }
    }
  }
}

export const DeviceHost=K4DeviceHost;
