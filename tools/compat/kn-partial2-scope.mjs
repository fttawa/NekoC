#!/usr/bin/env node
// Explicit scope, not a prefix heuristic that could promote offline services.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inventory } from "./kn-catalog-status.mjs";

export const mainPaths = {
  convert_type: "number/string/boolean，常见文本、空值、越界数值、列表与普通对象；沿用已有官方原生及带类型证据",
  setTimeout: "原生 statement callback 被官方编译丢弃；注册不阻塞，delay 求值一次，不擅自执行 callback",
  setInterval: "原生 statement callback 被官方编译丢弃；注册不阻塞，不擅自执行 callback",
  clearTimeout: "原生语句取消数字句柄；不存在的句柄不阻塞后续脚本",
  clearInterval: "原生语句取消数字句柄；不存在的句柄不阻塞后续脚本",
  appearance_of_sprite: "普通图像角色横纵缩放读取与两位舍入，当前/指定角色",
  get_sprite_property: "官方代码 API 到原生属性积木的映射；不是同名注册积木",
  self_dialog_wait: "官方原生非阻塞、无限时气泡；常见内容、空内容与可见性",
};

export const skippedGroups = [
  { label: "AI/OCR/聊天", evidence: "kn-panel-ai.md、kn-offline-round3.md",
    types: ["ai_chat_answer", "ai_chat_ask", "ai_text_actor", "ai_text_photo", "ai_text_result", "ai_text_result_check", "new_conversation", "set_system_preset"] },
  { label: "检测/模型/身体识别", evidence: "kn-offline-round3.md、kn-async-services.md、kn-panel-ai.md",
    types: ["bump_into_body_part", "check_emotion", "check_face_shape", "check_gender", "check_tilt_direction_of_face", "enable_face_detect_by_actor", "enable_face_detect_by_photo", "enable_object_detect_by_actor", "enable_object_detect_by_photo", "evaluate_actor_style", "evaluate_camera", "evaluate_photo", "face_to_body_part", "get_appearance_of_part", "get_evaluate_class_accuracy", "get_evaluate_class_name", "get_face_detection_result", "get_object_detection_result", "get_position_of_body_part", "get_tilt_angle_of_face", "move_to_body_part", "recognize_body_part", "recognize_gesture"] },
  { label: "摄像头", evidence: "kn-panel-capture.md",
    types: ["open_close_webcam", "open_hide_camera", "set_camera_alpha", "set_webcam_alpha"] },
  { label: "麦克风/语音", evidence: "kn-panel-capture.md、kn-remaining-official.md",
    types: ["get_voice_answer", "get_voice_volume", "voice_recognition"] },
  { label: "账户/排行榜", evidence: "kn-async-services.md、kn-panel-services.md",
    types: ["username_get", "user_id_get", "show_hide_ranking", "update_ranking", "user_ranking_info", "user_info_of_th"] },
  { label: "联网翻译", evidence: "kn-panel-services.md",
    types: ["translate", "translate_result"] },
  { label: "全局特效宿主", evidence: "kn-panel-services.md",
    types: ["global_animation"] },
];

export function scopeMarkdown(result) {
  const rows = new Map(result.rows.map(row => [row.type, row]));
  const skipped = skippedGroups.flatMap(group => group.types);
  const types = [...Object.keys(mainPaths), ...skipped];
  if (types.length !== 55 || new Set(types).size !== 55 || types.some(type => !rows.has(type))) {
    throw new Error("Re-audit the exact 55 non-hardware partial baseline");
  }
  for (const type of Object.keys(mainPaths)) {
    if (rows.get(type).status !== "有执行路径／未完整验证") throw new Error(`Unverified main path classification: ${type}`);
  }
  for (const type of skipped) {
    if (rows.get(type).status !== "部分语义") throw new Error(`Do not promote an offline service fallback: ${type}`);
  }
  const lines = [
    "# KN partial 第二轮：主路径范围与服务跳过清单", "",
    "## 结果与口径", "",
    "基线 `a397128`（任务开始时的 `oc/integrate`）：115 个 partial = 55 个非硬件 + 60 个硬件。",
    "固定频率报告仍以历史 117 项为分母，不修改历史统计来制造收益；鼠标与克隆属性已在上一轮升级。", "",
    "本轮将 **8 个**本地项从部分语义升级为**有执行路径／未完整验证**，partial **115 → 107**。",
    "**未达到至少 15 项升级的目标**：其余 47 个非硬件项需要在线/账户/检测/设备后端，或尚未接入的全局特效宿主。",
    "按任务要求写清无设备行为后跳过，不把未登录、空缓存或失败路径冒充完整主路径，也不把一个类型拆成多个选项计数。",
    "60 个硬件项全部保留部分语义。完整语义支持认证仍为 0；JIT 开启不等于每个 helper 都进入 native 热路径。", "",
    "## 8 项主路径与独立未验证边界", "",
    "- 官方 KN 0.27.4 原创夹具、同 SHA-256 的 editor-compat 检查与配对变量见 [定时器/转换](kn-partial2-timers.md) 和 [外观/属性/气泡](kn-partial2-appearance.md)。",
    "- 转换沿用 [63 条带类型观测](kn-conversion.md) 与 [51 条原生结果、45 次局部调用](kn-partial-conversion.md)；新配对不把局部调用混称原生工程。",
    "- 原生 timer callback 被丢弃是本版本官方行为，不是 NekoC 假称实现了 JS 闭包；见 [定时器边界](kn-timers.md)。", "",
    "| 类型 | 已验证主路径 | 未验证边界 |",
    "| --- | --- | --- |",
    ...Object.entries(mainPaths).map(([type, scope]) => `| \`${type}\` | ${scope} | ${rows.get(type).risk.split("未验证边界：").at(-1)} |`),
    "", "## 47 项跳过清单（保留部分语义）", "",
    "下列为既有实现/官方证据的降级摘要，**不是本轮新增官方成功实测**。各项真实服务成功路径均未实现/未验证。",
    "没有调用在线 AI、登录账号、请求摄像头或付费接口；没有移植 HateNeko 或官方源码。", "",
    "| 分组 | 类型 | 无设备/离线行为与剩余限制 | 既有官方证据 |",
    "| --- | --- | --- | --- |",
    ...skippedGroups.flatMap(group => group.types.map(type => `| ${group.label} | \`${type}\` | ${rows.get(type).risk} | ${group.evidence} |`)),
    "", "## 复现", "", "```powershell",
    "node tools/compat/kn-partial2-scope.mjs --write",
    "node tools/compat/kn-catalog-status.mjs --snapshot docs/kn-block-coverage.md",
    "node --test tests/kn-partial2-scope.test.mjs", "```", "",
    "本页由显式范围清单与覆盖工具生成；正文比较统一 CRLF/LF，证据夹具哈希不做换行归一化。",
    "最终全量门禁、三 seed 语料与未完成部分见 worktree 根目录未提交的 `OC-REPORT.md`。", "",
  ];
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const document = scopeMarkdown(inventory(root));
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(root, "docs/kn-partial2.md"), document);
  else process.stdout.write(document);
}
