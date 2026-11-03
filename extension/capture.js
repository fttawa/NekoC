// Observe only the official player's completed public-project request. It supplies its own authentication.
(() => {
  const id=new URLSearchParams(location.search).get('workId');
  if(!/^\d+$/.test(id||'')||window===parent)return;
  const endpoint=`/neko/community/player/published-work-detail/${id}`;
  let cached=null;
  function publish(value){
    try{
      if(typeof value==='string')value=JSON.parse(value);
      // Published projects can use the encoded source_urls variant with an empty bcm_url.
      const candidates=[...(Array.isArray(value.source_urls)?value.source_urls:[]),value.bcm_url];
      let resource=null;
      for(const candidate of candidates){
        try{const url=new URL(candidate);if(url.origin==='https://creation.bcmcdn.com'&&!url.username&&!url.password){resource=url.href;break;}}catch{}
      }
      cached=value;
      parent.postMessage(resource?{type:'neko-project-resource',id,url:resource}:{type:'neko-resource-unavailable',id},'https://pickcat.dao3.fun');
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
