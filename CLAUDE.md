# NekoC 仓库约定

## 提交与 PR

- 提交信息、PR 标题和描述里一律不加署名：不写 `Co-Authored-By`、`Claude-Session`、“Generated with Claude Code” 或任何会话链接。此约定优先于工具默认的署名设置。
- 提交的作者和提交者用 `fttawa <w17713310790@163.com>`（先确认 `git config user.name` / `user.email` 是这个身份再提交）。

## 生成积木作品

- 带参数的自制积木：定义里每个参数积木（`procedures_2_stable_parameter`）的 id 要等于过程 `params` 里对应参数的 id；每个参数引用积木（`procedures_2_parameter`）的 `mutation` 必须写 `id="<参数 id>"`。官方运行时只按这个 id 找参数，缺了就会报 `procedure_no_such_parameter`，作品一开始就停止。只写 `param_name` 不够。
- 返回值积木（`procedures_2_return_value`）要带 `items="1"` 的 mutation 和数字阴影块，与编辑器生成的格式一致。
- 用积木生成器或嫁接脚本产出或修改 `.bcmkn` 后，提交或交付前必须跑编辑器检查，`ok` 为 true 才算通过：`node tools/editor-compat.mjs <作品.bcmkn>`。
