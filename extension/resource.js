// Kitten N published sources: JSON, or reversed base64 of IV(12) + AES-GCM ciphertext/tag.
// Format compatibility follows the official player's BcmHelpers.toDecryptBcmString.
// The format key is SHA-256 of byte values 0..30; it is not an account credential.
export async function decodeProject(text){
  text=text.replace(/^\uFEFF/,'').trim();
  if(text.startsWith('{'))return JSON.parse(text);
  if(!text||text.length%4!==0||!/^[A-Za-z0-9+/=]+$/.test(text))throw Error('作品资源不是有效的 Kitten N 文件');
  // Reverse in chunks to avoid an array entry for every character of a large project.
  const chunks=[];
  for(let end=text.length;end>0;end-=8192)chunks.push(text.slice(Math.max(0,end-8192),end).split('').reverse().join(''));
  try{
    const binary=atob(chunks.join('')),bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    if(bytes.length<28)throw Error('truncated');
    const digest=await crypto.subtle.digest('SHA-256',Uint8Array.from({length:31},(_,i)=>i));
    const key=await crypto.subtle.importKey('raw',digest,'AES-GCM',false,['decrypt']);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.subarray(0,12)},key,bytes.subarray(12));
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain));
  }catch{throw Error('Kitten N 作品解码失败：资源不完整或编码格式不受支持');}
}
