// Decode local diagnostic PNGs only; no vendor/corpus assets.
import { readFile } from 'node:fs/promises';
import { loadPlaywright } from '../probe-kitten4.mjs';
const browser=await loadPlaywright().chromium.launch({headless:true,channel:'msedge'});
try{
  const page=await browser.newPage(),images=await Promise.all(process.argv.slice(2).map(async p=>'data:image/png;base64,'+(await readFile(p)).toString('base64')));
  console.log(JSON.stringify(await page.evaluate(async images=>{
    const arrays=await Promise.all(images.map(async src=>{const i=new Image();i.src=src;await i.decode();const c=document.createElement('canvas');c.width=i.width;c.height=i.height;const x=c.getContext('2d');x.drawImage(i,0,0);return x.getImageData(0,0,c.width,c.height).data;}));
    const histogram={},diff=[];
    for(let i=0;i<arrays[0].length;i+=4){const a=[...arrays[0].slice(i,i+3)],b=[...arrays[1].slice(i,i+3)],delta=Math.max(...a.map((v,j)=>Math.abs(v-b[j])));histogram[delta]=(histogram[delta]||0)+1;if(delta>8&&diff.length<60)diff.push({x:i/4%960,y:Math.floor(i/4/960),a,b});}
    return {histogram,diff};
  },images),null,2));
}finally{await browser.close();}
