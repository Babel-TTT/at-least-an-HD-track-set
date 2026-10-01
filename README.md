# China Style Tracks —— 中国风格轨道包

OpenTTD 的 **32bpp 4x** 中国风格铁路轨道 NewGRF。
美术用 [flatiso](../../ottd/建筑测试/flatiso) 的等距预渲染管线从**手写 `.model`** 离线烘焙，
GRF 用 NML 编译，轨道编码遵循**标准化轨道编码方案**（与中国包列车互通）。

---

## 现状

| 阶段 | 状态 |
|---|---|
| P0 构建管线 | ✅ 完成 —— `make` 一条命令出 GRF |
| P1 几何定标 | ✅ 完成 —— 口径全部实测锁定，见 `docs/定标.md` |
| P2 建模 | 🔄 **进行中** —— 轨道 / 道岔 / 交叉 / 坡道已出图并接入；**隧道口 TUN-1 正在迭代** |

当前 GRF 里 `SADN` 已挂上轨道几何 + 隧道口，其余 6 种轨道走引擎原版精灵。
这是**可加载、可 eyeball** 的中间产物，不是成品。

---

## 环境准备

只需要三样：**Node ≥ 18**、**GNU Make**、**gcc**，外加一个 **nmlc**。

| 依赖 | 怎么来 | 说明 |
|---|---|---|
| Node ≥ 18 | 装就行 | 管线纯 Node ESM、零第三方依赖，不需要 `npm install` |
| GNU Make | 装就行 | 不装也能用：直接跑下面「不用 Make」那一节 |
| gcc | MinGW / scoop 等 | **nmlc 不带预处理器**，`.pnml` 必须先过 `gcc -E` |
| nmlc | 自备，**放进系统 PATH** | 版本 0.9.0 验证过。放进 PATH 后 `nmlc` 能直接跑就行 |
| flatiso | **已内置在本仓库** `tools/flatiso/` | 不需要另外 clone。详见 `tools/flatiso/VENDORED.md` |

**所有外部工具的路径都能覆盖**，优先级：环境变量 > `Makefile.config` > 默认值。

```powershell
$env:NMLC    = 'D:/tools/nmlc.exe'      # nmlc 不在 PATH 上时
$env:FLATISO = 'D:/somewhere/flatiso'   # 想用外面的 flatiso 调试时
```

内置的 flatiso 只用来**渲染**，不要在里面做开发（改动不会回流上游）。

---

## 构建

```powershell
cd D:\CNS\CNST\local\china-style-track

make                # 全流程：flatiso 渲染 → gcc -E → nmlc
make sprite         # 只渲染（= make render）
make render         # 只调 flatiso
make sprites        # 打印手写模板表 + 出索引图（改摆位前先看这个）
make diag           # 重出定标图（out/calibrate/）
make check          # ★ 自检：railtype 结构 + templates.pnml 对账 + 文本编码
make clean          # 删生成物（连定标图一起删；不碰手写源文件）
make help
```

**不用 Make** 也行，等价的一条链（顺序不能换）：

```powershell
node tools/gen-g1-tunnel.mjs        # ① 生成模型（改了生成器就必须跑）
node tools/build.mjs --step render  # ② flatiso 渲染 → gfx/
node tools/build.mjs                # ③ gcc -E → nmlc → out/china-style-track.grf
node tools/check.mjs                # ④ 自检，必须全过
```

> ⚠ **第 ① 步最容易漏。** `--step render` **不会**重新生成模型；
> 改了生成器却不跑 ①，等于什么都没改。

> ⚠ **改完 GRF 要重启 OpenTTD。** 游戏在启动时读 GRF 并缓存精灵，
> 只覆盖文件不重启，看到的还是上一次的精灵。

> **改过任何 railtype 之后，务必跑 `make check`。**
> railtype 错了**编译零报错**，装上游戏才发现"车库里一辆车都没有"——
> 见 `docs/踩坑.md` A6 / A6.1。`make check` 就是拦这个的。
>
> ⚠ **`src/rails/templates.pnml` 是手写源文件，没有生成器。** 以前它由
> `tools/gen-template.mjs` 自动生成、手改会被覆盖；现在归人管。改摆位就改它。
> **脚本一律不得写入这个文件。**

产物：`out/china-style-track.grf`

覆盖配置：

```powershell
make SS=2 PRESET=bright          # 更快 / 更亮的观感
make GFX_DIR=mygfx               # 换输出目录
```

### 定标图

```powershell
node tools/calibrate.mjs
```

生成 `out/calibrate/anchors.png`：行 = 模型，列 = 朝向，
洋红十字 = 瓦片菱形轮廓（用来验证摆放锚点），绿十字 = 瓦片中心。

---

## 目录

| 路径 | 说明 |
|---|---|
| `要求.md` | 需求（人工） |
| `中国轨道包.csv` | 31 种轨道的清单（人工，权威） |
| `实现计划.md` | **计划主文件** |
| `美术要素方案.md` | 道床/轨枕/钢轨/隧道口的逐类型方案与裁定 |
| `docs/定标.md` | **口径权威** —— flatiso ↔ OpenTTD 的坐标、锚点、朝向映射、道砟几何 |
| `docs/术语表.md` | **用词权威** —— 人工用词 ↔ 代码标识符，接手第一份看它 |
| `docs/建模标准.md` | **规矩权威** —— 铁律、完成定义、验收判据、**决策台账** |
| `docs/建模经验.md` | **手艺** —— 长度换算速查、横断面比例、材质颗粒、建模工作法、验收流程 |
| `docs/踩坑.md` | **踩坑记录** —— 现象 / 原因 / 修法，开工前先扫一遍 |
| `models/*.model` | **资产本体**：手写等距构件清单（必须平铺，不能建子目录） |
| `src/rails/*.pnml` | NML 源码 |
| `src/rails/templates.pnml` | **手写源文件**：每个「模型×朝向」在图集里的矩形与摆放锚点。改摆位就改它 |
| `tools/*.mjs` | 构建与定标工具（Node，零第三方依赖） |
| `tools/flatiso/` | **内置的 flatiso 快照**（渲染器），见 `tools/flatiso/VENDORED.md` |
| `.dsh/skills/` | 给 AI 的技能说明（本仓库的施工入口） |
| `gfx/` `out/` | 生成物，不入库 |

---

## 几条最容易踩的坑（完整版见 `docs/踩坑.md`）

1. **不要用 flatiso 的 `xrel/yrel`。** 它是相对「旋转后占地矩形的西北角」，
   而 OpenTTD 要的是「瓦片原点」。必须用 `centerAnchor` 反推
   （`tools/util.mjs` 的 `anchorToXrelYrel()`）。
2. **flatiso 的朝向步进是 OpenTTD 旋转的逆** —— `flatiso view k ≡ R^(−k)`。
   槽位取图对照表在 `docs/定标.md` §4。
3. **`nmlc` 不带预处理器。** `.pnml` 必须先过 `gcc -E`。
4. **不要抬高地基。** 瓦片内抬高的几何会被邻格精灵遮挡 ⇒ 图形错位。
   道床贴地（`z≈0.002`），高度给轨枕和钢轨。另外 OpenTTD 的竖轴是压缩的
   （`TILE_HEIGHT=8` / `TILE_SIZE=16`），同一个 z，flatiso 画出来是它的 **2.45 倍**。
5. **flatiso 是平面着色 —— 共面的面加多少都一样。** 要「不规则表面」得让
   **法线不同**（倾斜小面），把平面切碎是白加面数。
6. **`poly` 不支持 `\` 续行**，顶点必须写成一整行。

---

## 许可

待定（见 `docs/license.txt`）。

---

## 提交约定

* **提交信息用中文**，说清「改了什么 + 为什么」，带上关键数字
  （面数、bbox、railtype 数量等）。
* 多行提交信息**写进临时文件再 `git commit -F`** —— 直接 `-m` 会被 shell 拆坏引号。
* **改动 `railtype` 之后必须跑 `make check` 再提交**（见上方说明）。
* **改过 `models/*.model` 之后先跑 `make` 确认能出 GRF**，并把
  `make diag` 产出的对照图看一遍。
* `gfx/` 与 `out/` **不入库**（`.gitignore`），由 `models/` + `tools/` 确定性重放。
* 行尾统一 LF，由 `.gitattributes` 固定 —— 别让 autocrlf 把 Makefile 换成 CRLF。
