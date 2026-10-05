// 材质表：名字 → 基色（sRGB 0..255）+ 少量非光照属性。
//
// 这里刻意**没有贴图、没有噪点图案**。风格要求是"平涂为主"：一个面上
// 只有一个基色，明暗全部来自光照与 AO；表面的层次靠建模时把墙、腰线、
// 窗框拆成不同的图元来做，而不是靠纹理噪声糊出来。

const M = (r, g, b, o = {}) => ({ color: [r, g, b], spec: o.spec ?? 0, emissive: o.emissive ?? 0 });

export const MATERIALS = {
  // --- 抹灰 / 石材 / 混凝土 ---------------------------------------------
  plaster_white: M(238, 233, 222),
  plaster_cream: M(228, 214, 178),
  plaster_warm: M(221, 200, 160),
  plaster_pink: M(216, 179, 164),
  plaster_grey: M(197, 195, 189),
  plaster_mint: M(196, 214, 200),
  stucco_tan: M(211, 190, 158),

  concrete: M(186, 182, 173),
  concrete_dark: M(144, 140, 132),
  // ★ 本工程的**本地新增**（2026-10-03，人工：「混凝土还是太黄了，改成 (160,160,160) 左右」）：
  //   上面两个 concrete 都偏暖（R−B = 13 / 12），做地铁整体道床时实机看着发黄。
  //   ⚠ 直接写 (160,160,160) **不行** —— 光照 + `stylized` 调色会把表面往暖里带：
  //     实测基准 (160,160,160) 渲出来顶面是 **(155,150,142)**（R−B 偏了 13）。
  //     所以这里写**偏冷**的 (159,165,175)，渲出来才落在中性 ~(160,160,160)。
  //   （各通道实测系数：顶面 R×1.006 G×0.969 B×0.913。）
  //   颗粒照 `GRAIN_RULES` 的 /^concrete/ 自动给 0.048。
  //   ⚠ 这是相对上游 flatiso 的**本地增补**，同步上游时别丢（见 tools/flatiso/VENDORED.md）。
  concrete_mid: M(159, 165, 175),
  // ★ 本工程的**本地新增**（2026-10-06，人工：「`BAL-I` 不要浮置版了，改成**浅色混凝土**
  //   （**不要暖色**）」）：浅色**中性**混凝土，A13 组 `SBC3` 的地铁道床 `BAL-I` 用。
  //   配方与 `concrete_mid` **同源**、同一条实测口径（顶面渲出 R×1.006 G×0.969 B×0.913
  //   ⇒ 基色必须**偏冷**、蓝通道给到红的 1.10 倍，渲出来才是中性灰）：
  //     `concrete_mid`(159,165,175) → 顶面 **实测** ≈(155,157,160)
  //     本档         (184,191,203) → 顶面 **实测** ≈(185,187,190)   ← 浅 30 档，仍与 BAL-H 同族、R≈B（不暖）
  //   ⚠ **别直接写 (185,185,185)**：那渲出来会偏暖成 ≈(185,179,169)，正是人工不要的暖色。
  //   颗粒照 `GRAIN_RULES` 的 /^concrete/ 自动给 0.048。
  //   ⚠ 与 `concrete_mid` / `awning_ltblue` / `awning_dkblue` 一样是**本地增补**，
  //     同步上游时别丢（见 tools/flatiso/VENDORED.md）。
  concrete_light: M(184, 191, 203),
  stone: M(208, 202, 189),
  stone_dark: M(160, 155, 144),

  // --- 砖 ---------------------------------------------------------------
  brick_red: M(168, 84, 63),
  brick_brown: M(140, 90, 68),
  brick_pale: M(192, 138, 110),
  brick_grey: M(150, 143, 136),

  // --- 屋顶 -------------------------------------------------------------
  roof_tile: M(166, 80, 60),
  roof_tile_dark: M(138, 66, 49),
  roof_slate: M(110, 115, 120),
  roof_slate_dark: M(84, 89, 95),
  roof_shingle: M(122, 106, 86),
  roof_metal: M(126, 139, 140),
  roof_green: M(78, 107, 82),
  roof_teal: M(92, 128, 130),

  // --- 木 ---------------------------------------------------------------
  wood: M(169, 121, 63),
  wood_dark: M(122, 85, 48),
  wood_pale: M(196, 160, 104),

  // --- 玻璃 / 灯 --------------------------------------------------------
  glass: M(110, 140, 168, { spec: 0.12 }),
  glass_dark: M(67, 89, 111, { spec: 0.12 }),
  glass_reflect: M(146, 176, 196, { spec: 0.18 }),
  glass_lit: M(232, 196, 106, { emissive: 0.32 }),

  // --- 金属 / 管线 ------------------------------------------------------
  metal: M(154, 160, 166),
  metal_dark: M(94, 100, 106),
  metal_pale: M(190, 195, 199),
  rust: M(138, 90, 60),

  // --- 线脚 / 构件 ------------------------------------------------------
  trim_white: M(240, 237, 230),
  trim_dark: M(62, 66, 71),
  trim_red: M(176, 58, 58),
  trim_blue: M(58, 84, 140),
  trim_black: M(42, 44, 48),

  // --- 中国 90~00 年代公共建筑 -----------------------------------------
  // 那个年代的外装三件套：白色/米色面砖 + 蓝色（或绿色）镀膜玻璃 + 铝合金门窗，
  // 门厅和台基贴花岗岩，招牌红底白字。
  tile_white: M(228, 226, 218),
  tile_cream: M(222, 214, 196),
  tile_grey: M(198, 195, 188),
  granite_rose: M(158, 116, 100),
  granite_grey: M(146, 144, 140),
  glass_blue: M(64, 102, 136, { spec: 0.16 }),
  glass_green: M(72, 118, 116, { spec: 0.14 }),
  metal_alu: M(196, 200, 204),        // 铝合金门窗
  sign_cn_red: M(188, 46, 40),        // 红底招牌

  // --- 分缝 / 线脚 ------------------------------------------------------
  // 专供 `strip` / `courses` / 屋顶 `tileMat` 用：比基材暗一档（或亮一档）。
  // 凹缝所以偏暗；金属板肋是凸起受光所以偏亮。全是手调的字面量。
  roof_tile_seam: M(122, 58, 44),
  roof_tile_dark_seam: M(102, 48, 36),
  roof_slate_seam: M(84, 88, 92),
  roof_shingle_seam: M(93, 81, 66),
  roof_metal_seam: M(96, 106, 107),
  roof_green_seam: M(58, 80, 61),
  roof_teal_seam: M(69, 96, 97),
  metal_rib: M(178, 186, 188),

  brick_seam: M(126, 63, 47),
  brick_brown_seam: M(105, 67, 51),
  brick_pale_seam: M(148, 105, 84),
  brick_grey_seam: M(116, 110, 105),

  plaster_white_seam: M(200, 196, 187),
  plaster_cream_seam: M(190, 178, 148),
  plaster_pink_seam: M(180, 149, 137),
  plaster_grey_seam: M(163, 161, 156),
  stucco_tan_seam: M(176, 158, 131),

  concrete_seam: M(152, 149, 141),
  stone_seam: M(172, 167, 156),
  metal_seam: M(122, 127, 132),
  metal_pale_seam: M(156, 160, 164),
  glass_seam: M(84, 107, 128),
  glass_dark_seam: M(50, 67, 84),
  wood_seam: M(133, 95, 49),
  asphalt_seam: M(70, 70, 72),
  pad_seam: M(138, 135, 128),
  panel_seam: M(96, 96, 96),

  tile_white_seam: M(190, 188, 180),
  tile_cream_seam: M(184, 176, 160),
  tile_grey_seam: M(164, 162, 155),
  granite_rose_seam: M(128, 92, 79),
  granite_grey_seam: M(118, 116, 112),

  // --- 地面 -------------------------------------------------------------
  asphalt: M(90, 90, 92),
  asphalt_light: M(110, 110, 112),
  concrete_pad: M(168, 164, 156),
  kerb: M(196, 192, 182),
  grass: M(110, 154, 90),
  grass_dark: M(85, 121, 74),
  gravel: M(156, 149, 138),
  dirt: M(138, 115, 88),
  sand: M(206, 186, 142),

  // --- 布篷 / 招牌 ------------------------------------------------------
  awning_red: M(180, 72, 63),
  awning_green: M(63, 122, 85),
  awning_blue: M(60, 107, 158),
  // ★ 本工程的**本地新增**（2026-10-05，人工：「把 1.5kv 的架空线支柱的颜色标识改为浅蓝，
  //   3kv 的改成深蓝」）：接触网支柱上那块**供电制式标牌**的两档颜色 ——
  //   浅蓝 = 1500V DC（`G1_sty_early_blue_*`，厂矿线 `SBEd`）、
  //   深蓝 = 3000V DC（`G1_sty_early_dkblue_*`，朝鲜电气化 `SBDD`）。**红牌那套已作废**。
  //   ⚠ 两档要在一根 ~30 px 宽的柱子上、一条 ~6 px 高的环箍上**一眼分得出** ⇒ 明度拉开
  //     到 ~2.6 倍（116 vs 34）。别只差一点色相 —— 那在 4x 下等于没有区别。
  //   ⚠ `stylized` 预设会把顶面往暖里带（R×1.006 G×0.969 B×0.913）⇒ 蓝通道会掉一点，
  //     所以基色比"看着合适"的值略微提亮。与旧蓝牌 (60,107,158) 同族同颗粒。
  //   颗粒照 `GRAIN_RULES` 的 /^awning/ 自动给 0.030（与原来的蓝牌一字不差）。
  //   ⚠ 与 `concrete_mid` 一样是**本地增补**，同步上游时别丢（见 tools/flatiso/VENDORED.md）。
  awning_ltblue: M(116, 172, 210),
  awning_dkblue: M(34, 62, 122),
  awning_cream: M(228, 216, 186),
  sign_yellow: M(224, 182, 60),
  sign_white: M(238, 238, 234),

  // --- 植被 -------------------------------------------------------------
  foliage: M(94, 140, 74),
  foliage_dark: M(71, 112, 58),
  foliage_light: M(126, 166, 92),
  trunk: M(107, 82, 54),
};

export const FALLBACK = [200, 200, 200];

// ---------------------------------------------------------------- 颗粒
//
// 颗粒幅度按**材质族**给，不逐个材质写 —— 八十多条手工标一遍既费事又容易漏。
// 单位是显示空间的相对偏移：0.045 = ±4.5%。
//
// 为 0 的那几类是刻意的：线脚（*_seam / metal_rib）本身就是深色细线，
// 加颗粒只会把它糊掉；玻璃、招牌、涂装金属是光洁面，加颗粒显脏。
// 真正开颗粒的是抹灰、混凝土、砖、瓦、沥青、植被这些"粗糙多孔"的材料。
const GRAIN_RULES = [
  [/_seam$/, 0],
  [/^metal_rib$/, 0],
  [/^trim_/, 0],
  [/^glass/, 0],
  [/^sign_/, 0],
  [/^panel_seam$/, 0],
  [/^plaster/, 0.045],
  [/^tile_/, 0.038],
  [/^granite/, 0.040],
  [/^stucco/, 0.050],
  [/^concrete_pad$/, 0.050],
  [/^concrete/, 0.048],
  [/^stone/, 0.032],
  [/^brick/, 0.055],
  [/^roof_tile/, 0.050],
  [/^roof_slate/, 0.042],
  [/^roof_shingle/, 0.055],
  [/^roof_metal/, 0.028],
  [/^roof_green$|^roof_teal$/, 0.040],
  [/^asphalt/, 0.055],
  [/^gravel$|^dirt$|^sand$/, 0.060],
  [/^grass/, 0.070],
  [/^foliage/, 0.075],
  [/^trunk$/, 0.050],
  [/^wood/, 0.035],
  [/^metal/, 0.022],
  [/^rust$/, 0.055],
  [/^awning/, 0.030],
  [/^kerb$/, 0.040],
];

const _grainCache = new Map();

/** 该材质的颗粒幅度（显示空间相对偏移）。未知名字回落到 0.03。 */
export function materialGrain(name) {
  const hit = _grainCache.get(name);
  if (hit !== undefined) return hit;
  let v = null;
  for (const [re, amp] of GRAIN_RULES) {
    if (re.test(name)) { v = amp; break; }
  }
  if (v === null) v = MATERIALS[name] ? 0.030 : 0;
  _grainCache.set(name, v);
  return v;
}

/** 解析材质名；未知名字回落到中性灰并记一条警告。 */
export function materialColor(name) {
  const m = MATERIALS[name];
  return m ? m.color : FALLBACK;
}

export function materialInfo(name) {
  const m = MATERIALS[name];
  if (m) return { ...m, grain: materialGrain(name) };
  return { color: FALLBACK, spec: 0, emissive: 0, grain: 0 };
}

export function listMaterials() {
  return Object.keys(MATERIALS).sort();
}
