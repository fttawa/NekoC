import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
const require=createRequire(process.env.NEKOC_NODE_MODULES?path.join(process.env.NEKOC_NODE_MODULES,'package.json'):import.meta.url);
const {chromium}=require('playwright');
const chars=new Set(['\u200a','\u2009','\u2006','\u2002',' ']);
const inputs=process.argv.slice(2);
if(!inputs.length) inputs.push(...['96x27','128x36','160x45','192x54'].map(size=>`E:/test/eisei_pv/out/terminal/eisei_${size}.anim`));
for(const input of inputs) {
  const data=await readFile(input);
  const n=data.readUInt32LE(8), head=JSON.parse(data.subarray(12,12+n)), base=12+n;
  for(let f=0;f<head.frames;f++)for(const ch of inflateSync(data.subarray(base+head.offsets[f],base+head.offsets[f]+head.sizes[f])).toString().replace(/\x1b\[[0-9;]*[A-Za-z]/g,''))chars.add(ch);
}
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
  const page=await browser.newPage();
  const result=await page.evaluate(chars=>{
    const ctx=document.createElement('canvas').getContext('2d');ctx.font='bold 16px Arial , Microsoft YaHei';
    return Object.fromEntries(chars.map(ch=>[ch,ctx.measureText(ch).width]));
  },[...chars]);
  await writeFile('tools/eisei-font-metrics.json',JSON.stringify(result,null,2));
  console.log({glyphs:chars.size,spaces:Object.fromEntries(['\u200a','\u2009','\u2006','\u2002',' '].map(c=>[c,result[c]]))});
} finally {await browser.close();}
