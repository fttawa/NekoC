// 生成 GitHub Pages 静态站（默认 dist/pages）：在线编译页 + wasm 播放器。
// 先执行 node packages/nekoc/build.mjs。站点只含静态文件，不需要后端。
import {access,copyFile,cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.resolve(process.argv[2]||path.join(root,'dist/pages'));
const pkg=path.join(root,'packages/nekoc');
try{await access(path.join(pkg,'dist/web/nekoc_wasm_bg.wasm'));}
catch{throw Error('缺少 packages/nekoc/dist，请先运行 node packages/nekoc/build.mjs');}

await rm(output,{recursive:true,force:true});
for(const dir of ['play/wasm','nekoc','vendor','samples'])await mkdir(path.join(output,dir),{recursive:true});

for(const file of ['index.html','app.js','style.css'])await copyFile(path.join(root,'site',file),path.join(output,file));
await writeFile(path.join(output,'logo.svg'),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#f2f2f2"/><text x="16" y="23" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-size="20" font-weight="700" fill="#111112">n</text></svg>\n');

// 播放器：静态站固定使用 wasm 后端，资源路径改为相对路径。
for(const file of ['play.js','play.css','player-feedback.js','player.js','backend.js','wasm-worker.js','extensions.js','kn-microphone.js','k4-device.js','renderer.js','pen-k4.js','audio.js','input.js','overlay.js'])
  await copyFile(path.join(root,'web',file),path.join(output,'play',file));
for(const file of ['nekoc_wasm.js','nekoc_wasm_bg.wasm'])await copyFile(path.join(pkg,'dist/web',file),path.join(output,'play/wasm',file));
const play=(await readFile(path.join(root,'web/play.html'),'utf8')).replaceAll('href="/','href="./').replaceAll('src="/','src="./')
  .replace('<head>','<head><meta name="nekoc-engine" content="wasm">');
await writeFile(path.join(output,'play/play.html'),play);

// 编译器：npm 包的浏览器入口原样复制（不含 nodejs 绑定）。
for(const file of ['browser.mjs','api.mjs'])await copyFile(path.join(pkg,file),path.join(output,'nekoc',file));
await cp(path.join(pkg,'dist/web'),path.join(output,'nekoc/dist/web'),{recursive:true});
await cp(path.join(pkg,'dist/frontend'),path.join(output,'nekoc/dist/frontend'),{recursive:true});
await copyFile(path.join(pkg,'dist/resources.mjs'),path.join(output,'nekoc/dist/resources.mjs'));

// typescript.js 是 CommonJS/全局脚本；包一层 ESM 给 import map 用。
const tsDir=path.dirname(createRequire(import.meta.url).resolve('typescript'));
const tsSource=await readFile(path.join(tsDir,'typescript.js'),'utf8');
await writeFile(path.join(output,'vendor/typescript.mjs'),`${tsSource.replace(/\n\/\/# sourceMappingURL=.*\s*$/,'\n')}\nexport default ts;\n`);
await copyFile(path.join(tsDir,'../LICENSE.txt'),path.join(output,'vendor/typescript-LICENSE.txt'));

const samples=['stage_demo.nk.ts','basic.ts','js_compat.ts','control_flow.ts','lists.ts','custom_procedures.ts'];
for(const name of samples)await copyFile(path.join(root,'samples',name),path.join(output,'samples',name));
await writeFile(path.join(output,'samples/index.json'),`${JSON.stringify(samples)}\n`);
// GitHub Pages 默认跑 Jekyll，会忽略部分文件。
await writeFile(path.join(output,'.nojekyll'),'');
console.log(`站点已生成：${path.relative(root,output)}`);
