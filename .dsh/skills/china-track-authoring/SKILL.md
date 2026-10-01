---
name: china-track-authoring
description: China-Set-Tracks 风格 32bpp 4x OpenTTD 轨道包（china-style-track）的施工入口 —— 术语表↔代码标识符、固定的 gen→render→build→check 命令链、四个隧道口模型（A/B 分左右）与图集分表、templates.pnml 的改动规矩、railtype/spriteset 接线位置、以及已经排除过的错误猜测。改 tools/gen-g1-*.mjs、models/*.model、src/rails/*.pnml、templates.pnml，或排查"洞口破碎/立面缺面/朝向遮盖反了/格位对不上"时加载。
whenToUse: 在本仓库里改隧道口 / 坡道 / 道岔的模型生成器或 .model、接入或调整 spriteset 与模板、图集分表、排查洞口破面或朝向错误、以及要接手这个仓库继续做时。纯读文档不需要。
---

# china-style-track 施工入口

**这个 skill 只管"怎么在这儿干活"。** 手艺看 `flatiso-model-authoring`；
口径看 `docs/定标.md`；用词看 `docs/术语表.md`；规矩看 `docs/建模标准.md`；路线看 `实现计划.md`。

---

## 1. 先按顺序读这四样

| 顺序 | 读什么 | 为什么 |
|---|---|---|
| 1 | `docs/术语表.md` | **人工用词 ↔ 代码标识符**。本工程最大的返工来源就是叫法对不上（曾把「侧面」当「斜面」删错一轮，「顶坡」没确认又来回两轮）。**表里没有的词，先问，不要猜。** |
| 2 | `docs/建模标准.md` | 铁律、固定命令链、验收判据、**决策台账**（人工裁定过的，不要再讨论） |
| 3 | `实现计划.md` | 路线：§2 锁定决定 D1~Dn / §4 阶段计划 / §5 flatiso 改动边界 |
| 4 | `docs/定标.md` | 实测口径：坐标映射、朝向映射、锚点陷阱、**槽位取图对照表** |

想改渲染器之前先停一下：本工程对 flatiso 的改动**严格限定在已批准的那几处**。

---

## 2. 产物与目录

```
models/*.model          手写/生成的构件清单（资产本体）
tools/gen-g1-*.mjs      ★ 模型生成器（隧道/坡道/道岔）—— 直接改这些，不要手改 .model
tools/sheets.mjs        图集按类分表：rail / tunnel / catenary / fence
src/rails/templates.pnml   ★ 人工的文件：sprite rect + xrel/yrel
src/rails/railsprite.pnml  spriteset 组装处（underlay/overlay/tunnels/tunnel_overlay）
src/rails/railtrack.pnml   railtype 定义 + graphics 块
gfx/                    渲染产物（rail.png / tunnel.png / openttd.json）
out/                    构建产物（.grf）+ 一次性诊断脚本（不入库）
```

**铁律速记**：`templates.pnml` **只有新增精灵类型时才动，且只能人工手改**，脚本一律不写。
`.model` 由 `tools/gen-*.mjs` 吐出，**改生成器、不要手改生成的 .model**（文件头也这么写）。

---

## 3. 固定命令链（顺序不能换，第 ① 步最容易漏）

```
node tools/gen-g1-tunnel.mjs          # ① 生成模型 —— 改了生成器就必须跑
node tools/build.mjs --step render    # ② flatiso 渲染 → gfx/
node tools/build.mjs                  # ③ nmlc 编译 → out/china-style-track.grf
node tools/check.mjs                  # ④ 自检，必须 ✔ 全部通过
# ⑤ 覆盖 <OpenTTD>/newgrf/china-style-track.grf，并**重启 OpenTTD**
```

- **`--step render` 不会重新生成模型。** 不跑 ①，改了生成器等于没改（本工程因此得出过一次错误的"像素没变"结论）。
- **改完必须重启 OpenTTD**，否则看到的还是缓存的上一次精灵。人工说"改了没反应"时先确认这个。
- 常用：`make sprites --sheet` 出 `out/calibrate/index.png` 偏移索引图（对账 + 手调摆放）。

---

## 4. 模型生成器一览

| 生成器 | 产物 | 备注 |
|---|---|---|
| `tools/gen-g1-tunnel.mjs` | `G1_tunnel_stone` / `_stone_over` / `_stone_b` / `_stone_over_b` | **四个模型**：两层 × 两套左右分组 |
| `tools/gen-g1-slope.mjs` | `G1_rail_slope` / `G1_track_slope` | 坡道；取图顺序 **v0=NE v1=NW v2=SW v3=SE** |
| `tools/gen-g1-switches.mjs` | `G1_junction3` / `G1_junction4` / `G1_crossing` | 道岔三形状其实是同一模型的四个旋转 |

### 4.1 隧道口：为什么是四个模型

- 引擎把 `tunnel_overlay:` 当**整张 sortable sprite** 画在车之上 ⇒ overlay 里只能放**离镜头近**的那半边。
- 而"哪半边近"**逐朝向不同**：**v0/v3 近半是 y≥0.5，v1/v2 近半是 y<0.5**（绕占地中心转模型 ⇒ 近半也跟着转）。
- 一个 `.model` 只能写死一种分组 ⇒ 需要两套：
  - **A 组** `G1_tunnel_stone` / `_stone_over` → 槽 0（v0=NE）、槽 1（v3=SE）
  - **B 组** `G1_tunnel_stone_b` / `_stone_over_b` → 槽 2（v2=SW）、槽 3（v1=NW）
- **拱腹内壁**按组分别出 −y / +y 侧的**可见弧段**（人工："拱洞分左右"）。
- `G1_tunnel_frame.model` 是**哨兵模型**（无几何、`zmax 0.7000`），只为把隧道格位钉死在 263×181 —— 改几何不要动它，也别删。

### 4.2 朝向与取图

平轨/坡道/隧道**共用同一套**：模型基准朝向 = DiagDir NE，取图 `v0=NE v1=NW v2=SW v3=SE`，
**喂引擎的槽位顺序是 NE/SE/SW/NW ⇒ 喂图顺序 v0, v3, v2, v1**。
完整对照表在 `docs/定标.md` §4，接 spriteset 时照抄。

---

## 5. 这个工程踩过、别再踩的

| 症状 | 真因 | 别再试的方向 |
|---|---|---|
| 洞口外立面大片小三角缺失（"碎"） | 腹墙条带取点被钳到拱心：`archZ(Math.min(y0+1e-6, ARCH_CY))` —— `archZ(拱心)` 恰好 = 拱顶，右半 `z0`/左半 `z1` 全塌 | **不是**抗锯齿。证据：`--ss 1` 关掉 AA 后锯齿更清楚 |
| 少数面整批消失 | `q4o()` 用「前三点叉积」定法线，三点共线时叉积为 0 ⇒ 判不出绕序 ⇒ 不翻 ⇒ 被判背面剔掉。已改 **Newell 法** | **不是**背面剔除。证据：`--no-cull` 重渲染锯齿依旧 |
| 曲面上出现毛边/梳齿 | 曲面在临界角附近几乎刀片边缘对着镜头，每段投影不到 1px。已改成**只出可见弧 + 提前收口** | 别指望加抗锯齿能解决 |
| 一改几何所有轨道的 rect 全乱 | flatiso 只按**占地**分表，高个子模型把同表格位撑大 | 已用 `tools/sheets.mjs` 按类分表解决，别再合表 |
| `nmlc ERROR: Read beyond bounds of image file` | 格位变了而 `templates.pnml` 的 rect 没同步 | 别写脚本批量改 rect；哨兵模型 + 人工改 |
| 改了模型"像素没变" | 只跑了 `--step render`，没跑生成器 | 见 §3 第 ① 步 |
| 中文源码变成乱码 / `SyntaxError` | PowerShell `Set-Content` 按 ANSI 写 UTF-8 | **用 `edit`/`write` 工具改源文件**，禁止 PS 批量读写 |

> **修 bug 的纪律**：先能复现、再说根因；把"看起来像的原因"当成原因之前，做**单变量对照实验**。
> 本工程曾两次把假原因当成真原因（"50° 面在 30° 镜头下是细条"、"抬高 `WING_Z0` 会毁掉护坡"），都靠对照实验推翻。

---

## 6. 接活 / 交活检查单

**接手前**：① 按 §1 读四份；② 先跑一遍 §3 的链，确认**改动之前**就已经通过（否则分不清是你改坏的还是本来就坏的）；③ 明确这轮只做**一件**事。

**交付时**：① 命令链全过；② 给人工**图**不给坐标（人工不读坐标，出 `out/*-composite.png` 这类对照图）；③ 说清改了什么/为什么/怎么验证/还剩什么没验证；④ 新裁定回写 `建模标准.md` §4 台账、新叫法回写术语表、路线变了回写 `实现计划.md`。

**遇到不确定的事**：人工说过"出现难以解决的问题等待人工修复，出现不了解的问题等待人工回答"——**先问，不要猜**，更不要以任何理由推辞。
