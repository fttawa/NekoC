# K4 partial 第八轮：滤镜与舞台边缘接触

基线 `6aaa205`（oc/integrate）；本轮修复滤镜栅格边界、ASCII与shake帧尾续接。未移植官方源码或HateNeko。
本轮新增主路径认证 **2项**（boundary，加权159）；partial剩余 **54项**，冻结95项频率加权 **3191**。不是作品成功率或全语义认证。

| 类型 | 当前级别 | 证据与边界 |
| --- | --- | --- |
| `self_set_boundary` | main-path-verified | 四菜单边界存在/移除控制；单个锁旋转刚体的四边正面/非弹性/斜入射/低速接触，双VM各2520帧，每坐标<0.15px；未验证：旋转/角冲量、actor间接触、多体堆叠、复杂轮廓/compound、软体、角落同时接触、舞台外侧接触、接触中生命周期、多场景与非60Hz；只认证单个锁旋转刚体的舞台长边接触；2520帧最大残差0.118503308290px（回归<0.15px），不是严格轨迹全等；[物理专项](kitten4-partial-physics-8.md) |
| `physics2_set_boundary` | main-path-verified | 四菜单边界存在/移除控制；单个锁旋转刚体的四边正面/非弹性/斜入射/低速接触，双VM各2520帧，每坐标<0.15px；未验证：旋转/角冲量、actor间接触、多体堆叠、复杂轮廓/compound、软体、角落同时接触、舞台外侧接触、接触中生命周期、多场景与非60Hz；只认证单个锁旋转刚体的舞台长边接触；2520帧最大残差0.118503308290px（回归<0.15px），不是严格轨迹全等；[物理专项](kitten4-partial-physics-8.md) |
| `self_set_effect_2` | partial | [滤镜专项](kitten4-partial-effects-8.md)：ASCII独立/常用效果与场景/舞台外twist已修复；ripple缺官方素材、ASCII组合仍有负例，不升级整setter |
| `self_change_effect_3` | partial | [滤镜专项](kitten4-partial-effects-8.md)：ASCII独立/常用效果与场景/舞台外twist已修复；ripple缺官方素材、ASCII组合仍有负例，不升级整setter |
| `self_set_effect` | partial | [滤镜专项](kitten4-partial-effects-8.md)：ASCII独立/常用效果与场景/舞台外twist已修复；ripple缺官方素材、ASCII组合仍有负例，不升级整setter |
| `self_change_effect` | partial | [滤镜专项](kitten4-partial-effects-8.md)：ASCII独立/常用效果与场景/舞台外twist已修复；ripple缺官方素材、ASCII组合仍有负例，不升级整setter |
| `self_change_effect_2` | partial | [滤镜专项](kitten4-partial-effects-8.md)：ASCII独立/常用效果与场景/舞台外twist已修复；ripple缺官方素材、ASCII组合仍有负例，不升级整setter |
| `self_shake` | partial | [shake专项](kitten4-shake-8.md)：结束归位/续接修复；零原点逐帧双VM通过，但官方时钟原点改变严格阈值，保留partial |
| `set_scene_transition` | partial | 本轮未修改；distort和完成回调仍未验证 |
| `physics2_set_texture` | partial | 本轮未修改；soft形变/重建仍未实现 |
| `physics2_set_flexibility` | partial | 本轮未修改；soft形变/重建仍未实现 |

## 证据范围

- 物理的旧>1px失败已消除；当前<0.15px残差独立公开，不把有界亚像素描述为严格全等。其他物理项继承同一范围，不认证多体/旋转接触。
- 旧第六/七轮报告与JSON保留历史，不重录以隐藏负例；当前renderer由第八轮像素证据绑定。
- B类40项仍partial；官方包和第三方语料只读。完整门禁、三seed语料和清理见不提交的OC-REPORT.md。
