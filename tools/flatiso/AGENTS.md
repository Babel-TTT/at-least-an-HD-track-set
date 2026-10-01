# flatiso —— 给 AI 的项目说明

固定 **2:1 等距正交**视角的**离线预渲染精灵管线**，纯 Node.js ESM、**零第三方依赖**
（PNG 编解码器也是自己写的，只用 `node:zlib`）。不用 Blender、不做实时 PBR。
几何体是**手写成 `.model` 构件清单**，批量烘焙成**透明背景 32bpp RGBA 精灵**，
产出可以直接进 **OpenTTD GRF 的 32bpp 资源**。

画风：**平涂为主 + 柔和环境光 + 轻微 AO + 几何线脚** + 色彩分级 + 材质颗粒。
描边通道**默认关闭**。

> **要写或改模型，先加载技能 `flatiso-model-authoring`。**
> 那里有全部图元与构件的签名（含每个参数的默认值）、材质表、线脚配方、
> 比例尺手册、建模检查单和陷阱清单。本文件只管"是什么、铁律、怎么干活"。

---

## 铁律

这几条是项目的立场，**不是偏好**。违反等于返工：

1. **模型是资产，不是程序。** `models/*.model` 里**只有一行行字面量构件**：
   尺寸全是写死的数字，**没有循环、没有条件、没有随机数、没有"算法生成"**。
   跟在建模软件里一件件摆出来是一回事。写一个能生成 N 栋楼的函数 = 做错了。
2. **占地只能是 1×1 / 2×1 / 2×2 整瓦片。** 坐标落在 `[0,w]×[0,d]` 内，
   `(0,0,0)` 是占地西北角格角点。
3. **正面朝 `+y`**（屏幕右下）。门窗、店面、入口、月台都在 `+y` 面。
4. **输出 32bpp RGBA 透明背景。** 不做调色板量化。
5. **本工程只出图。** 不写 NML、不生成 GRF。`openttd.json` 给的是
   `rect / xrel / yrel / 缩放档 / 逐朝向占地` 这些**摆放事实**，怎么写成 NML 由 GRF 工程决定。
6. **渲染器冻结。** 改 `core/raster.mjs` / `core/look.mjs` / `core/grade.mjs` /
   `core/grain.mjs` / `core/project.mjs` **之前必须先问人**。

**不需要问就能做的**：新增或修改 `models/*.model`、改 `tools/scene.mjs` 的摆放清单、
跑构建与自检、提交。**需要先问的**：任何渲染器改动、改观感预设、改投影常数、
改材质表里已有材质的颜色。

---

## 核心口径

| 项 | 值 |
|---|---|
| 瓦片像素 | `tilePx = 256` —— 1×1 瓦片投成 **256 × 128**，**一条边水平跨 128 px** |
| 投影 | `screen_x = (y - x)·128`，`screen_y = (x + y)·64 - z·156.7673` |
| 轴向 | 与 OpenTTD `RemapCoords` 一致：`+x` 屏幕左下、`+y` 屏幕右下 |
| 竖直缩放 | `zPx = HW·√6/2 = 156.7673` —— "2:1 菱形 + 真正交相机"唯一确定（仰角恰 30°） |
| 缩放档 | 对应 OpenTTD `ZOOM_LEVEL_IN_4X` |
| 比例尺 | **1 瓦片 = 13.9 米**（本工程约定）⇒ 1×1 地块 13.9×13.9 米、2×2 地块 27.8×27.8 米 |
| 线宽 | 0.008 ~ 0.014（`tilePx=256` 时 0.011 ≈ 1.5 px） |
| 世界→屏幕 | 水平 ≈143 px/单位，竖直 ≈157 px/单位 |

---

## 怎么干活

```
node tools/build.mjs              # 全量构建：10 个模型 / 40 张精灵 / 3 张图集
node tools/inspect.mjs <名字> --zoom 5   # 死盯一栋楼的 4 个朝向
node tools/check.mjs              # 自检：几何 / 取景 / 一致性 / 确定性 / GRF
node tools/verify.mjs --rebuild   # 产物审计 + 跨进程逐字节复现
node tools/scene.mjs [--scale 2]  # 合成等距小城（端到端验锚点）
node tools/smoke.mjs              # 渲染器自检（字符画 + 投影比例）
```

### 改模型的标准闭环

1. 改 `models/<名字>.model`
2. `node tools/inspect.mjs <名字> --zoom 5` —— **肉眼盯着看**，四个朝向都要看
   （背后视角会暴露院子里细杆穿出屋顶）
3. `node tools/check.mjs` —— 必须 **0 问题**
4. `node tools/build.mjs --ss 3`
5. `node tools/verify.mjs --rebuild` —— 必须 **0 问题**，且三张图集逐字节可复现
6. 提交

**只改一栋楼时用 `--only <名字>` 能省很多时间。**
`check.mjs` 只查管线不变量，**不查好看不好看** —— 好看与否只能靠 `inspect` 看图。

---

## 目录

| 路径 | 说明 |
|---|---|
| `models/*.model` | **手写的建筑构件清单**（这是资产本体） |
| `core/project.mjs` | 2:1 等距正交投影、深度、缩放档 |
| `core/mesh.mjs` | 网格容器 + 图元（盒/棱柱/圆柱/双坡/四坡/单坡/线脚） |
| `core/model.mjs` | `.model` 手写清单解释器；**文件头注释是语法的权威定义** |
| `core/raster.mjs` | 平面着色光栅器 + 超采样解析 + 细描边 |
| `core/look.mjs` `core/grade.mjs` `core/grain.mjs` | 观感预设 / 色彩分级 / 材质颗粒 |
| `core/materials.mjs` | 材质表（只有基色，没有贴图）+ 颗粒规则 |
| `core/ao.mjs` | 离线烘焙 AO（半球光线步进）+ 接地遮蔽 |
| `core/bake.mjs` `core/atlas.mjs` `core/grf.mjs` `core/png.mjs` `core/preview.mjs` | 烘焙 / 图集 / OpenTTD 对接 / PNG / 预览页 |
| `tools/*.mjs` | build / scene / check / verify / inspect / smoke |
| `out/` | **生成物，不入库**（`.gitignore`），由 `models/` + `core/` 确定性重放得到 |
| `PIPELINE.md` | **设计说明**：投影推导、分级、颗粒、性能、踩过的坑 |
| `README.md` | 面向人的总览 |
| `.dsh/skills/flatiso-model-authoring/` | 建模权威参考（技能） |

### 关于那份技能：只能有一份

`.dsh/skills/flatiso-model-authoring/SKILL.md` **是唯一的那份，要改就改它。**

技能根是按「**cwd 往上找最近的 `.git`**，找不到就退回 cwd」定的：

| 会话 cwd | 技能根 | 能扫到仓库里这份吗 |
|---|---|---|
| `建筑测试\flatiso` 或更深 | `建筑测试\flatiso\.dsh\skills` | ✅ 直接就是 |
| `D:\CNS\ottd`（默认工作目录，**没有 `.git`**） | `D:\CNS\ottd\.dsh\skills` | ❌ 扫不到 |

为了在默认 cwd 下也能用，`D:\CNS\ottd\.dsh\skills\flatiso-model-authoring`
是一个**指向本目录的 NTFS 目录联接（junction）**，不是副本。

> **不要在 `D:\CNS\ottd\.dsh\skills` 下另建一份真的 `SKILL.md`。**
> 两份会立刻漂移，而且同名技能会出现歧义。
> 重建联接（删了或换机器之后）：
>
> ```powershell
> New-Item -ItemType Junction `
>   -Path   'D:\CNS\ottd\.dsh\skills\flatiso-model-authoring' `
>   -Target 'D:\CNS\ottd\建筑测试\flatiso\.dsh\skills\flatiso-model-authoring'
> ```

同理 `D:\CNS\ottd\AGENTS.md` 是工作区级导航（会话开在 `D:\CNS\ottd` 时，
它才是唯一会被注入的那份），本文件是项目级、更具体，优先级更高。

### 看图

| 想看什么 | 文件 |
|---|---|
| 等距小城合成图 | `out/preview/scene.png` · `scene_2x.png` |
| 一栋一张的 4 朝向对照 | `out/atlas/contact.png` · `contact_2x.png` |
| 单张图集（棋盘底，看透明边） | `out/atlas/1x1_preview.png` · `2x1_preview.png` · `2x2_preview.png` |
| 单栋放大细看 | `out/inspect/<名字>.png` |
| 交互式预览（切朝向/缩放/底色） | `out/atlas/preview.html` |

---

## 模型一览

| 模型 | 分组 | 占地 | `zmax` | 三角面 |
|---|---|---|---|---|
| `res_cottage` | residential | 1×1 | 0.70 | 1522 |
| `res_bungalow` | residential | 1×1 | 0.34 | 2424 |
| `svc_kiosk` | services | 1×1 | 0.66 | 228 |
| `res_terrace` | residential | 2×1 | 0.78 | 920 |
| `ind_warehouse` | industrial | 2×1 | 0.60 | 326 |
| `ind_factory` | industrial | 2×2 | 1.42 | 1056 |
| `res_apartment` | residential | 2×2 | 1.42 | 870 |
| `com_office` | commercial | 2×2 | 2.44 | 366 |
| `com_hotel90` | commercial | 2×2 | 1.88 | 4526 |
| `com_bldg90` | commercial | 2×2 | 2.68 | 5552 |

`com_hotel90` 与 `com_bldg90` 是**细节标杆**（90 年代中国公共建筑：面砖 + 蓝玻 +
铝窗 + 花岗岩台基 + 红招牌，用 `wall` 做真窗洞，有空调外机、屋面设备、女儿墙）。
`res_bungalow` 是**密度标杆**（一个 1×1 瓦片里 4 栋独栋平房）。

**还有 6 栋停在早期版本**，没做过 `wall` 真窗洞那一轮，细节少一档：
`svc_kiosk` / `ind_warehouse` / `com_office` / `res_apartment` / `res_terrace` / `ind_factory`。

---

## 产物契约

同一张图集里**所有精灵尺寸完全相同**，而且**格位锚点在格内是常量**。
引擎侧只需要记住两个值：

```js
const sheet = atlas.sheets.find(s => s.key === '1x1');
const HW = 128, HH = 64;                     // = atlas.view.HW / HH
const cx = tx + fw / 2, cy = ty + fd / 2;    // 占地中心（世界坐标，单位瓦片）
const px = (cx - cy) * HW - sheet.anchor[0];
const py = (cx + cy) * HH - sheet.anchor[1];
```

锚点用**占地中心**而不是西北角：模型绕占地中心旋转，锚点因此**不随朝向变化**，
2×1 的楼转 90° 之后仍然对得上（此时占地变成 1×2，记在 `footprintRotated`）。

进 OpenTTD GRF 时改用 `atlas.json` 里逐朝向的 `xrel / yrel`，与 `RemapCoords` 直接配套。

---

## 提交约定

* 提交信息用**中文**，说清"改了什么 + 为什么"，带上关键数字（三角面、格位、耗时）。
* 多行提交信息含引号时，**写进临时文件再 `git commit -F`**，直接 `-m` 会被 shell 拆坏。
* Git 对 `D:/CNS/ottd/建筑测试/flatiso` 会报 "dubious ownership"。
  **按命令临时绕过，不要改全局配置**：

  ```
  git -c safe.directory='D:/CNS/ottd/建筑测试/flatiso' <子命令>
  ```

* 提交前 `check.mjs` 与 `verify.mjs --rebuild` 都要 0 问题。

---

## 陷阱速查

完整版在 `PIPELINE.md` §10 与技能 `flatiso-model-authoring` §11。

* **`box` 当墙、再往上贴窗 → 玻璃被糊住。** 必须用 `wall` 切出真洞口（渲染器没有 CSG）。
* **细高物件别放院子。** 背后朝向会从屋脊后面戳出来。
* **线脚必须沿法线抬起**（默认 `0.0018`），否则共面深度相等、闪烁。
* **材质名写错不报错**，静默变中性灰 —— 看构建告警。
* **屋顶绕反不会报错，只会变黑。** 凡是"看起来对但就是不对"的面，**先打印法线**。
* **`plate` 是单面片**，零厚度，靠背面剔除兜底。
* **颗粒必须采样在输出像素上，不能在子样本上**，否则强度随 `--ss` 变化，破坏可复现。
* **`out/` 不入库**，别把它当源文件编辑。
