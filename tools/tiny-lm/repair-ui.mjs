#!/usr/bin/env node
// Inline only the two drawing helpers. Model arithmetic and Chinese UI stay intact.
import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function repairUi(source){
  for(const [name,signature]of [
    ['lm card','function lmCard(x1:number,y1:number,x2:number,y2:number):void {'],
    ['lm key','function lmKey(x:number,y:number,w:number,key:NekoValue):void {'],
  ]){
    const header=name==='lm card'?'defineProc("lm card",["x1","y1","x2","y2"],()=>{':'defineProc("lm key",["x","y","w","key"],()=>{';
    const start=source.indexOf(header);
    if(start<0||source.indexOf(header,start+1)>=0)throw new Error(`Expected exactly one ${name} definition`);
    const end=source.indexOf('\n});',start);
    if(end<0)throw new Error(`Missing end of ${name}`);
    const body=source.slice(start+header.length,end)
      .replace(/param\("(x1|y1|x2|y2|x|y|w|key)"\)/g,'$1')
      .replace('getVar("lm_ui_y")<','(getVar("lm_ui_y") as number)<');
    if(body.includes('param('))throw new Error(`Unexpected parameter in ${name}`);
    source=source.slice(0,start)+signature+body+'\n}'+source.slice(end+4);
    source=source.replaceAll(`callProc("${name}",`,name==='lm card'?'lmCard(':'lmKey(');
  }
  return source;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);
  if(!input||!output||path.resolve(input)===path.resolve(output))throw new Error('Usage: node repair-ui.mjs original.ts separate-compatible.ts');
  await writeFile(output,repairUi(await readFile(input,'utf8')),'utf8');
  console.log(`Compatible source saved: ${path.resolve(output)} (original unchanged)`);
}
