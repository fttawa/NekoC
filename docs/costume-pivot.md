# 造型中心点：坐标约定与 VM 对齐

## 官方源码证据（2026-11-09）

本次重新下载以下官方发行包核对，不以第三方运行器作为官方证据。源码包只保存在当前 worktree 忽略的 `dist/pivot-evidence/`，不入库。下面的位置使用 Webpack 模块号、方法名和可搜索原文定位。

| 官方 URL | SHA-256 |
| --- | --- |
| `https://creation.bcmcdn.com/neko/web/release/static/js/main.8ccf2442.js` | `58123fcf43cf793d19372fc822750f9899a4375404de61c541f06e915c2b8165` |
| `https://creation.bcmcdn.com/neko/web/release/static/js/crc_libs.8196dbd1.js` | `462bb78dc75f99002dfe628d15211941469aa01d71e12890327eedcdb142f8a7` |
| `https://creation.codemao.cn/kitten/build/kitten.99f88a64d495cf0e79d0.js` | `1ffbfced591fd00d2ad604a00211cfcbd1a35e6ad3fcbe6ff7107a3ba76daaa2` |

1. **Kitten N：项目字段进入运行器。** 主包模块 **97339**，加载角色时使用 `o.add_style({style_id:t,texture_id:t,pivot:n.centerPoint||{x:0,y:0}})`，没有加图片半宽、反转 y 或乘缩放。
2. **Kitten N：相对图片中心的像素偏移。** CRC 模块 **61248** 的 Actor 构造函数设置 `i.anchor.set(.5,.5)`；`set_current_style` 将 `e.pivot.x/e.pivot.y` 直接传给 `set_pixi_pivot`。模块 **1753** 的中心点函数（导出 `kF`）先算 `e.x-t.pivot.x*t.scale.x`、`e.y-t.pivot.y*t.scale.y`，再绕角色位置以 `t.rotation` 旋转。Actor 的 `get_position/get_center_position` 返回值把内部 y 取负。这证明 pivot 是图片中心为原点、未缩放像素、x 向右、y 向下；舞台坐标则 y 向上。
3. **Kitten 4：同样的运行器约定。** 官方编辑器 `https://kitten4.codemao.cn/` 当前 HTML 引用上表 K4 包。模块 **HP1x** 的 `add_actor` 使用 `pivot:Ar.e.getDoc().theatre.styles[e].rotate_center`；同模块运行器的 `set_current_style` 调用 `set_pixi_pivot(t.pivot.x,t.pivot.y)`。其 `map_local_point_to_pivot` 先减去 `pivot * scale` 所确定的图片中心，再逆旋转并除以 scale；`get_position/get_center_position` 同样把内部 y 取负。没有坐标制转换。
4. **直接的跨版本证据。** Kitten N 主包模块 **68602** 的导入迁移代码是 `s.rotate_center&&(s.centerPoint=s.rotate_center,delete s.rotate_center)`，同样没有轴向或单位转换。因此 `src/kitten4.rs` 的现有重命名是正确的。

这些是官方源码核对，不是本次官方编辑器截图或像素实测。没有移植 HateNeko 逻辑。

## 几何公式

角色位置为 `(ax, ay)`，图片原始尺寸 `(iw, ih)`，中心点 `(px, py)`。先依照 `web/renderer.js` 的 `spriteGeometry` 得到带符号的绘制尺寸 `(w, h)` 和顺时针角度 `θ`：

- `w = iw * scale/100 * size_x/100`，`h` 同理。
- `rotation_type=0`：`θ = (direction - costume_turn) * π/180`。
- `rotation_type=1`：角度为零；按渲染器对减去 `costume_turn` 后方向的归一化结果，向左时取反 `w`。
- 其他不可旋转模式：角度为零。
- KN 的 `costume_turn=0`，K4 为 `90`。传给浏览器的角色和图片盖章方向已经减去了此值，VM 内部计算时只减一次。

然后算图片中心：

```text
dx = -px * w/iw
dy =  py * h/ih
x = ax + cos(θ)*dx + sin(θ)*dy
y = ay - sin(θ)*dx + cos(θ)*dy
```

`CostumeGeometry` 统一提供外接边界、舞台点到纹理 UV 的逆变换、UV 到舞台点的正变换。角色碰撞、鼠标命中、四边检测、越界、颜色碰撞、画笔栅格盖章均复用此变换。文字造型的 pivot 固定为零。背景仍保持现有铺满舞台策略，本任务不改变背景适配。

图片盖章的帧命令保留**角色位置**与绘制方向；浏览器 `drawImageStamp → actorGeometry` 负责偏移，不能在帧命令里再偏移一次。VM 的颜色栅格盖章通过相同几何对象采样。

## 错误策略与兼容范围

- VM 接口和项目元数据中的缺省、非数字、非有限中心点分量分别按零处理；`set_costume` 原有的非有限宽高拒绝策略不变。
- 浏览器素材加载时原有的无效中心点错误提示、跳过该素材的行为不变；未将此错误静默吞掉。
- 零中心点的居中位置、边界、普通旋转和缩放保持原公式；原有测试保留。额外修复了 VM 原先漏做的左右翻转遮罩，所以**零中心点、非对称遮罩、左右翻转模式**的命中会有意改变，以匹配已存在的渲染器行为，并非所有旧错误行为都保持不变。
- 非零中心点反弹后以新方向重算边界再移回舞台。零中心点保留旧反弹修正方式，避免扩大行为变更。
- 碰撞仍使用现有低分辨率遮罩和有上限的采样，并不是逐像素精确碰撞；颜色效果仍只有透明度参与。本次没有改变这些限制。

## 回归覆盖

`tests/pivot-cases.json` 是 Rust 和实际 JS 私有几何函数共用的 11 组数值用例：KN/K4、0°/90°、非等比缩放、左右翻转、不旋转、负轴尺寸。Rust 另外测试透明遮罩、颜色正逆变换、角色重叠、鼠标、边界、反弹、画笔栅格盖章、零中心点及非法分量；Web 接口测试中心点与遮罩一起注册；JS 测试造型注册数据和图片盖章不重复偏移；K4 集成测试中心点导入导出不做轴向转换。

**未验证：** 本次未做官方编辑器的端到端像素截图比较；滤镜导致的碰撞范围变化、超大造型反弹、背景中心点适配不在本任务验证范围内。
