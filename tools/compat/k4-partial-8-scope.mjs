// Only the measured single-body boundary main path is promoted. Shader gaps
// and origin-dependent shake timing remain partial, regardless of frequency.
import { physicsMainPaths, baseline } from './k4-partial-6-scope.mjs';
import { round7MainPaths } from './k4-partial-7-scope.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const physics8Boundary='未验证：旋转/角冲量、actor间接触、多体堆叠、复杂轮廓/compound、软体、角落同时接触、舞台外侧接触、接触中生命周期、多场景与非60Hz；只认证单个锁旋转刚体的舞台长边接触；2520帧最大残差0.118503308290px（回归<0.15px），不是严格轨迹全等';
const controls=new Set([...physicsMainPaths,...[...round7MainPaths].filter(([,s])=>s.evidence==='kitten4-partial-physics-7.md').map(([t])=>t)]);
export const round8MainPaths=new Map([
  ...[...controls].map(type=>[type,{evidence:'kitten4-partial-physics-8.md',scope:'沿用第六/七轮硬体控制认证；旧bounce/friction及四个边界负例原样重放，补四边正面/非弹性/斜入射/低速；双VM各2520帧亚像素有界',boundary:physics8Boundary}]),
  ...['self_set_boundary','physics2_set_boundary'].map(type=>[type,{evidence:'kitten4-partial-physics-8.md',scope:'四菜单边界存在/移除控制；单个锁旋转刚体的四边正面/非弹性/斜入射/低速接触，双VM各2520帧，每坐标<0.15px',boundary:physics8Boundary}]),
]);
export function scope8Markdown(report){
  const partial=report.rows.filter(r=>r.semantics==='partial'),rows=new Map(report.rows.map(r=>[r.type,r]));
  return ['# K4 partial 第八轮：滤镜与舞台边缘接触','',
    '基线 `6aaa205`（oc/integrate）；本轮修复滤镜栅格边界、ASCII与shake帧尾续接。未移植官方源码或HateNeko。',
    `本轮新增主路径认证 **2项**（boundary，加权159）；partial剩余 **${partial.length}项**，冻结95项频率加权 **${partial.reduce((n,r)=>n+(baseline[r.type]||0),0)}**。不是作品成功率或全语义认证。`,'',
    '| 类型 | 当前级别 | 证据与边界 |','| --- | --- | --- |',
    ...['self_set_boundary','physics2_set_boundary','self_set_effect_2','self_change_effect_3','self_set_effect','self_change_effect','self_change_effect_2','self_shake','set_scene_transition','physics2_set_texture','physics2_set_flexibility'].map(type=>{
      const scope=round8MainPaths.get(type),detail=scope?`${scope.scope}；${scope.boundary}；[物理专项](${scope.evidence})`:
        type.includes('effect')?'[滤镜专项](kitten4-partial-effects-8.md)：ASCII独立/常用效果与场景/舞台外twist已修复；ripple缺官方素材、ASCII组合仍有负例，不升级整setter':
        type==='self_shake'?'[shake专项](kitten4-shake-8.md)：结束归位/续接修复；零原点逐帧双VM通过，但官方时钟原点改变严格阈值，保留partial':
        type==='set_scene_transition'?'本轮未修改；distort和完成回调仍未验证':'本轮未修改；soft形变/重建仍未实现';
      return `| \`${type}\` | ${rows.get(type).semantics} | ${detail} |`;
    }),'',
    '## 证据范围','',
    '- 物理的旧>1px失败已消除；当前<0.15px残差独立公开，不把有界亚像素描述为严格全等。其他物理项继承同一范围，不认证多体/旋转接触。',
    '- 旧第六/七轮报告与JSON保留历史，不重录以隐藏负例；当前renderer由第八轮像素证据绑定。',
    '- B类40项仍partial；官方包和第三方语料只读。完整门禁、三seed语料和清理见不提交的OC-REPORT.md。',''].join('\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const text=scope8Markdown(JSON.parse(fs.readFileSync('docs/kitten4-block-coverage.json','utf8')));
  if(process.argv.includes('--write'))fs.writeFileSync('docs/kitten4-partial-8.md',text);
  else process.stdout.write(text);
}
