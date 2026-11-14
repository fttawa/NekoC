// 生成 dist/pickcat-rust 扩展目录。WASM 运行时来自 packages/nekoc/dist/web，
// 先执行 node packages/nekoc/build.mjs。
import {mkdir,copyFile,readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve(process.argv[2]||'dist/pickcat-rust');await mkdir(path.join(output,'wasm'),{recursive:true});
const wasm='packages/nekoc/dist/web';
try{await access(path.join(wasm,'nekoc_wasm_bg.wasm'));}
catch{throw Error(`缺少 ${wasm}/nekoc_wasm_bg.wasm，请先运行 node packages/nekoc/build.mjs`);}
for(const file of ['manifest.json','content.js','capture.js','extension.js','resource.js','embedded.css','popup.html','popup.css','popup.js'])await copyFile(`extension/${file}`,path.join(output,file));
for(const file of ['play.js','play.css','player-feedback.js','player.js','backend.js','wasm-worker.js','extensions.js','kn-microphone.js','k4-device.js','renderer.js','pen-k4.js','audio.js','input.js','overlay.js'])await copyFile(`web/${file}`,path.join(output,file));
for(const file of ['nekoc_wasm.js','nekoc_wasm_bg.wasm'])await copyFile(path.join(wasm,file),path.join(output,'wasm',file));
await writeFile(path.join(output,'play.html'),(await readFile('web/play.html','utf8')).replaceAll('href="/','href="./').replaceAll('src="/','src="./'));
console.log(`扩展已生成：${output}`);
