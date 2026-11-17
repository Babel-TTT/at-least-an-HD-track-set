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
    // A14 组（`SACL` 直线电机）的**洞口**：仍是 TUN-5 矩形洞门（逐字照抄 A12），
    //   只把洞内那层轨道加上**中央连续反应板**（`tools/gen-a12-metro.mjs` 第 12f 节）。
    // ⚠ 必须登记在下面的 linear **之前**：那个表的正则是 /^G17_/，会先吃掉 G17_tunnel5_*。
    key: 'tunnel5linear',
    title: '地铁洞口 TUN-5（矩形洞门，洞内含反应板；SACL）',
    match: /^G17_tunnel5/,
  },
  {
    // A14 组（`SACL` 直线电机 · 2005 · 90km/h）的轨道：
    //   `BAL-J` 整体道床 + **中央连续反应板**（宽 0.35 m）+ `SLE-5` + `RAI-6` + 第三轨。
    //   与 A12（`SAC3`）**只差那块反应板**；overlay 三件与三向/四向道岔板直接复用 A12 的。
    // 单独一张表（同 rail / metro 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'linear',
    title: '直线电机道床（BAL-J + 中央反应板 + 第三轨；SACL）',
    match: /^G17_/,
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
    // A13 组（`SBC3` 第三轨地铁 · 道床 `BAL-I` = **浅色混凝土素面板**）的
    // **七件"有板面"的模型**。
    //
    //   `BAL-I` = `BAL-H` 的板带**换板面材质**（`concrete_mid` → `concrete_light`），
    //   几何逐字相同、没有板缝/减振垫/边缘线（人工 2026-10-06 改口径，见
    //   tools/gen-a12-metro.mjs §11）。**凡是有板面的都要重画**：
    //     · 带板带的四件（直向 / 半格 / 镜像半格 / 坡道）
    //     · **交叉 / 三向 / 四向**三张道床板（板面变浅后不能再复用 A12 的中灰板，
    //       否则岔口露出一块中灰）
    //   仍然复用 A12 的 `gfx/metro.png` 精灵与既有模板的：overlay 三件（纯钢轨层）、
    //   洞口四件（TUN-5）、桥梁以外的其余（接线见
    //   src/rails/railsprite.pnml 的 `probe_underlay_floatslab`）。
    //   ⚠ 单独一张表仍是必须的（同 metro / narrow / heavy 表的理由）：这 7 件与 G4 是
    //     同格位（263×147 一族的"同形变体"），并进 metro 只会白多 28 张精灵；
    //     并进别的表则会把那张表的格位顶移位。
    //   ⚠ 正则 /^G7_/ 不会被上面的 /^G4_/ 吃掉，登记在哪儿都行 —— 放在 metro 后面读着顺。
    key: 'floatslab',
    title: '地铁浅色混凝土道床（BAL-I = BAL-H 换板面材质；SBC3）',
    match: /^G7_/,
  },
  {
    // A10 组（`SGCA` 高速无砟 CRTS III）的**洞口**：TUN-4 高速大跨度环框拱（帽檐）
    // （几何由 tools/gen-a10-slab.mjs 从 `G3_tunnel3*` 派生：端墙加宽到 0.80 格、
    //  洞跨加宽到 0.40 格、拱顶抬到 0.215，再在洞口正面加一圈挑出的帽檐）。
    // ⚠ 必须登记在下面的 crts3 **之前**：那个表的正则是 /^G8_/，会先把 G8_tunnel4_* 吃掉。
    // ⚠ 2026-10-21：`G8_tunnel4s4_*`（洞内枕木 = SLE-4 的 SGCA 变体）**另立一张表**
    //   ⇒ 本表的正则加负向先行断言让路（同前缀、first-match-wins）。
    key: 'tunnel4',
    title: '高速洞口 TUN-4（大跨度环框拱 + 帽檐；洞内 BAL-E 板 + SLE-3；SCCA / SDCA）',
    match: /^G8_tunnel4(?!s4|n|f)/,
  },
  {
    // `SECA`（A25 · `BAL-N` 有砟·高速）专用洞口：`TUN-4` 的门，洞内 = **砟肩堆高断面 + SLE-3**
    //   （人工 2026-10-21 第二轮：「SFCA,SECA,SDCA 没改」）。
    key: 'tunnel4n',
    title: '高速洞口 TUN-4 · SECA 变体（洞内 BAL-N 砟肩堆高 + SLE-3）',
    match: /^G8_tunnel4n/,
  },
  {
    // `SFCA`（A9 · `BAL-F` 无砟·CRTS II 纵连板）专用洞口：洞内 = **沿轨纵缝板 + SLE-3**。
    key: 'tunnel4f',
    title: '高速洞口 TUN-4 · SFCA 变体（洞内 BAL-F 纵缝板 + SLE-3）',
    match: /^G8_tunnel4f/,
  },
  {
    // A10 组（`SGCA`）**自己的**洞口：TUN-4 的门，但洞内枕木 = **`SLE-4` 双块式**
    //   （人工 2026-10-21：「包括 A+B，SGCA 一并改了」）。只 2 件（A/B 组的 ground 层），
    //   `tunnel_overlay:` 那两件不含轨道 ⇒ 直接复用 `G8_tunnel4_over*`，不重出。
    key: 'tunnel4s4',
    title: '高速洞口 TUN-4 · SGCA 变体（洞内 BAL-G 承轨台 + SLE-4 双块式）',
    match: /^G8_tunnel4s4/,
  },
  {
    // A10 组（`SGCA` 高速无砟 CRTS III）的轨道：BAL-G 无砟板（两条承轨台 + 三条低带）
    // + SLE-4 双块式 + RAI-3 长轨。
    // 单独一张表（同 rail / metro / floatslab 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'crts3',
    title: '高速无砟 CRTS III（BAL-G + SLE-4 + RAI-3；SGCA）',
    match: /^G8_/,
  },
  {
    // A8 组（`SCCA` 城际 160 / `SDCA` 客专 210，25kV AC）的轨道：
    // **BAL-E 无砟·CRTS I 单元板**（素面板 + 板缝 1/3 格 + 凸形挡台）+ SLE-3 混凝土宽枕
    // （U 形承轨槽，与 A5 重载组共用同一批模型口径）+ RAI-3 长轨。
    // 几何由 tools/gen-a8-crts1.mjs 从 `G1_*` 派生（删道砟 → 换 BAL-E 板；钢轨只换材质）。
    //
    // ⚠ **洞口不在这张表里**：`TUN-4` 直接复用 A10 的 `gfx/tunnel4.png`
    //   （`probe_tunnels_4` / `probe_tunnel_over_4`），一件模型都不重出。
    // ⚠ 单独一张表（同 rail / metro / crts3 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'crts1',
    title: '城际无砟 CRTS I（BAL-E 单元板 + SLE-3 宽枕 + RAI-3 长轨；SCCA / SDCA）',
    match: /^G9_/,
  },
  {
    // A25 组（`SECA` 高速铁路 250km/h，25kV AC）的轨道：**`BAL-N` 有砟·高速道床**
    //   —— 砟肩堆高 0.15 m（砟肩顶 0.0188）· 砟肩宽 0.5 m · 边坡 1:1.75 · 坡脚 0.1644
    //   · 特级道砟 `granite_grey`；轨枕 `SLE-3` 混凝土宽枕（U 形承轨槽，与 A5 / A8 共用
    //   同一批模型口径）+ 钢轨 `RAI-3` 长轨。
    // 几何由 tools/gen-a9-hsballast.mjs 从 `G1_*` 派生（删道砟 → 按断面重铺高度场；
    // 钢轨只换材质），规格见 `美术要素方案.md` §1.1 的 `BAL-N` 那一节。
    //
    // ⚠ **洞口不在这张表里**：`TUN-4` 直接复用 A10 的 `gfx/tunnel4.png`，一件模型都不重出。
    // ⚠ **本组没有平交道口**：`SECA` 带 `RAILTYPE_FLAG_NO_LEVEL_CROSSING`（人工 2026-10-06 裁定）。
    // ⚠ 单独一张表（同 rail / metro / crts3 / crts1 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'hsballast',
    title: '高速有砟 BAL-N（砟肩堆高 + SLE-3 宽枕 + RAI-3 长轨；SECA）',
    match: /^G10_/,
  },
  {
    // A9 组（`SFCA` 高速铁路 310km/h，25kV AC）的轨道：**`BAL-F` 无砟·CRTS II 纵连板**
    //   —— 板顶 **0.0078**（与 A5 `BAL-B` / A8 `BAL-E` / A25 `BAL-N` 同一个数）·
    //   **横向宽接缝每 1 格**（宽 0.0100 / 深 0.0028 / 缝内 `panel_seam`）·
    //   ★ **板面正中一条沿轨纵缝**（CRTS II 的纵向施工缝，同规格）· **不放凸形挡台**；
    //   轨枕 `SLE-3` 混凝土宽枕（U 形承轨槽，与 A5 / A8 / A25 共用同一批模型口径）
    //   + 钢轨 `RAI-3` 长轨。
    // 几何由 tools/gen-a11-crts2.mjs 从 `G1_*` 派生（删道砟 → 铺 `BAL-F` 板；钢轨只换材质），
    // 规格见 `美术要素方案.md` §1.1 的 `BAL-F` 那一节。
    //
    // ⚠ **洞口不在这张表里**：`TUN-4` 直接复用 A10 的 `gfx/tunnel4.png`，一件模型都不重出
    //   （`TUN-4` 是四条 `S_CA` 共用的洞口）。
    // ⚠ **本组没有平交道口**：`SFCA` 带 `RAILTYPE_FLAG_NO_LEVEL_CROSSING`（310 高铁全封闭，
    //   人工 2026-10-08 口径；与 `SGCA` / `SECA` 一致）⇒ 表里只有 10 件（比 A8 少一件）。
    // ⚠ 单独一张表（同 rail / metro / crts3 / crts1 / hsballast 表的理由：混进去会把已有
    //   几十条 `rect` 顶移位）。
    key: 'crts2',
    title: '高速无砟 CRTS II 纵连板（BAL-F + SLE-3 宽枕 + RAI-3 长轨；SFCA）',
    match: /^G11_/,
  },
  {
    // A6 组（`SDDA`）**自己的**洞口：`TUN-3` 的门（A3 的口径：端墙 + 截水沟 + 翼墙），
    //   洞内换成 `SLE-3` 宽枕 + `RAI-3` 配色（人工 2026-10-21）。
    //   只 2 件（A/B 组的 ground 层），overlay 复用 A3 的 `G3_tunnel3_over*`。
    // ⚠ 必须登记在下面的 quasifast **之前**：那个表的正则是 /^G12_/，会先把本族吃掉。
    key: 'tunnel3fast',
    title: '现代洞口 TUN-3 · SDDA 变体（洞内 SLE-3 + RAI-3）',
    match: /^G12_tunnel3/,
  },
  {
    // A6 组（`SDDA` 电气化快速 200km/h，25kV AC，秦沈客专）的轨道：
    //   **`BAL-A` 有砟·标准碎石**（灰褐碎石，带宽 **0.36** 格 = 枕长 0.18 + 两肩各 0.09，
    //   道床顶面 **0.0078**、**平断面不做砟肩堆高**、外缘拉直、粒径台阶 0.0011 格、
    //   材质 `gravel` 156,149,138）+ 轨枕 `SLE-3` 宽枕（U 形承轨槽，与 A5 / A8 / A25 / A9
    //   共用同一批模型口径）+ 钢轨 `RAI-3` 长轨。
    // 几何由 tools/gen-a6-fast.mjs 从 `G1_*` 派生（删道砟 → 按 `BAL-A` 平断面重铺，
    // 钢轨只换材质 + 探出），规格见 `美术要素方案.md` §1.1 的 `BAL-A` 那一节。
    //
    // ⚠ **洞口不在这张表里**：`TUN-3` 直接复用 A3 的 `gfx/tunnel3.png`，一件模型都不重出。
    // ★ **本组有平交道口**（人工 2026-10-21 确认门点名「要平交道口」）⇒ 表里 11 件，
    //   与 A8（`crts1`）同数；`SDDA` 因此**不带** `RAILTYPE_FLAG_NO_LEVEL_CROSSING`。
    // ⚠ 单独一张表（同 rail / metro / crts3 / crts1 / hsballast / crts2 表的理由：
    //   混进去会把已有几十条 `rect` 顶移位）。
    key: 'quasifast',
    title: '有砟标准碎石 BAL-A（平断面 + SLE-3 宽枕 + RAI-3 长轨；SDDA）',
    match: /^G12_/,
  },
  {
    // A11 组的**洞口 ground 层**（TUN-5 的 A11 版：洞内**没有第三轨与木罩**）。
    //   人工 2026-11-13 实机：「但是隧道怎么还是第三轨的」—— 原来复用 A12 的
    //   `probe_tunnels_metro`，洞外（交叉 / 三向 / 四向）早就没有接触轨了，
    //   一进洞却冒出一条 `rust` 接触轨 ＋ `wood_dark` 木罩。
    //   两件模型（A 组远半 / B 组近半）由 tools/gen-a11-metro-dc.mjs 用**同一批洞口
    //   函数**重出，面数 65 → 63（只少那两根通长 box）；`_over` 两层不含轨道 ⇒ 复用 A12 的。
    // ⚠ 必须登记在下面的 dcmetro **之前**：那个表的正则是 /^G13_/，会先吃掉
    //   `G13_tunnel5*`（同 tunnel5 / tunnel7 / tunnel3fast 表的教训）。
    key: 'tunnel5dc',
    title: '地铁洞口 TUN-5（A11 版：洞内无第三轨；SACd / SBCd）',
    match: /^G13_tunnel/,
  },
  {
    // A11 组（`SACd` 1979·80 / `SBCd` 1998·140，1500V DC 地铁）的轨道：
    //   **`BAL-H` 浮置板 + `SLE-5` 混凝土枕 + `RAI-1` 60kg/m 钢轨 + `TUN-5` 洞口**，
    //   与已装机的 A12（`SAC3` 第三轨地铁）**只差"没有第三轨与罩"**。
    // 几何由 tools/gen-a11-metro-dc.mjs 生成（= `gen-a12-metro.mjs` 的同源副本，
    // 每个 `trackShapes()` 调用补 `third: false`；洞口不重出，复用 A12 的 `gfx/tunnel5.png`）。
    //
    // ⚠ **本组没有平交道口**（`SACd` / `SBCd` 与 `SAC3` 一样带
    //   `RAILTYPE_FLAG_NO_LEVEL_CROSSING`）⇒ 表里 10 件（比 A12 少一件道口图，
    //   比 A8 少一件道口图与两件镜像件）。
    // ⚠ 单独一张表（同 rail / metro / crts3 / crts1 / hsballast / crts2 / quasifast 表的
    //   理由：格位由本表自己的极值决定，混进去会把已有几十条 `rect` 顶移位）。
    key: 'dcmetro',
    title: '地铁直流 BAL-H（浮置板 + SLE-5 + RAI-1，无第三轨；SACd / SBCd）',
    match: /^G13_/,
  },
  {
    // A16 组（`NBCN` 现代窄轨 / `NBCA` 电气化窄轨）的**洞口**：
    //   就是 A15 的 `TUN-7`（**逐字照抄**，只把洞内那层 SLE-1 木枕换成 SLE-2 混凝土枕）。
    //   几何由 tools/gen-a16-narrow-modern.mjs 生成（底板 = A15 产物，枕木借 A3 的 SLE-2）。
    // ⚠ 必须登记在下面的 narrowmodern **之前**：那个表的正则是 /^G14_/，会先吃掉 G14_tunnel7_*。
    key: 'tunnel7modern',
    title: '现代窄轨洞口 TUN-7（小断面拱，洞内 SLE-2；NBCN / NBCA）',
    match: /^G14_tunnel7/,
  },
  {
    // A16 组（`NBCN` / `NBCA`）的轨道：BAL-D 道床 + **SLE-2 混凝土枕** + RAI-7 窄轨（米轨 1000mm）。
    //   与 A15（`NACN`）**只差轨枕那一层**（SLE-1 木枕 → SLE-2 混凝土枕），道床 / 钢轨 / 洞口逐面相同。
    // 单独一张表（同 rail / metro / narrow 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'narrowmodern',
    title: '现代窄轨（BAL-D + SLE-2 + RAI-7，k=0.70；NBCN / NBCA）',
    match: /^G14_/,
  },
  {
    // A17 组（`NCCA` 高速窄轨）的**洞口**：仍是 TUN-7（**逐字照抄** A15），
    //   只把洞内那层枕木换成 `SLE-3` 混凝土宽枕（A5 / A8 / A25 / A9 / A6 同一批）。
    //   几何由 tools/gen-a16-narrow-modern.mjs 的 A17 那支生成（底板 = A15 产物，枕木借 A5 的 SLE-3）。
    // ⚠ 必须登记在下面的 narrowhs **之前**：那个表的正则是 /^G15_/，会先吃掉 G15_tunnel7_*。
    key: 'tunnel7hs',
    title: '高速窄轨洞口 TUN-7（小断面拱，洞内 SLE-3；NCCA）',
    match: /^G15_tunnel7/,
  },
  {
    // A17 组（`NCCA` 高速窄轨）的轨道：BAL-D 道床 + **SLE-3 混凝土宽枕** + RAI-7 窄轨（米轨 1000mm）。
    //   与 A16（`NBCN` / `NBCA`）**只差轨枕那一层**（SLE-2 Ⅱ型枕 → SLE-3 宽枕），
    //   与 A15（`NACN`）只差轨枕来源；道床 / 钢轨 / 洞口逐面相同。
    // 单独一张表（同 rail / metro / narrow / narrowmodern 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'narrowhs',
    title: '高速窄轨（BAL-D + SLE-3 + RAI-7，k=0.70；NCCA）',
    match: /^G15_/,
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
    // A4 组（`SAEN` 重载铁路 1932·80km/h）的**洞口**：**TUN-2 素混凝土端墙拱**
    //   （落位表第 3 行），洞内那层换成 A1 的 `SLE-1` 木枕 —— 几何由
    //   `tools/gen-a5-heavy.mjs` 第七节生成（底板 = A5 的产物，枕木另贴）。
    // ⚠ 必须登记在下面的 heavywood **之前**：那个表的正则是 /^G16_/，会先吃掉 G16_tunnel2_*。
    key: 'tunnel2wood',
    title: '重载洞口 TUN-2（素混凝土端墙拱，洞内 SLE-1 木枕；SAEN）',
    match: /^G16_tunnel2/,
  },
  {
    // A4 组（`SAEN`）的轨道：`BAL-B` 厚道床 + **`SLE-1` 木枕** + `RAI-2` 75kg/m 重轨。
    //   与 A5（`SBEN` / `SBEA`）**只差枕木与洞口**：道床 / 钢轨逐面相同，标准轨距 ⇒ **零变换**。
    // 单独一张表（同 rail / metro / heavy 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'heavywood',
    title: '重载轨道·木枕（BAL-B + SLE-1 + RAI-2；SAEN）',
    match: /^G16_/,
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
    // ⚠ 负向先行断言把 `G1_sty_cyl_blue_*` 让给下一张表（同前缀、first-match-wins）。
    match: /^G1_sty_cyl(?!_blue)/,
  },
  {
    // 接触网支柱 **PYL-C2 + 浅蓝牌**（= 1500V DC 档，人工 2026-10-21 批准本轮做）：
    //   §1.6.5.1 的落位表里 `SACd` / `SBCd` / `SACZ` 三条都是 `PYL-C2` + 浅蓝牌，
    //   而那时「C2 + 浅蓝」这套还没建 ⇒ 本轮给 `SACd` / `SBCd` 补上（`SACZ` 将来直接用）。
    //
    // 模型 `models/G1_sty_cyl_blue_a|_b.model` = `G1_sty_cyl_a|_b` **逐字相同 +
    //   一根同轴圆柱环箍**（半径 0.0280 = 柱基半径、z 0.1250–0.1850、材质
    //   `awning_ltblue`，与 E1 那块蓝牌同一个 z 区间与颜色）。
    // ⚠ 本族与 `pyloncyl` **同格位**（`zmax` 都钉 0.7000、环箍不撑大外接框 ⇒ 263×210）
    //   ⇒ 分表的理由不是格位，而是守"一表一类"这条纪律（同 pylonsteel / pylondkblue）。
    key: 'pyloncylblue',
    title: '接触网支柱 PYL-C2 + 浅蓝牌（1500V DC；SACd / SBCd）',
    match: /^G1_sty_cyl_blue/,
  },
  {
    // 接触网支柱 **PYL-S1 H 型钢**（人工 2026-10-05 批准：A10 确认门里与 `SGCA` 同批；
    // 1999+ 客专 / 高铁档）。规格见 `美术要素方案.md` §1.6.5.2 的 S1 列
    // （⚠ 那列的 0.700 / 0.580 是规划旧数，现行口径 = 柱顶 0.48 / 挂点 0.40）。
    //
    // 模型 `models/G1_sty_steel_a|_b.model`（**手写**，a 直向 / b 斜向 45°）。
    // ⚠ 必须单独一张表、且**登记在 pylonstyle 之前**（它的正则是 /^G1_sty_/，会把本族吃掉）：
    //   本族与 E1 那两族**同格位**（`zmax` 都钉 0.6100 ⇒ 263×207），所以分表**不是**为了格位，
    //   而是守"一表一类"这条纪律（同 pyloncyl / pylondkblue 两条注释的教训）。
    key: 'pylonsteel',
    title: '接触网支柱 PYL-S1（H 型钢；SGCA 客专/高铁）',
    match: /^G1_sty_steel/,
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
  {
    // A20 组（`MONO` 跨座式单轨）—— **一个组一张表**：梁体就是全部（没有道床/枕木/钢轨三层，
    // 也没有洞口：`TUN-9` = 不做隧道口，`tunnels:` 直接复用 `track_x` 的四张）。
    // 模型由 `tools/gen-a20-mono.mjs` 生成（板带压窄 + 抬成实体）。
    key: 'mono',
    title: '跨座式单轨 PC 轨道梁（BAL-L，0.85 m 宽；MONO）',
    match: /^G23_/,
  },
  {
    // A21 组（`MGLV` 磁浮）—— 与 A20 同一套骨架，梁更宽（2.40 m）、侧面是定子铁芯的深金属色。
    key: 'maglev',
    title: '磁浮高架导向梁（BAL-M，2.40 m 宽；MGLV）',
    match: /^G24_/,
  },
  {
    // A19 组（`DBDA` 电气化准宽套轨）的**洞口**：同一个 `TUN-8`，只是洞内枕木换成 Ⅱ 型混凝土枕。
    // ⚠ 必须登记在下面的 dualwidemodern **之前**（first-match-wins）。
    key: 'tunnel8widemodern',
    title: '宽轨套轨洞口 TUN-8（加宽拱圈，洞内四根轨 + 混凝土枕；DBDA）',
    match: /^G21_tunnel8wide/,
  },
  {
    // A23 组（`BBDA` 电气化俄罗斯宽轨）的**洞口**：同上，洞内两根 1520 轨。
    key: 'tunnel8broadmodern',
    title: '宽轨洞口 TUN-8（加宽拱圈，洞内两根 1520 轨 + 混凝土枕；BBDA）',
    match: /^G22_tunnel8broad/,
  },
  {
    // A19 组（`DBDA`）的轨道：与 `dualwide`（A18）**逐面相同，只把木枕换成 SLE-2 Ⅱ 型混凝土枕**。
    key: 'dualwidemodern',
    title: '准宽套轨·电气化（BAL-K + SLE-2 + RAI-5 四轨；DBDA）',
    match: /^G21_/,
  },
  {
    // A23 组（`BBDA`）的轨道：与 `wide`（A22）**逐面相同，只换枕木**。
    key: 'widemodern',
    title: '俄罗斯宽轨·电气化（BAL-K + SLE-2 + RAI-9 两轨 1520；BBDA）',
    match: /^G22_/,
  },
  {
    // A18 组（`DBDN` 准轨-俄罗斯宽轨套轨）的**洞口**：`TUN-8` 套轨加宽断面拱
    // —— 与 A24（`dBCN`）的 `tunnel8` 表**逐件同几何**（同一条 ×10/9 加宽映射），
    // 差别只在洞内轨道那一层的钢轨横向尺度（本族四根：1435 原样 + 1520 那一对）。
    // ⚠ 必须登记在下面的 dualwide **之前**（first-match-wins）。
    key: 'tunnel8wide',
    title: '宽轨套轨洞口 TUN-8（加宽拱圈，洞内四根轨；DBDN）',
    match: /^G19_tunnel8wide/,
  },
  {
    // A22 组（`BBDN` 纯 1520 宽轨）的**洞口**：同一个 `TUN-8`。
    // 洞内只有两根轨 ⇒ 与 A18 / A24 的洞门外形逐字相同、只差钢轨。
    key: 'tunnel8broad',
    title: '宽轨洞口 TUN-8（加宽拱圈，洞内两根 1520 轨；BBDN）',
    match: /^G20_tunnel8broad/,
  },
  {
    // A18 组（`DBDN` 准轨-俄罗斯宽轨套轨）的轨道：
    // `BAL-K` 加宽道床（0.40 格，与 A24 逐字相同）+ `SLE-1` 木枕（0.20 格）
    // + **`RAI-5` 四根轨**（1435 原样 + 同一对按 S = 1520/1435 放大 = 外侧宽轨）。
    // 单独一张表（同 dual / narrow / heavy 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'dualwide',
    title: '准宽套轨（BAL-K + SLE-1 + RAI-5 四轨；DBDN）',
    match: /^G19_/,
  },
  {
    // A22 组（`BBDN` 纯 1520 宽轨）的轨道：同一个 `BAL-K` + `SLE-1`，
    // 但钢轨**只有按 S 放大那一遍** ⇒ `RAI-9` 两根轨、轨距 0.1093 格 = 1.520 m。
    key: 'wide',
    title: '俄罗斯宽轨（BAL-K + SLE-1 + RAI-9 两轨 1520；BBDN）',
    match: /^G20_/,
  },
  {
    // A24 组（`dBCN` 准轨-窄轨套轨）的**洞口**：`TUN-8` 套轨加宽断面拱
    // —— 就是 `TUN-2` 素混凝土端墙拱把**拱洞 / 拱腹 / 洞内轨道**横向 ×10/9
    // （洞跨 0.31 → 0.344 格、拱顶高度不动），端墙 / 翼墙 / 山体裙一格不动。
    // 几何由 `tools/gen-a15-narrow.mjs` 的**第二节**生成（源 = `G1_tunnel2_stone*`）。
    // ⚠ 必须登记在下面的 dual **之前**：那个表的正则是 /^G18_/，会先吃掉 G18_tunnel8_*。
    key: 'tunnel8',
    title: '套轨洞口 TUN-8（加宽拱圈，洞内四根轨；dBCN）',
    match: /^G18_tunnel8/,
  },
  {
    // A24 组（`dBCN`）的轨道：`BAL-K` 加宽道床（0.36 → 0.40 格，与 `BAL-B` 同一口径）
    // + `SLE-1` 木枕（0.18 → 0.20 格）+ **`RAI-10` 四根轨**（准轨原样 + 同一对按
    // k = 0.70 再画一遍 = 内侧米轨那一对）。
    // 单独一张表（同 rail / metro / narrow / heavy 表的理由：混进去会把已有几十条 rect 顶移位）。
    key: 'dual',
    title: '准窄套轨（BAL-K + SLE-1 + RAI-10 四轨；dBCN）',
    match: /^G18_/,
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
