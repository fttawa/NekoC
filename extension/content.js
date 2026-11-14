(() => {
  const playerURL=chrome.runtime.getURL('play.html'),origin=new URL(playerURL).origin;
  const records=new Map();let enabled=false,scheduled=false;
  let notifiedPage='',injectionHint=null,hintTimer=null;
  function dismissInjectionHint(){clearTimeout(hintTimer);injectionHint?.remove();injectionHint=null;}
  function showInjectionHint(){
    dismissInjectionHint();
    const host=document.createElement('div');host.dataset.nekoInjection='';
    const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
    style.textContent=':host{position:fixed;left:20px;bottom:20px;z-index:2147483647;pointer-events:none;font:12px system-ui}div{padding:12px 16px;border:1px solid #53694f;border-radius:10px;background:#142019f2;color:#d8ecd0;box-shadow:0 6px 24px #0003}strong{display:block;font-size:13px;margin-bottom:5px}span{color:#a2b39e}';
    const box=document.createElement('div'),title=document.createElement('strong'),detail=document.createElement('span');
    title.textContent='✓ Neko 扩展已植入';detail.textContent='等待网页播放器 · 出现后自动接管';
    box.setAttribute('role','status');box.append(title,detail);shadow.append(style,box);document.documentElement.append(host);
    injectionHint=host;hintTimer=setTimeout(dismissInjectionHint,4000);
  }
  // Official players PICKCAT embeds: Kitten N and Kitten 4. Each kind only trusts its own
  // player origin for messages and its own CDN for the work source.
  const kinds={
    kn:{player:'https://kn.codemao.cn',source:'https://creation.bcmcdn.com'},
    k4:{player:'https://player.codemao.cn',source:'https://creation.codemao.cn'},
  };
  function workInfo(src){
    try{
      const u=new URL(src);
      if(u.origin===kinds.kn.player&&u.pathname==='/player'&&/^\d+$/.test(u.searchParams.get('workId')))return {id:u.searchParams.get('workId'),kind:'kn'};
      const k4=u.origin===kinds.k4.player?/^\/new\/([1-9][0-9]*)\/?$/.exec(u.pathname):null;
      return k4?{id:k4[1],kind:'k4'}:null;
    }catch{return null;}
  }
  function rustURL(record){return `${playerURL}?workId=${record.id}&kind=${record.kind}&bcm=${encodeURIComponent(record.resource)}`;}
  function requestResource(record){
    if(record.rust||!record.frame.isConnected||record.frame.src!==record.original)return;
    // src can point at the official player while its window still has the parent's origin.
    // This payload-free probe is safe during navigation; replies still require the exact
    // official origin, iframe window, work ID and CDN URL below.
    record.frame.contentWindow?.postMessage({type:'neko-request-resource',id:record.id},'*');
  }
  function restore(record){
    record.rust=false;record.frame.src=record.original;
    record.button.textContent='切换 Neko';record.label.textContent='原播放器';
  }
  function activate(record){
    if(!record.resource){record.label.textContent='等待原播放器资源…';return;}
    record.rust=true;record.frame.src=rustURL(record);
    dismissInjectionHint();
    record.button.textContent='切回原版';record.label.textContent='Neko 载入中…';
  }
  function cleanup(record,restoreFrame){
    record.frame.removeEventListener('load',record.onLoad);
    if(restoreFrame&&record.rust&&record.frame.src.startsWith(playerURL))record.frame.src=record.original;
    record.toolbar.remove();records.delete(record.frame);
  }
  function scan(){
    scheduled=false;
    if(!document.documentElement)return;
    const onWork=/^\/(?:works|forum\/post)\/[^/]+\/?$/.test(location.pathname);
    if(!enabled||!onWork){notifiedPage='';dismissInjectionHint();}
    else if(notifiedPage!==location.pathname){notifiedPage=location.pathname;showInjectionHint();}
    for(const record of records.values()){
      if(!record.frame.isConnected||!onWork||!enabled||record.page!==location.pathname){cleanup(record,true);continue;}
      const expected=record.rust?rustURL(record):record.original;
      if(record.frame.src!==expected)cleanup(record,false);
    }
    if(!enabled||!onWork)return;
    for(const frame of document.querySelectorAll('iframe[src]')){
      const work=workInfo(frame.src);if(!work||records.has(frame))continue;const {id,kind}=work;
      // Only an existing, website-authorized official player can be replaced.
      const toolbar=document.createElement('div');toolbar.dataset.nekoRust='';
      const shadow=toolbar.attachShadow({mode:'open'});
      const style=document.createElement('style');style.textContent=':host{position:absolute;right:8px;top:5px;z-index:40;display:block;font:11px system-ui}div{display:flex;align-items:center;gap:8px;max-width:190px;background:#17221eee;color:#c9e0c1;border:1px solid #425442;border-radius:6px;padding:4px 6px}span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}button{flex:none;border:0;border-radius:4px;background:#b6d7a8;color:#192c1a;font:11px system-ui;cursor:pointer;padding:4px 8px}';
      const row=document.createElement('div'),label=document.createElement('span'),button=document.createElement('button');
      row.append(label,button);shadow.append(style,row);frame.parentElement.append(toolbar);
      const record={frame,id,kind,original:frame.src,toolbar,label,button,page:location.pathname,rust:false,resource:null,auto:true};records.set(frame,record);
      record.onLoad=()=>requestResource(record);frame.addEventListener('load',record.onLoad);
      button.onclick=()=>{
        if(record.rust){record.auto=false;restore(record);}
        else{record.auto=true;activate(record);if(!record.resource)requestResource(record);}
      };
      button.textContent='切换 Neko';activate(record);
      requestResource(record); // Also recover cached details when enabling on an already loaded player.
    }
  }
  function schedule(){if(!scheduled){scheduled=true;queueMicrotask(scan);}}
  new MutationObserver(schedule).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
  window.addEventListener('popstate',schedule);
  window.addEventListener('message',event=>{
    if(Object.values(kinds).some(k=>k.player===event.origin)&&['neko-project-resource','neko-resource-unavailable'].includes(event.data?.type)){
      scan();
      for(const record of records.values()){
        const expected=kinds[record.kind];
        if(record.rust||event.origin!==expected.player||event.source!==record.frame.contentWindow||event.data.id!==record.id)continue;
        if(event.data.type==='neko-resource-unavailable'){record.label.textContent='未找到可用作品资源';continue;}
        try{const url=new URL(event.data.url);if(url.origin!==expected.source)continue;record.resource=url.href;if(record.auto)activate(record);}catch{}
      }
      return;
    }
    if(event.origin!==origin||event.data?.type!=='neko-rust-status')return;
    for(const record of records.values())if(record.rust&&event.source===record.frame.contentWindow)record.label.textContent=String(event.data.status).slice(0,60);
  });
  chrome.storage.local.get({enabled:true}).then(settings=>{enabled=settings.enabled;schedule();});
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    if(changes.enabled){enabled=changes.enabled.newValue;schedule();}
    if(changes.port||changes.engine)for(const record of records.values())if(record.rust)activate(record);
  });
})();
