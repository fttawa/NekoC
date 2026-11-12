// Requires a centrally built binary; this tool never invokes Cargo.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { loadPlaywright } from "../probe-kitten4.mjs";
import { saveJson } from "./k4-oracle.mjs";
import { actorId } from "./k4-partial-physics-9-fixtures.mjs";
const executable = process.env.NEKOC_K4_TRACE || "target/debug/k4-trace.exe";
const label = process.argv[2] || "current";
const report = JSON.parse(readFileSync("docs/kitten4-partial-physics-9-evidence.json"));
const source = JSON.parse(readFileSync(report.cases.coast.fixture));
const browser = await loadPlaywright().chromium.launch({ channel: "msedge", headless: true });
let costumes;
try {
  const page = await browser.newPage();
  costumes = await page.evaluate(async url => {
    const img = new Image(); img.src = url; await img.decode();
    const c = document.createElement("canvas"); c.width=Math.min(128,img.width); c.height=Math.min(128,img.height);
    const ctx=c.getContext("2d"); ctx.drawImage(img,0,0,c.width,c.height);
    const rgba=ctx.getImageData(0,0,c.width,c.height).data, bytes=Array(Math.ceil(c.width*c.height/8)).fill(0);
    for(let i=0;i<c.width*c.height;i++) if(rgba[i*4+3]>0) bytes[i>>3]|=1<<(i%8);
    return [{id:"probe-style",width:img.width,height:img.height,mask_width:c.width,mask_height:c.height,mask_bytes:bytes}];
  }, source.theatre.styles["probe-style"].url);
} finally { await browser.close(); }
const metadata="dist/k4partial9/physics/costumes.json";
await saveJson(metadata,costumes);
const result={schema:"nekoc-k4-soft-comparison-9-v1",label,maskScope:"Canvas-decoded 128x120 alpha mask for 160x120 image (CLI limit); no rendered soft deformation",executableSha256:createHash("sha256").update(readFileSync(executable)).digest("hex"),cases:{}};
for(const [name,c] of Object.entries(report.cases)) {
  result.cases[name]={};
  for(const interpreted of [false,true]) {
    const mode=interpreted?"interpreter":"default";
    const trace=JSON.parse(execFileSync(executable,[c.fixture,"--frames",String(c.frames.length),"--costumes",metadata,...(interpreted?["--interpreter"]:[])],{encoding:"utf8",maxBuffer:32*1024*1024}));
    await saveJson(`dist/k4partial9/physics/${name}.${mode}.json`,trace);
    if(trace.frames.length!==c.frames.length) throw Error(`${name}: missing frames`);
    let maxPositionPx=0,maxRotationDeg=0,worst=null;
    for(let i=0;i<c.frames.length;i++) for(const key of ["x","y","rotation"]) {
      const got=trace.frames[i].actors[actorId][key], expected=c.frames[i].actor[key], error=Math.abs(got-expected);
      if(key==="rotation") maxRotationDeg=Math.max(maxRotationDeg,error);
      else if(error>maxPositionPx) { maxPositionPx=error; worst={frame:i+1,key,got,expected}; }
    }
    const summary={frames:trace.frames.length,maxPositionPx,maxRotationDeg,worst,deformationImplemented:false,certification:"partial"};
    result.cases[name][mode]=summary; console.log(name,mode,JSON.stringify(summary));
  }
}
await saveJson(`dist/k4partial9/physics/comparison-${label}.json`,result);
await saveJson(`docs/kitten4-partial-physics-9-comparison-${label}.json`,result);
