// Frozen pre-round denominator; never derive it from the newly promoted rows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const baseline = Object.fromEntries(`get_3:2049 self_set_effect_2:1228 set_actor_as:1051 self_change_effect_3:735
physics2_enable_force:317 stamp:308 cloud_variables_get:296 set_velocity:250 set_scene_transition:215
physics2_set_actor_as:173 image_stamp:165 get_clone_index_property:162 cloud_variables_set:159 change_cloud_variable:114
cloud_lists_get_value:110 physics2_set_texture:103 self_enable_physics:95 self_set_friction:93 self_set_boundary:92
self_set_restitution:91 cloud_lists_append:83 physics2_set_speed:77 physics2_set_boundary:67 set_entity_show_hide:64
physics2_set_force:43 physics2_forbid_bump_with:33 cloud_lists_delete:32 cloud_lists_length:28 physics2_set_resilience:27
cloud_lists_replace:24 physics2_set_roughness:20 physics2_allow_rotate:18 self_clear_effects:16 physics2_set_gravity:14
show_hide_cloud_list:13 show_hide_cloud_variable:13 cloud_lists_is_exist:11 self_shake:10 show_ranking:10
cloud_lists_index_of:3 physics2_set_flexibility:3 physics2_set_force_in_time:2 self_disable_physics:2 is_ranking_show_hide:1
allow_rotate:0 change_volume_or_rate:0 cloud_lists_get:0 cloud_lists_insert_value:0 display_recognition_result:0
get:0 get_2:0 get_physics_property:0 get_recognition_result:0 get_voice_answer:0 hide_ranking:0 midi_get:0 midi_play_note:0
midi_play_num_note:0 midi_wait:0 on_mobile_click_btn:0 on_mobile_shake:0 on_mobile_slide:0 on_mobile_slope:0 on_shake:0
on_tilt:0 physics2_get_property:0 physics2_set_mass:0 play_ask_record:0 play_audio:0 play_audio_and_wait:0 self_ask_listen:0
self_ask_record:0 self_change_effect:0 self_change_effect_2:0 self_set_density:0 self_set_effect:0 self_set_mass:0
self_texture:0 set_costume_by_id:0 set_force:0 set_force_by_vector:0 set_gravity:0 set_gravity_by_orientation:0
set_speaking_language:0 set_velocity_by_vector:0 set_volume_or_rate:0 shock_duration:0 shock_for_n_times:0
stop_all_audios:0 text_indexOf:0 translate:0 translate_result:0 turn_on_the_camera:0 turn_on_the_qrcode_camera:0
voice_recognition:0`.split(/\s+/).map(entry => {
  const [type, count] = entry.split(":");
  return [type, Number(count)];
}));

export const serviceGroups = [
  { label: "云/账户/排行榜", evidence: "kitten4-cloud.md、kitten4-partial-cloud-2.md",
    behavior: "只用本地状态或显式注入后端；离线可读写本地云值/列表。没有官方账号权限、跨用户同步、重连、持久化和排名UI；不伪造联网成功。",
    types: `cloud_variables_get cloud_variables_set change_cloud_variable cloud_lists_get_value cloud_lists_append
      cloud_lists_delete cloud_lists_length cloud_lists_replace show_hide_cloud_list show_hide_cloud_variable
      cloud_lists_is_exist show_ranking cloud_lists_index_of is_ranking_show_hide cloud_lists_get cloud_lists_insert_value hide_ranking`.split(/\s+/) },
  { label: "相机/扫码", evidence: "kitten4-third-media.md",
    behavior: "camera默认false，打开相机走能力失败不锁；识别结果初始空串。结果展示仍排队阻塞；宿主未完成不得自动成功，viewer未接扫码UI。",
    types: ["display_recognition_result", "get_recognition_result", "turn_on_the_camera", "turn_on_the_qrcode_camera"] },
  { label: "麦克风/语音/录音", evidence: "kitten4-third-media.md",
    behavior: "语音答案初始空串；识别、问答和录音请求排队，未收到宿主完成就阻塞；无token不播录音，语言仅设置请求，音色/权限/服务未验证。",
    types: ["get_voice_answer", "play_ask_record", "self_ask_listen", "self_ask_record", "set_speaking_language", "voice_recognition"] },
  { label: "手机/方向/震动", evidence: "kitten4-third-media.md、kitten4-third-physics.md",
    behavior: "没有显式设备事件不触发hat，按钮false；震动仅输出请求、无物理效果。方向重力无真实传感器输入，不从角色角度或键盘伪造。",
    types: ["on_mobile_click_btn", "on_mobile_shake", "on_mobile_slide", "on_mobile_slope", "on_shake", "on_tilt", "shock_duration", "shock_for_n_times", "set_gravity_by_orientation"] },
  { label: "MIDI发声", evidence: "kitten4-third-media.md",
    behavior: "VM输出钢琴键索引和时长，保留等待；没有接音源的viewer/headless不发声，不伪造采样音色一致。midi_get/midi_wait的纯数据/调度属于A。",
    types: ["midi_play_note", "midi_play_num_note"] },
  { label: "在线翻译", evidence: "kitten4-third-media.md、kitten4-partial-text-2.md",
    behavior: "不访问翻译服务；translate只走失败释放，result取输入前200 UTF-16单位（falsy为空）。成功UI、缓存与在线译文未实现/未验证。",
    types: ["translate", "translate_result"] },
];
export const serviceTypes = new Set(serviceGroups.flatMap(group => group.types));

// Filled only by independently recorded original fixtures and two-mode regressions.
export const physicsMainPaths = new Set([
  "set_actor_as", "set_velocity", "self_enable_physics",
  "self_set_friction", "self_set_restitution", "physics2_set_speed", "physics2_set_force",
  "physics2_set_resilience", "physics2_set_roughness", "physics2_allow_rotate", "physics2_set_gravity",
  "self_disable_physics", "allow_rotate", "physics2_set_mass", "self_set_mass", "set_force",
  "set_force_by_vector", "set_gravity", "set_velocity_by_vector",
]);
export const propertyMainPaths = new Set(["get", "get_2", "get_3", "get_clone_index_property", "set_costume_by_id"]);
export const drawingMainPaths = new Set(["stamp", "image_stamp", "self_clear_effects"]);

export function scopeMarkdown(report) {
  const rows = new Map(report.rows.map(row => [row.type, row]));
  if (Object.keys(baseline).length !== 95 || Object.values(baseline).reduce((a, b) => a + b, 0) !== 8420) {
    throw new Error("Re-audit the frozen 95-item / 8420-occurrence baseline");
  }
  for (const [type, count] of Object.entries(baseline)) {
    if (!rows.has(type) || rows.get(type).occurrences !== count) throw new Error(`Baseline drift: ${type}`);
  }
  const all = Object.keys(baseline);
  const a = all.filter(type => !serviceTypes.has(type)), b = all.filter(type => serviceTypes.has(type));
  const promoted = all.filter(type => rows.get(type).semantics === "main-path-verified");
  const remaining = all.filter(type => rows.get(type).semantics === "partial");
  const lines = ["# K4 partial 第六轮：离线主路径与设备服务分流", "",
    "## 范围与结果", "",
    "基线 `d2d277b`（任务开始时最新本地 `oc/integrate`）：95 项 partial、语料加权8420。固定分母保留，不靠改变历史计数制造收益。",
    `A类 **${a.length}项**（离线内核可直接验证），B类 **${b.length}项**（真实设备/网络/账户/宿主输出）。分类覆盖原95项且互斥；B类的纯本地失败路径仍可离线测试，但不等于服务成功路径。`,
    `本轮 **${promoted.length}项**升级为独立的 \`main-path-verified\`，加权 **${promoted.reduce((sum, type) => sum + baseline[type], 0)}**。这不是全语义认证，也不把B类改名计入升级。`,
    `原95项的partial降为 **${remaining.length}项**，剩余加权 **${remaining.reduce((sum, type) => sum + baseline[type], 0)}**；这不是作品成功率。所有377项仍有显式映射；B类从“已实现/partial”改为“设备降级/partial”是主状态纠偏，不是新增实现。`,
    "`offline-oracle-verified`保留既有积木本体验证含义；新增级别只保证指定原创输入、固定60Hz与已列主路径。覆盖表将未验证边界独立存储，已知求解器/渲染差异仍公开，不用一次终态相同代替逐帧对比。", "",
    "## A类：按只读语料频率降序", "",
    "高频优先核验；已有可重复官方证据可以复用，不能因一个罕见宿主边界否定整项主路径。已知主要选项未完成仍保留partial；下表不把零频类型称作语料常用类型。", "",
    "静态子选项频率另存 `kitten4-partial-6-options.json`（不含作品、UUID、素材）：旧set_actor_as退出959/加入92；现代force关闭232/开启85；现代纹理hard101/soft2。效果set的scope1/2共1006，change共700；但change还含ASCII(scope7)3次、其他空间滤镜，不能把它们都叫作罕见宿主边界。频率只证明语料含此节点，不证明实际执行；本轮不声称对第三方作品做了逐分支动态覆盖。", "",
    "| 类型 | 频率 | 本轮结果 | 证据/未验证边界 |", "| --- | ---: | --- | --- |",
    ...a.map(type => { const row = rows.get(type); return `| \`${type}\` | ${baseline[type]} | ${row.semantics} | ${row.unverifiedBoundaries?.join("；") ?? row.limitations.join("；")} |`; }),
    "", "## B类：保持设备/服务降级，不虚构成功", "",
    "以下行为来自已有源码定位与回归（不是本轮新增真实服务成功实测）；每项都保留partial，主状态明确设备降级。未调用账号、摄像头、付费或在线翻译服务。", "",
    "| 分组 | 类型 | 频率 | 无设备时行为 | 证据 |", "| --- | --- | ---: | --- | --- |",
    ...serviceGroups.flatMap(group => group.types.map(type => `| ${group.label} | \`${type}\` | ${baseline[type]} | ${group.behavior} | ${group.evidence} |`)),
    "", "## 证据与复现", "",
    "- 物理控制：[逐帧命令主路径](kitten4-partial-physics-6.md)，与接触求解器误差分开。",
    "- 属性、克隆与显隐：[专项](kitten4-partial-properties-6.md)。",
    "- 效果与绘图：[专项](kitten4-partial-effects-6.md)。",
    "- 指定官方包与线上身份关系：[只读取证](compatibility/k4-online-vs-offline.md)。不移植官方源码或HateNeko。",
    "", "```powershell", "node tools/compat/k4-partial-6-scope.mjs --write",
    "node --test tests/k4-partial-6-scope.test.mjs", "```", "",
    "完整门禁、三seed语料、失败探针与风险记录见根目录不提交的 `OC-REPORT.md`。", ""];
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const report = JSON.parse(fs.readFileSync(path.join(root, "docs/kitten4-block-coverage.json"), "utf8"));
  const text = scopeMarkdown(report);
  if (process.argv.includes("--write")) fs.writeFileSync(path.join(root, "docs/kitten4-partial-6.md"), text);
  else process.stdout.write(text);
}
