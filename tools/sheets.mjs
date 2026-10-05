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
    // P2-G2 的**隧道口地面层**：TUN-2 素混凝土端墙拱 + G2 U 形混凝土枕。
    //
    // ⚠ **必须登记在 `g2` 之前**：下面那个表的正则是 /^G2_/，
    //   会先把 `G2_tunnel2_*` 吃掉（first-match-wins，见文件头）。
    // ⚠ 也必须**单独一张表**：本族的取景框由「端墙下半 + 仰面 + 山体侧壁」决定，
    //   与 g2 表（纯轨道，最高点 0.0230）完全不同；并进 g2 会把那 21 张顶移位。
    //
    // 只有 2 个模型（A 组 / B 组）—— `tunnel_overlay:` 那层不含轨道，
    // G2 直接复用 TUN-2 的 `G1_tunnel2_stone_over*`，见 tools/gen-g1-tunnel.mjs。
    key: 'tunnel2g2',
    title: '隧道口 TUN-2 + G2（素混凝土端墙拱 + U 形混凝土枕；SBDA）',
    match: /^G2_tunnel2/,
  },
  {
    // P2-G2（电气化铁路 `SBDA` 那一组）的模型。
    // 目前只有试件 G2_sleeper_test —— 混凝土枕的 U 形承轨槽形状确认件。
    key: 'g2',
    title: 'G2 几何组（混凝土枕 U 形承轨槽；SBDA）',
    match: /^G2_/,
  },
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
    // A12 组（`SAC3` 第三轨地铁）的**洞口**：TUN-5 矩形洞门（人工 2026-10-03 定：不做护坡）。
    // ⚠ 必须登记在下面的 metro **之前**：那个表的正则是 /^G4_/，会先把 G4_tunnel5_* 吃掉。
    key: 'tunnel5',
    title: '地铁洞口 TUN-5（矩形洞门；SAC3）',
    match: /^G4_tunnel5/,
  },
  {
    // A12 组（`SAC3` 第三轨地铁）的轨道：BAL-H 整体道床 + SLE-5 无枕 + RAI-4 第三轨。
    // 单独一张表（同 rail 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'metro',
    title: '地铁整体道床（BAL-H + 第三轨；SAC3）',
    match: /^G4_/,
  },
  {
    // A13 组（`SBC3` 第三轨地铁 · **浮置板** `BAL-I`）的**四种带板带的板**。
    //
    //   `BAL-I` = `BAL-H` + 「板缝 + 减振垫边缘线」（人工 2026-10-05 确认门批准，方案 B）
    //   ⇒ 一个组里**只有板面变了**，于是：
    //     · 带板带的四件（直向 / 半格 / 镜像半格 / 坡道）→ **本表 `gfx/floatslab.png`**
    //     · overlay 三件 + 交叉 / 三向 / 四向三张道床板（素面）+ 洞口四件 + 桥面
    //       → **逐字复用 A12 的 `gfx/metro.png` 精灵与既有模板**（接线见
    //         src/rails/railsprite.pnml 的 `probe_underlay_floatslab`）
    //   ⚠ 单独一张表仍是必须的（同 metro / narrow / heavy 表的理由）：这 4 件与 G4 是
    //     同格位（263×149 一族的"同形变体"），并进 metro 只会白多 16 张精灵；
    //     并进别的表则会把那张表的格位顶移位。
    //   ⚠ 正则 /^G7_/ 不会被上面的 /^G4_/ 吃掉，登记在哪儿都行 —— 放在 metro 后面读着顺。
    key: 'floatslab',
    title: '地铁浮置板（BAL-I = BAL-H + 板缝 + 减振垫边缘线；SBC3）',
    match: /^G7_/,
  },
  {
    // A15 组（`NACN` 窄轨）的**洞口**：TUN-7 小断面拱（端墙外形照 TUN-1，
    // 只把拱洞与洞内轨道按 k = 0.70 收窄；几何由 tools/gen-a15-narrow.mjs 从 TUN-1 收窄而来）。
    // ⚠ 必须登记在下面的 narrow **之前**：那个表的正则是 /^G5_/，会先把 G5_tunnel7_* 吃掉。
    key: 'tunnel7',
    title: '窄轨洞口 TUN-7（小断面拱；NACN）',
    match: /^G5_tunnel7/,
  },
  {
    // A15 组（`NACN` 窄轨）的轨道：BAL-D 道床 + SLE-1 木枕 + RAI-7 窄轨（米轨 1000mm）。
    // 单独一张表（同 rail / metro 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'narrow',
    title: '窄轨（BAL-D + SLE-1 + RAI-7，k=0.70；NACN）',
    match: /^G5_/,
  },
  {
    // A5 组（`SBEN` / `SBEA` 重载）的**洞口**：TUN-6 重载加固端墙
    // （端墙加宽 0.68 → 0.768 格、洞跨 0.31 → 0.35 格、洞口一圈凸出的加固环框；
    //  几何由 tools/gen-a5-heavy.mjs 从 TUN-2 的模型派生 + 追加环框）。
    // ⚠ 必须登记在下面的 heavy **之前**：那个表的正则是 /^G6_/，会先把 G6_tunnel6_* 吃掉。
    key: 'tunnel6',
    title: '重载洞口 TUN-6（加固端墙；SBEN / SBEA）',
    match: /^G6_tunnel6/,
  },
  {
    // A5 组（`SBEN` / `SBEA` 重载）的轨道：BAL-B 厚道床 + SLE-3 混凝土宽枕（U 形槽）
    // + RAI-2 75kg/m 重轨。
    // 单独一张表（同 rail / metro / narrow 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'heavy',
    title: '重载轨道（BAL-B + SLE-3 + RAI-2；SBEN / SBEA）',
    match: /^G6_/,
  },
  {
    // A3 组（`SCDN` / `SCDA` 准高速）的**洞口**：TUN-3 现代混凝土端墙拱
    // （TUN-2 的几何 + 配色提亮统一 + 压顶刻一道顶部截水沟；
    //  几何由 tools/gen-a3-quasi.mjs 从 `G2_tunnel2_stone` / `G1_tunnel2_stone_over` 派生）。
    // ⚠ 必须登记在下面的 quasi **之前**：那个表的正则是 /^G3_/，会先把 G3_tunnel3_* 吃掉。
    key: 'tunnel3',
    title: '准高速洞口 TUN-3（现代混凝土端墙拱 + 顶部截水沟；SCDN / SCDA）',
    match: /^G3_tunnel3/,
  },
  {
    // A3 组（`SCDN` / `SCDA` 准高速）的轨道：BAL-A 标准碎石道床 + SLE-2 U 形混凝土枕
    // + RAI-1 60kg/m 轨。
    // 单独一张表（同 rail / metro / narrow / heavy 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'quasi',
    title: '准高速轨道（BAL-A + SLE-2 + RAI-1；SCDN / SCDA）',
    match: /^G3_/,
  },
  {
    // 接触网支柱 **PYL-C2（灰色混凝土圆柱）**（§1.6.5.6 的规格；`SCDA` 在用）。
    //
    // ⚠ **必须单独一张表**（而不是并进下面的 pylonstyle）：
    //   pylonstyle 现在只有 E1 早期木杆（最高 0.600 格），格位 263×**229**；
    //   C2 的柱顶帽当时到 0.676 ⇒ 并进去会把格位撑到 ≈241，**E1 那 8 条模板的 rect 全部顶移位**。
    //   （2026-10-05 整体改矮后 C2 顶 0.480（格位 210）、E1 顶 0.460（格位 207）——
    //     仍然不等，所以"一表一类"照旧；判据只看"谁最高"，与具体数值无关。）
    //   （catenary 表也不能进：atlas 按模型名排序，`G1_pylon_cyl_*` 会插在
    //     `G1_pylon_b` 与 `G1_wire_*` 之间，把 12 条导线的 rect 一起顶移位。）
    //   登记在 pylonstyle **之前**：它的正则是 /^G1_sty_/，会先把 G1_sty_cyl_* 吃掉。
    key: 'pyloncyl',
    title: '接触网支柱 PYL-C2（混凝土等径圆柱；SCDA）',
    match: /^G1_sty_cyl/,
  },
  {
    // 接触网支柱 **PYL-E1 早期木杆 + 深蓝牌**（人工 2026-10-05：「推进朝鲜电气化铁路」⇒
    // `SBDD`（3000V DC · 1955）按 §1.6.5.1 落位表用 E1；**同日改色**：「把 1.5kv 的
    // 架空线支柱的颜色标识改为浅蓝，3kv 的改成深蓝」⇒ 制式牌定案两档蓝：
    // 浅蓝 `awning_ltblue`(1500V DC) / 深蓝 `awning_dkblue`(3000V DC)，**红牌作废**）。
    //
    // 模型 `models/G1_sty_early_dkblue_a|_b.model` 与浅蓝那两件**逐字相同、只换标牌材质**
    // ⇒ 格位同样是 263×207，**不是**因为格位不同才分表。
    // 分表的理由只有一条：**atlas 按模型名排序打包**，若并进 pylonstyle，
    // `G1_sty_early_dkblue_*` 会排在 `G1_sty_early_blue_b` 之后（"b" < "d"）——
    // 这一族只有 2 个模型、插在末尾其实不会顶移位，但**下次再改形状就会**
    // （同 pyloncyl 那条注释的教训）。一表一类，谁也别赖谁。
    // 登记在 pylonstyle **之前**：它的正则是 /^G1_sty_/，会先把 G1_sty_early_dkblue_* 吃掉。
    key: 'pylondkblue',
    title: '接触网支柱 PYL-E1 早期木杆 + 深蓝牌（朝鲜电气化 SBDD）',
    match: /^G1_sty_early_dkblue/,
  },
  {
    // 接触网**支柱的样式 / 标牌变体**（人工 2026-10-03：厂矿电气化铁路 `SBEd` 要用
    // 「早期木杆 + 蓝牌」⇒ 新增 `G1_sty_early_blue_a|_b`）。
    // ⚠ 2026-10-05 起这块牌子是**浅蓝**（`awning_ltblue`，1500V DC）——
    //   「蓝牌 / 红牌」那套叫法已废，制式牌定案两档蓝：浅蓝 = 1500V / 深蓝 = 3000V
    //   （深蓝那张表是上面的 `pylondkblue`）。名字里的 `blue` 保留 = "浅蓝那个"。
    // 现有那套方形混凝土柱是 `G1_pylon_a/_b`（在下面的 catenary 表里）；
    // 本表放**别的样式 / 别的标牌**，命名 `G1_sty_<样式>_<标牌>_<a|b>`。
    //
    // ⚠ 名字刻意**不用** `G1_pylon*`：catenary 表是**前缀**正则 /^G1_(catenary|pylon|wire)/，
    //   叫 G1_pylon_xxx 就会被它先吃掉，插进那张表 ⇒ 28 条导线 + 8 条支柱模板的
    //   rect 全被顶移位（同 levelcrossing 那条注释的理由）。单独一张表只多新模板。
    key: 'pylonstyle',
    title: '接触网支柱样式（早期木杆等；与 gfx/catenary.png 分开）',
    match: /^G1_sty_/,
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
