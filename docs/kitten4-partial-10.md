# K4 partial 第十轮：滤镜与过渡旧负例修复

本轮基线 `822c57d`。**不升级覆盖等级**，不修改类型分区，不能把tol8通过解释为字节全等。

- ASCII全链65像素与hue1像素旧负例消除：真实双VM9件64帧及独立shader隔离均tol8全零。
- 无滤镜distort栅格残差消除到tol8全零，保留极少量单字节差；none/slide/fade/bounce原创纹理全零。
- K4全局启动先于场景激活创建，none-left不再多跑一次旧激活；14件910 update状态回归删除豁免后通过。
- 新增过渡全链继承夹具：fade通过，slide/distort仍为公开负例；ripple缺素材单列例外。
- 全部实现、来源定位、证据口径、未验证范围与复现命令见[专项文档](kitten4-partial-effects-10.md)。

第九轮JSON保留历史结果，第十轮hash绑定当前renderer；新证据按case拆分，单文件小于200 KB。
全部夹具为原创工作区及inline SVG，没有引入第三方作品、官方源码/资源或HateNeko实现。
