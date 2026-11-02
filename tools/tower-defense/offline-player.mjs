#!/usr/bin/env node
// Local KN release-cache host. No network acquisition is performed here.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {execFileSync} from 'node:child_process';

export const defaultCache='D:/AppData/Local/Temp/opencode/nekoc-kitenn/runtime-source';
const sha256=buffer=>createHash('sha256').update(buffer).digest('hex');

export async function auditReleaseCache(cache=defaultCache){
  const manifestBytes=await readFile(path.join(cache,'manifest.json'));
  const manifest=JSON.parse(manifestBytes);
  const assets=[],restoredSources=[];
  for(const item of manifest){
    const source=new URL(item.url);
    if(source.origin!=='https://creation.bcmcdn.com'||!source.pathname.startsWith('/neko/web/release/static/js/')||path.basename(source.pathname)!==item.name)
      throw new Error(`Not an official release-manifest entry: ${item.url}`);
    try{
      const bytes=await readFile(path.join(cache,item.name));
      const text=bytes.toString('utf8');
      const collectorInjection='window.__req=__webpack_require__;';
      const injected=text.includes(collectorInjection);
      const restoredSource=injected?text.replace(collectorInjection,''):text;
      restoredSources.push(restoredSource);
      assets.push({...item,actualBytes:bytes.length,sha256:sha256(bytes),recordedLengthMatches:text.length===item.bytes,
        collectorLoaderExport:injected,restoredSourceSha256:sha256(restoredSource),
        publishedHashToken:item.name.match(/\.([0-9a-f]{8})\./)?.[1],publishedDigestVerified:false});
    }catch(error){restoredSources.push(null);assets.push({...item,missing:true,error:error.message});}
  }
  // webpack RealContentHashPlugin removes an asset's own content-hash token
  // before MD4 hashing. This also removes its self-reference in sourceMappingURL.
  // OpenSSL 3 requires the legacy provider for MD4; this local child has no I/O
  // other than stdin/stdout and computes every digest in one invocation.
  const digests=JSON.parse(execFileSync(process.execPath,['--openssl-legacy-provider','-e',
    'const fs=require("node:fs"),{createHash}=require("node:crypto");const rows=JSON.parse(fs.readFileSync(0,"utf8"));process.stdout.write(JSON.stringify(rows.map(r=>r.source===null?null:createHash("md4").update(r.source.split(r.token).join("")).digest("hex"))));'],
    {input:JSON.stringify(assets.map((a,i)=>({source:restoredSources[i],token:a.publishedHashToken}))),encoding:'utf8',maxBuffer:32*1024*1024}));
  assets.forEach((a,i)=>{a.normalizedWebpackMd4=digests[i];a.publishedDigestVerified=!!digests[i]&&digests[i].slice(0,8)===a.publishedHashToken;});
  return {cache:path.resolve(cache),manifestSha256:sha256(manifestBytes),assets,
    recordedManifestMatches:assets.every(a=>!a.missing&&a.recordedLengthMatches),
    publishedDigestVerified:assets.every(a=>a.publishedDigestVerified),
    provenance:'All recorded official /neko/web/release/ CDN filenames checked against webpack normalized MD4 content hashes. This is consistency with the locally recorded published manifest, not an independent signature. Main contains exactly the collector loader-export injection, removed before checking its release hash. SHA-256 also records each cached and restored source.',
    shell:'Local test shell; official editor CSS/HTML were not recorded. Native KN compiler, runtime and renderer module factories come from the release bundles.'};
}

export async function startOfflinePlayer({project,cache=defaultCache,port=0}={}){
  const audit=await auditReleaseCache(cache);
  if(!audit.recordedManifestMatches||!audit.publishedDigestVerified)throw new Error('Release cache manifest/hash mismatch or missing bundle');
  const allowed=new Map(audit.assets.map(a=>[a.name,a]));
  const requests=[],missingAssets=[];
  const projectBytes=project?await readFile(project):null;
  const projectCopy=projectBytes?JSON.parse(projectBytes):null;
  const embeddedAssets=new Map();
  const assetResolution={mode:'test-copy-localhost-style-urls',originalProjectSha256:projectBytes?sha256(projectBytes):null,substitutions:[],onlyStyleUrlsChanged:true};
  for(const [id,style]of Object.entries(projectCopy?.styles?.stylesDict||{})){
    if(!style.url?.startsWith('data:image/svg+xml;base64,'))continue;
    const bytes=Buffer.from(style.url.slice('data:image/svg+xml;base64,'.length),'base64');
    const digest=sha256(bytes),urlPath=`/project-assets/${digest}.svg`;
    embeddedAssets.set(urlPath,{bytes,contentType:'image/svg+xml'});
    assetResolution.substitutions.push({id,name:style.name,originalUrlSha256:sha256(style.url),svgSha256:digest,bytes:bytes.length,urlPath});
  }
  const main=audit.assets.find(a=>/^main\./.test(a.name)).name;
  const bundles=['crc_libs.','base.','main-vendors.'].map(prefix=>audit.assets.find(a=>a.name.startsWith(prefix)).name);
  const cacheContext={self:{webpackChunkneko:[]},window:{}};
  // Main alone cannot execute the editor entry until vendor chunks arrive. This
  // records source factory hashes without evaluating any official module body.
  runInNewContext(await readFile(path.join(cache,main),'utf8'),cacheContext,{timeout:5000});
  const sourceFactories={...cacheContext.window.__req.m};
  for(const name of bundles){
    const chunkContext={self:{webpackChunkneko:[]}};
    runInNewContext(await readFile(path.join(cache,name),'utf8'),chunkContext,{timeout:5000});
    for(const chunk of chunkContext.self.webpackChunkneko)Object.assign(sourceFactories,chunk[1]);
  }
  const nativeModuleIds=[17028,26921,75337,83084,61248,46501,40283,68602];
  audit.nativeFactoryHashes=Object.fromEntries(nativeModuleIds.map(id=>[id,sha256(sourceFactories[id].toString())]));
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    requests.push({method:req.method,path:url.pathname});
    try{
      if(url.pathname==='/project.bcmkn'){
        if(!project){res.writeHead(404);res.end('No project selected');return;}
        res.setHeader('Content-Type','application/json');res.end(JSON.stringify(projectCopy));return;
      }
      if(url.pathname==='/original-project.bcmkn'&&projectBytes){res.setHeader('Content-Type','application/json');res.end(projectBytes);return;}
      if(embeddedAssets.has(url.pathname)){
        const asset=embeddedAssets.get(url.pathname);
        res.setHeader('Content-Type',asset.contentType);res.end(asset.bytes);return;
      }
      if(url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(url.pathname.startsWith('/static/css/')){
        // CSS is editor chrome, not the VM. Record explicitly; never pretend it was cached.
        missingAssets.push({url:url.pathname,kind:'editor-css',replacement:'empty local shell stylesheet'});
        res.setHeader('Content-Type','text/css');res.end('/* Local shell: official editor CSS absent from cache. */');return;
      }
      if(url.pathname.startsWith('/static/js/')){
        const name=path.basename(url.pathname);
        if(allowed.has(name)){
          let body=await readFile(path.join(cache,name));
          if(name===main){
            let text=body.toString('utf8');
            const marker='window.__req=__webpack_require__;';
            if(!text.includes(marker))throw new Error('Expected cache loader export is absent');
            // Only webpack loader routing changes. No module factory/VM semantics change.
            text=text.replace(marker,marker+'window.__nekocRequire=__webpack_require__;__webpack_require__.p="/";');
            body=Buffer.from(text);
          }
          res.setHeader('Content-Type','application/javascript');res.end(body);return;
        }
      }
      if(url.pathname==='/'||url.pathname==='/editor'||url.pathname==='/view'){
        res.setHeader('Content-Type','text/html; charset=utf-8');
        res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; form-action 'none'");
        res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Offline KN release verification</title><style>html,body{margin:0;background:#141923;color:#e4e9ef;font:14px sans-serif}canvas{max-width:100%}#init-loading{display:none}</style></head><body><div id="root"></div><div id="init-loading"><span></span></div><script>window.__IS_MINIPROGRAM__=false;window.__IS_KIDS__=false;window.__IS_HARDWARE__=false;window.__IS_NORMAL__=true;window.__PLAYER__=false;window.__IS_PC__=true;window.__IS_MOBILE__=false;window.__IS_PAD__=false;window.__NEKO_TIME_OBJ__={};window.__NEKO_SAVE_TIME_OBJ__={};window.__ENVIRONMENT__='release';window.__PAD_ZOOM__=1;window.__KIDS_ZOOM__=1;window.__SHOW_JUDGE_BLOCK_MESSAGE__=false;window.__SHOW_SDK_LOG__=false;window.__CODE_BLOCK_DEBUG__=false;</script>${[...bundles,main].map(name=>`<script src="/static/js/${name}"></script>`).join('')}</body></html>`);return;
      }
      missingAssets.push({url:url.pathname,kind:'uncached-asset'});
      res.writeHead(404,{'Content-Type':'text/plain'});res.end('Offline asset unavailable');
    }catch(error){res.writeHead(500,{'Content-Type':'text/plain'});res.end(error.message);}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const origin=`http://127.0.0.1:${server.address().port}`;
  for(const item of assetResolution.substitutions){item.resolvedUrl=origin+item.urlPath;projectCopy.styles.stylesDict[item.id].url=item.resolvedUrl;}
  const normalize=value=>{
    const copy=structuredClone(value);
    for(const item of assetResolution.substitutions)copy.styles.stylesDict[item.id].url='[resolved-identical-svg:'+item.svgSha256+']';
    return JSON.stringify(copy);
  };
  if(projectCopy){
    assetResolution.originalContentExcludingResolvedUrlsSha256=sha256(normalize(JSON.parse(projectBytes)));
    assetResolution.testContentExcludingResolvedUrlsSha256=sha256(normalize(projectCopy));
    assetResolution.onlyStyleUrlsChanged=assetResolution.originalContentExcludingResolvedUrlsSha256===assetResolution.testContentExcludingResolvedUrlsSha256;
    if(!assetResolution.onlyStyleUrlsChanged)throw new Error('Test copy changed non-URL project data');
    assetResolution.servedProjectSha256=sha256(JSON.stringify(projectCopy));
  }
  return {origin,audit,requests,missingAssets,assetResolution,close:()=>new Promise(resolve=>server.close(resolve))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const host=await startOfflinePlayer({project:process.argv[2],port:Number(process.env.PORT||4178)});
  console.log(JSON.stringify({url:host.origin+'/editor?previewUrl='+encodeURIComponent(host.origin+'/project.bcmkn'),audit:host.audit},null,2));
}
