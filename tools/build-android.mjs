#!/usr/bin/env node
// Cross-compiles the NekoC VM server into android/app/src/main/jniLibs.
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import path from 'node:path';
const sdk=process.env.ANDROID_HOME||process.env.ANDROID_SDK_ROOT||path.join(process.env.LOCALAPPDATA||'','Android/Sdk');
const ndkRoot=process.env.ANDROID_NDK_HOME||path.join(sdk,'ndk',existsSync(path.join(sdk,'ndk'))?readdirSync(path.join(sdk,'ndk')).sort().at(-1):'');
const host={win32:'windows-x86_64',darwin:'darwin-x86_64',linux:'linux-x86_64'}[process.platform];
const bin=path.join(ndkRoot,'toolchains/llvm/prebuilt',host,'bin');
const targets=[['aarch64-linux-android','arm64-v8a'],['x86_64-linux-android','x86_64']];
const wanted=process.argv.slice(2);
for(const [target,abi] of targets){
  if(wanted.length&&!wanted.includes(abi))continue;
  const linker=path.join(bin,`${target}26-clang${process.platform==='win32'?'.cmd':''}`);
  if(!existsSync(linker))throw Error(`NDK linker not found: ${linker}`);
  const env={...process.env,CARGO_TARGET_DIR:'target/android',[`CARGO_TARGET_${target.toUpperCase().replaceAll('-','_')}_LINKER`]:linker};
  execFileSync('cargo',['build','--release','--bin','web','--target',target],{stdio:'inherit',env});
  const dir=`android/app/src/main/jniLibs/${abi}`;mkdirSync(dir,{recursive:true});
  // Only files named lib*.so are extracted to the executable native library directory.
  copyFileSync(`target/android/${target}/release/web`,`${dir}/libnekoweb.so`);
  console.log(`${dir}/libnekoweb.so`);
}
