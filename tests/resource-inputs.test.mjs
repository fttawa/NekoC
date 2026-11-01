import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

test("resource inputs keep literal dropdowns and accept computed numeric indices", () => {
  const dir=fs.mkdtempSync("D:/AppData/Local/Temp/opencode/nekoc-resources-");
  try {
    fs.writeFileSync(path.join(dir,"main.ts"), `onStart(()=>{
      setStyle("first"); setStyle((getVar("frame") as number)+1);
      playAudio("song"); playAudioAndWait(2); stopAudio(getVar("track"));
    });`);
    execFileSync(process.execPath,[path.resolve("ts/compile-ts.mjs"),path.join(dir,"main.ts"),path.join(dir,"out.json")]);
    const {workspaceData:{blocks,connections}}=JSON.parse(fs.readFileSync(path.join(dir,"out.json"),"utf8"));
    const all=Object.values(blocks);
    function input(block,name) {
      const [id]=Object.entries(connections[block.id]).find(([,c])=>c.input_name===name);
      return blocks[id];
    }
    const styles=all.filter(b=>b.type==="set_sprite_style");
    assert.equal(input(styles[0],"style_id").fields.style_id,"first");
    assert.equal(input(styles[1],"style_id").type,"math_arithmetic");
    assert.equal(input(all.find(b=>b.type==="play_audio"),"audio_id").fields.audio_id,"song");
    assert.equal(input(all.find(b=>b.type==="play_audio_and_wait"),"audio_id").fields.NUM,"2");
    assert.equal(input(all.find(b=>b.type==="stop_audio"),"audio_id").type,"variables_get");
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
