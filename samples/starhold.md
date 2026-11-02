# 星垒 / STARHOLD

**原生Kitten N塔防离线交付版。** 作品：[starhold.bcmkn](starhold.bcmkn)，900×562，65个原生角色、51个内嵌SVG造型。无需外部素材；图形使用角色造型，文字使用原生文字印章。

## 开始与操作

在Kitten N编辑器中导入`.bcmkn`，点击开始。标题按Enter或点击PLAY，选择六个关卡之一。

| 操作 | 按键 |
|---|---|
| 选塔 | 1脉冲 / 2冰棱 / 3震爆 / 4棱镜，也可点右侧 |
| 建造、选已有塔 | 点击编号基座 |
| 升级 / 出售60% | U / X |
| 下一波 / 暂停恢复 | Space / P |
| 回标题 | **B**（官方过滤Esc） |
| 说明 / 设置 | H / O |
| 画质 / 震动 | Q；设置中S |
| 本地榜单 / 本地留言 | L / C；数字1–6选关或加入短语 |
| 结算后重试 / 选关 | R / Enter |

四种防御塔各三级，六类敌人含Boss，六关共40波。守住20生命核心，胜利且生命至少18、没有出售可获三星。开局建议：4号基座脉冲升满，再补2号震爆；详见[平衡与攻略](../docs/tower-defense-balance.md)。

## 验收与限制

- 官方缓存发布代码的**原生播放加载器、编译器、运行器、渲染器**已实测；不是NekoC自己的播放器。资源摘要和运行工厂校验一致，51造型全部加载。
- 现存缓存缺独立发布作品播放器外壳及部分编辑器界面资源。**尚不能声明已通过官方独立发布版播放器验收。** 原生离线播放通过不替代该项。
- **云功能未接入。** L/C仅当前会话本地记录；不发送、不保存到云端、不展示其他玩家。使用6句白名单、16 UTF-16单位上限、30秒冷却、12条保留上限。云限制和9标量格式在[云文档](../docs/tower-defense-cloud.md)。
- 普通场景约64–80控制器更新FPS；24敌压力场景约18–19更新FPS，自动低画质已触发仍未达到30目标。rAF高于逻辑更新频率，不混作游戏FPS。
- 六关共用路径，按造型、生命系数、波数和敌人组合变化；不保证每种策略下难度严格单调。无音频，未做移动端专门适配。星级和最好分关闭后不保留。
- 未登录、未发布、未操作账号；本地验证阻断全部外部HTTP/WebSocket。

## 文档与证据

- [设计文档](../docs/tower-defense-design.md)
- [里程碑、帧率与已知问题](../docs/tower-defense-progress.md)
- [特效性能](../docs/tower-defense-effects.md)
- [最终本地功能验收](starhold-verification/m5/report.json)
- [M3完整自然胜负](starhold-verification/m3/report.json)
- [最终第六关完整三星战役](starhold-verification/final-campaign/report.json)：正常280金币，240击杀，48890分，20生命，68步真实输入无数值注入。
- [完成清单和未完成项](../docs/tower-defense-delivery.md)

## 重建

在当前NekoC工作区、Python3、Node/TypeScript依赖和已构建的`target/debug/nekoc.exe`可用时：

```powershell
python tools/build-starhold.py --milestone 5
.\target\debug\nekoc.exe validate samples/starhold.bcmkn
node --test tests/tower-defense-core.test.mjs tests/tower-defense-artifact.test.mjs tests/tower-defense-cloud.test.mjs
```

构建脚本只生成原生积木和内嵌造型；`samples/starhold.ts`是生成后的完整源。`core.ts/ui.ts/cloud.ts`、`effects.py`和`assets.py`为维护入口。官方离线验证另依赖已有本地发行缓存和Playwright，路径和范围见`tools/tower-defense/OFFLINE-STATUS.md`。现有其他NekoC开发改动未包含在STARHOLD里程碑提交中。

交付SHA256：`23e2171f88dc60f1cd6a49f1deecbce9ffb9a72caeb7b3bf2a82c217e088d674`。
