// Observe only the official player's completed public-project request. It supplies its own authentication.
// Kitten N: kn.codemao.cn/player?workId=<id>; Kitten 4: player.codemao.cn/new/<id>.
(() => {
  if(window===parent)return;
  const k4=location.host==='player.codemao.cn'?/^\/new\/([1-9][0-9]*)\/?$/.exec(location.pathname):null;
  const kind=k4?'k4':'kn';
  const id=k4?k4[1]:new URLSearchParams(location.search).get('workId');
  if(!/^\d+$/.test(id||''))return;
  if(kind==='kn'&&!(location.host==='kn.codemao.cn'&&location.pathname==='/player'))return;
  const endpoint=kind==='k4'?`/kitten/r2/work/player/load/${id}`:`/neko/community/player/published-work-detail/${id}`;
  // Each official player downloads its sources from one CDN; nothing else is forwarded.
  const sourceOrigin=kind==='k4'?'https://creation.codemao.cn':'https://creation.bcmcdn.com';
  let cached=null;
  function publish(value){
    try{
      if(typeof value==='string')value=JSON.parse(value);
      // Published projects can use the encoded source_urls variant with an empty bcm_url.
      const candidates=[...(Array.isArray(value.source_urls)?value.source_urls:[]),value.bcm_url];
      let resource=null;
      for(const candidate of candidates){
        try{const url=new URL(candidate);if(url.origin===sourceOrigin&&!url.username&&!url.password){resource=url.href;break;}}catch{}
      }
      cached=value;
      parent.postMessage(resource?{type:'neko-project-resource',id,kind,url:resource}:{type:'neko-resource-unavailable',id,kind},'https://pickcat.dao3.fun');
    }catch{}
  }
  window.addEventListener('message',event=>{if(event.source===parent&&event.origin==='https://pickcat.dao3.fun'&&event.data?.type==='neko-request-resource'&&event.data.id===id&&cached)publish(cached);});
  const open=XMLHttpRequest.prototype.open,send=XMLHttpRequest.prototype.send,urls=new WeakMap();
  XMLHttpRequest.prototype.open=function(method,url,...rest){urls.set(this,String(url));return open.call(this,method,url,...rest);};
  XMLHttpRequest.prototype.send=function(...args){
    if(urls.get(this)?.includes(endpoint))this.addEventListener('load',()=>{if(this.status===200)publish(this.responseType==='json'?this.response:this.responseText);},{once:true});
    return send.apply(this,args);
  };
  const originalFetch=window.fetch;
  window.fetch=async function(input,...rest){const response=await originalFetch.call(this,input,...rest);if(String(input?.url||input).includes(endpoint)&&response.ok)void response.clone().json().then(publish).catch(()=>{});return response;};
})();
