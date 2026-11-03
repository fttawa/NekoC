import {readdir,readFile,writeFile} from 'node:fs/promises';

// Use the same representative subset as the initial compatibility baseline.
const results=[];
for(const name of await readdir('samples')){
  if(!name.endsWith('.bcmkn')||/eisei_pen_128_|pencraft-before|pencraft_flicker/.test(name))continue;
  const response=await fetch('http://127.0.0.1:4173/api/import-player',{method:'POST',body:await readFile(`samples/${name}`)});
  if(!response.ok)throw Error(`${name}: HTTP ${response.status}`);
  const report=await response.json();
  const item={name,ready:report.fast_runtime_ready,diagnostics:report.script_diagnostics};
  results.push(item);console.log(JSON.stringify(item));
}
const summary={total:results.length,ready:results.filter(r=>r.ready).length,projects:results};
await writeFile(process.argv[2]||'docs/web-compatibility-audit.json',JSON.stringify(summary,null,2));
console.log(`Ready: ${summary.ready}/${summary.total}`);
