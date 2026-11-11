import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const output=path.resolve('dist/pickcat-rust');await mkdir(output,{recursive:true});
for(const file of ['manifest.json','content.js','capture.js','extension.js','resource.js','embedded.css','popup.html','popup.css','popup.js'])await copyFile(`extension/${file}`,path.join(output,file));
for(const file of ['play.js','play.css','player-feedback.js','player.js','extensions.js','kn-microphone.js','renderer.js','pen-k4.js','audio.js','input.js','overlay.js'])await copyFile(`web/${file}`,path.join(output,file));
await writeFile(path.join(output,'play.html'),(await readFile('web/play.html','utf8')).replaceAll('href="/','href="./').replaceAll('src="/','src="./'));
console.log(`扩展已生成：${output}`);
