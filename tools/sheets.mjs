// =============================================================================
// tools/sheets.mjs —— 图集**分表登记表**
//
// 人工裁定（2026-10）：**不同种类的组件各自出一张 PNG**，不再挤在同一张图上。
//   轨道 / 隧道口 / 接触网 / 栏杆 …… 各一张。
//
// 为什么必须分表（而不是"想分就分"）：
//   flatiso 的打包键**只有占地**（core/atlas.mjs:16,25 `fpKey(it.footprint)`），
//   同占地的模型必然进同一张表，而且格位尺寸取**组内极值统一**
//   （atlas.mjs:37-47）。于是任何一个"高个子"模型（比如 0.57 格的隧道口）
//   会把同表所有精灵的格位一起撑大。
//   例：加隧道前格位 263×151；加了 0.57 格的隧道口后变成 263×218 ——
//   40 张轨道图**陪着重排了一遍**，全部 rect 与 yrel 失效。
//
// 本工程**不改 flatiso**（见 tools/render.mjs 开头的立场），
// 而是用 flatiso 现成的 `--models/--out/--only` 参数**按类多跑几遍**，
// 每遍只喂本类的模型 ⇒ 各自得到独立的 union frame ⇒ 各自一张 PNG。
//
// ⚠ 一个类只能产出一张表：如果某个类里混了不同占地的模型，
//   flatiso 会产出多张（1x1.png / 2x1.png…），render.mjs 会直接报错。
//   真是那样就把这个类再拆开。
//
// ⚠ 模板侧的「取哪张图」用 **NML 自带的模板参数**实现（人工裁定），
//   不要用 gcc 的 #define 宏去绕：
//       template t_G1_tunnel_stone_v0(sheet) { [..., sheet] }
//       t_G1_tunnel_stone_v0("gfx/tunnel.png")
// =============================================================================

/**
 * 分表登记。**顺序即优先级**（先匹配者胜），也决定 openttd.json 里条目的排列顺序。
 *
 *   key    输出文件名 gfx/<key>.png —— 也是模板调用时传的那个字符串
 *   title  中文说明（打印用）
 *   match  模型名（不含 .model）的匹配规则
 */
export const SHEETS = [
  {
    // 「褐色道床」那套（人工 2026-10：SADN 的道床比同组另三种更褐）。
    // 内容是 9 个带道砟的模型的机械副本（道砟 gravel → roof_shingle），
    // 由 tools/gen-g1-switches.mjs 末尾那一段吐出来。
    //
    // ⚠ 必须登记在 rail / tunnel / levelcrossing **之前**？不需要 ——
    //   `G1_brown_*` 不匹配那三张表任何一个正则。但登记在前面读起来最清楚。
    //   单独一张表也才**不会把已有那几张表的格位顶移位**。
    //   格位由哨兵 models/G1_brown_frame.model 钉死在 263×181。
    key: 'brown',
    title: '褐色道床（SADN 专用；平轨/半轨/坡道/道岔/隧道地面/道口）',
    match: /^G1_brown_/,
  },
  {
    key: 'rail',
    title: '轨道（道砟/轨枕/钢轨/道岔/交叉/坡道）',
    match: /^(probe_|G1_(crossing|junction|rail|track))/,
  },
  {
    // ⚠ 必须登记在 tunnel **之前**：下面那个表的正则是 /^G1_tunnel/，
    //   会先把 G1_tunnel2_* 吃掉（first-match-wins，见文件头）。
    //   单独一张表也才能不把 TUN-1 那 20 张精灵的格位顶移位。
    key: 'tunnel2',
    title: '隧道口 TUN-2（素混凝土端墙拱）',
    match: /^G1_tunnel2/,
  },
  {
    key: 'tunnel',
    title: '隧道口',
    match: /^G1_tunnel/,
  },
  {
    key: 'levelcrossing',
    title: '平交道口（公路 × 铁路）',
    // 2026-10 新增。**必须单独一张表**：并进 rail 表的话，模型按名字排序会插在
    // G1_crossing 后面 —— 表内每个模型占 4 个连续格位，插一个就把后面 40 张轨道图
    // 整体顶移位，templates.pnml 的 rect 全要重写。单独一张表就只多 4 条新模板。
    match: /^G1_levelcrossing/,
  },
  {
    key: 'catenary',
    title: '接触网（杆塔 / 导线）',
    match: /^G1_(catenary|pylon|wire)/,
  },
  {
    key: 'fence',
    title: '栏杆 / 护栏',
    match: /^G1_(fence|railing)/,
  },
];

/** NML 模板里那个「表名参数」的名字（只作文档用途，nmlc 不关心叫什么） */
export const SHEET_PARAM = 'sheet';

/** 模型名 → 表 key；匹配不到返回 null（调用方应当**报错**，不许静默） */
export function sheetKeyOf(modelName) {
  for (const s of SHEETS) if (s.match.test(modelName)) return s.key;
  return null;
}

/** 模型名 → 模板/调用处该用的文件串，如 "gfx/rail.png" */
export function sheetFileOf(modelName) {
  const k = sheetKeyOf(modelName);
  return k ? `gfx/${k}.png` : null;
}

/**
 * 把模型文件名列表分派到各表。
 * @param {string[]} modelFiles 形如 ['probe_track_x.model', ...]
 * @returns {{key:string,title:string,names:string[]}[]} 只含**非空**的表
 * @throws 有模型匹配不到任何表时抛错（宁可炸，也不要静默丢图）
 */
export function planSheets(modelFiles) {
  const names = modelFiles.map((f) => f.replace(/\.model$/, ''));
  const buckets = new Map(SHEETS.map((s) => [s.key, []]));
  const orphans = [];
  for (const n of names) {
    const k = sheetKeyOf(n);
    if (!k) orphans.push(n);
    else buckets.get(k).push(n);
  }
  if (orphans.length) {
    throw new Error(
      '这些模型没有归到任何一张表：' + orphans.join(', ') +
      '\n   → 去 tools/sheets.mjs 的 SHEETS 里加一条匹配规则（别让它们静默消失）'
    );
  }
  return SHEETS
    .map((s) => ({ key: s.key, title: s.title, names: buckets.get(s.key).sort() }))
    .filter((s) => s.names.length > 0);
}
