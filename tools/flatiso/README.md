# flatiso

固定 **2:1 等距正交**视角的**离线预渲染精灵管线**，纯 Node.js ESM、零第三方依赖。
不用 Blender、不做实时 PBR —— 几何体由我**手写成 `.model` 构件清单**（不是程序化生成器），
批量烘焙成**透明背景 RGBA 精灵**，产出可以直接进 **OpenTTD GRF 的 32bpp 资源**。

画风：**平涂为主 + 柔和环境光 + 轻微 AO + 几何线脚**，
再叠一层**色彩分级**（对比 / 饱和 / 冷暖分离）与**材质颗粒**做出预渲染资产的质感。
描边通道**默认关闭**（要就传 `--outline`，见 PIPELINE §7.5）。

```
node tools/build.mjs          # 全量构建：10 个模型 / 40 张精灵 / 3 张图集
node tools/scene.mjs          # 合成预览：按引擎摆放公式拼一张等距小城
node tools/check.mjs          # 自检：几何 / 取景 / 一致性 / 确定性 / GRF
node tools/verify.mjs         # 产物审计：PNG 格式 / 透明背景 / 元数据自洽
node tools/verify.mjs --rebuild   # 外加一次跨进程逐字节复现比对
node tools/inspect.mjs res_cottage --zoom 3   # 放大盯一栋楼的 4 个朝向
node tools/inspect.mjs res_cottage --zoom 3 --preset soft   # 和上一版观感 A/B
node tools/smoke.mjs          # 渲染器自检（打印字符画 + 投影比例）
```

观感预设：`stylized`（默认，风格化）/ `soft`（上一版，留着做 A/B）/
`bright`（展厅感）/ `dramatic`（强侧逆光 + 分档）。

## 看图

| 想看什么 | 文件 |
|---|---|
| **等距小城合成图**（14 栋摆在地形上，端到端验证锚点） | `out/preview/scene.png`（3732×2284）· `scene_2x.png` |
| **一栋一张的 4 朝向对照** | `out/atlas/contact.png` · `contact_2x.png` |
| **单张图集（棋盘底，看透明边）** | `out/atlas/1x1_preview.png` · `2x1_preview.png` · `2x2_preview.png` |
| **单栋放大细看** | `out/inspect/<名字>.png`（`node tools/inspect.mjs <名字> --zoom 3`） |
| **交互式预览**（切朝向 / 缩放 / 换底色） | `out/atlas/preview.html`（自包含，直接双击打开） |

完整设计说明见 **[PIPELINE.md](PIPELINE.md)**。

---

## 核心口径

| 项 | 值 |
|---|---|
| 瓦片像素 | `tilePx = 256` —— 1×1 瓦片投成 **256 × 128** 的菱形，**一条边水平跨 128 px** |
| 投影 | `screen_x = (y - x) · 128`，`screen_y = (x + y) · 64 - z · 156.767` |
| 轴向 | 与 OpenTTD `RemapCoords` **一致**：+x 朝屏幕左下、+y 朝屏幕右下，正面朝 +y |
| 竖直缩放 | `zPx = HW·√6/2 = 156.767` —— "2:1 菱形 + 真正交相机"唯一确定的值（相机仰角恰为 30°） |
| GRF 对接 | 输出**图 + 摆放清单**；NML 编写不在本工程范围内 |
| 色深 | **32bpp RGBA**，不做调色板量化 |
| 占地 | 只允许 **1×1 / 2×1 / 2×2** 整瓦片 |

## 纹理怎么来的：几何线脚

**没有贴图、没有逐像素噪声图案。** 表面的"纹理感"全部来自**真的有宽度的几何线脚** ——
瓦垄、砖缝、幕墙竖梃、金属板肋、腰线、雨水管，都是一条条薄四边形贴在表面上，
沿法线抬起 0.002 躲开深度打架，颜色用基材暗一档（或亮一档）的 `*_seam` 材质。

好处是它**跟着透视走**：等距下屋面的横垄会在坡面上正确收窄，砖缝会跟着墙的朝向变宽窄。
而且线脚会吃到 AO、会进描边通道，**哪里有线完全由 `.model` 决定**。

两种写法：

```
# 1) 屋面图元自带瓦垄开关
gable 0.115 0.095 0.885 0.605 0.320 0.480  x  0.045  roof_tile \
      side=plaster_cream  tileRows=8  tileCols=7  tileW=0.011  tileMat=roof_tile_seam

# 2) 通用线脚：一片平面上的成排分缝
courses +y 0.320  0.630 0.750 0.340 0.560  5 2  brick_seam  w=0.009   # 烟囱砖缝
courses +y 1.360  0.420 1.580 0.340 1.900  1 9  metal_seam   w=0.009   # 幕墙竖梃
strip 0.100 0.620 0.026  0.900 0.620 0.026  +y  0.012  kerb           # 勒脚压顶
```

`courses <朝向> at u0 u1 v0 v1 <rows> <cols> <材质>`：`rows` 是分垄数，
`cols` 是每垄的错缝片数。只在墙面上画竖梃就写 `rows=1`；只画横缝就写 `cols=1`。

## 产物

```
out/atlas/
  1x1.png  2x1.png  2x2.png          32bpp RGBA 图集（透明背景，正式资源）
  *_preview.png                      同尺寸棋盘底预览，方便肉眼看透明边
  atlas.json                         全量元数据：格位 / 锚点 / 每张精灵的 rect + xrel/yrel
  openttd.json                       给程序读的摆放清单（逐条 sprite，含缩放档与占地）
  preview.html                       自包含预览页（切朝向 / 缩放 / 底色）
  contact.png / contact_2x.png       一栋一张的对照图
out/preview/
  scene.png  scene_2x.png            等距小城合成图（端到端验证锚点）
out/inspect/
  <名字>.png                         单栋 4 朝向放大图
```

> **本工程只出图。** NML / GRF 的编写不在这里做 —— `openttd.json` 给的是
> `rect / xrel / yrel / 缩放档 / 逐朝向占地` 这些**摆放事实**，怎么写成 NML 由 GRF 工程决定。

## 程序侧怎么用

同一张图集里，**所有精灵尺寸完全相同**，而且**格位锚点在格内是常量**。
所以引擎只需要记住两个值：

```js
const sheet = atlas.sheets.find(s => s.key === '1x1');
const HW = 128, HH = 64;                     // = atlas.view.HW / HH

// 建筑占 tiles [tx, tx+fw) × [ty, ty+fd)
const cx = tx + fw / 2, cy = ty + fd / 2;    // 占地中心（世界坐标，单位瓦片）
const px = (cx - cy) * HW - sheet.anchor[0];
const py = (cx + cy) * HH - sheet.anchor[1];

ctx.drawImage(img, sp.col * sheet.cell[0], sp.row * sheet.cell[1],
              sheet.cell[0], sheet.cell[1], px, py, sheet.cell[0], sheet.cell[1]);
```

锚点用**占地中心**而不是西北角：模型绕占地中心旋转，锚点因此**不随朝向变化**，
2×1 的楼转 90° 之后仍然对得上。

进 OpenTTD GRF 时改用 `spritesets.nml` 里的 `xrel / yrel`
（= 该朝向的"占地西北角格角点"在精灵内的像素取负），与 `RemapCoords` 直接配套。

## 模型一览

| 模型 | 分组 | 占地 | 说明 | 线脚 |
|---|---|---|---|---|
| `res_cottage` | residential | 1×1 | 独栋小屋：勒脚 + 抹灰主体 + 人字瓦顶 + 砖烟囱 + 院墙绿篱 | 8 垄瓦面、烟囱砖缝、勒脚压顶、檐口滴水 |
| `svc_kiosk` | services | 1×1 | 街角便利店：平屋顶女儿墙 + 整片橱窗 + 红色雨棚 + 屋顶招牌 | 屋面板缝、女儿墙压顶、橱窗过梁 |
| `res_terrace` | residential | 2×1 | 联排住宅两户：各自屋顶/烟囱/门窗/台阶 + 中间防火隔墙 | 两户各自的瓦垄、烟囱砖缝、隔墙压顶 |
| `ind_warehouse` | industrial | 2×1 | 大跨度仓库：金属围护 + 双坡顶 + 通风器 + 装卸月台双卷帘门 | 屋面 17 道直立锁边肋、墙面板缝、月台边缘 |
| `res_apartment` | residential | 2×2 | 四层板楼：四面开窗 + 南面挑阳台 + 屋顶水箱与机组 | 每层楼板腰线、台基/顶檐压顶、屋面板缝 |
| `com_office` | commercial | 2×2 | 中高层写字楼：两层裙房 + 幕墙塔楼 + 五道腰线 + 转角壁柱 + 天线 | 幕墙竖梃成格、裙房板缝、基座/顶檐压顶 |
| `ind_factory` | industrial | 2×2 | 老式厂房：砖砌单坡厂房 + 砖烟囱 + 立式储罐 + 管道 + 堆场 | 屋面板肋、砖墙层缝错缝、烟囱砖缝 |
| `res_bungalow` | residential | 1×1 | **密度样板**：一个瓦片里 4 栋独栋平房 + 院墙绿篱 | 各自的瓦垄、院墙压顶、门窗过梁 |
| `com_bldg90` | commercial | 2×2 | **细节标杆**：机关/邮电大楼 —— 两层挑高裙房 + 七层标准层塔楼 + 门厅大台阶 + 雨棚 + 红招牌 + 屋顶电梯机房/水箱/天线 | 面砖分格缝、幕墙竖梃成格、五道腰线、台基/顶檐压顶 |
| `com_hotel90` | commercial | 2×2 | **细节标杆**：招待所 —— 米黄面砖 + 蓝玻平窗 + 凸出玻璃门厅 + 车道雨棚（列柱）+ 屋顶水箱/招牌 + 前院车道与车位 | 面砖竖缝、腰线、空调外机与冷凝水管、屋面板缝 |

`res_bungalow` / `com_bldg90` / `com_hotel90` 是后加的，尺度与细节向它们看齐。
剩下 6 栋（`svc_kiosk` / `ind_warehouse` / `com_office` / `res_apartment` /
`res_terrace` / `ind_factory`）**还没做过 `wall` 真窗洞那一轮**，细节少一档。

模型是**手写的构件清单**：`models/*.model` 里每行一个构件，尺寸全是写死的数字，
没有循环、没有条件、没有随机数。

## 目录

| 文件 | 说明 |
|---|---|
| `core/project.mjs` | 2:1 等距正交投影、深度、缩放档 |
| `core/mesh.mjs` | 网格容器 + 图元（盒/棱柱/圆柱/双坡/四坡/单坡） |
| `core/look.mjs` | 观感预设：光照、AO、描边参数 |
| `core/grade.mjs` | 色彩分级参数：对比 / 分档 / 饱和 / 冷暖分离 |
| `core/grain.mjs` | 材质颗粒：3D 值哈希，1 输出像素粒度、与 `ss` 无关 |
| `core/materials.mjs` | 材质表（只有基色，没有贴图） |
| `core/ao.mjs` | 离线烘焙 AO（半球光线步进）+ 接地遮蔽 |
| `core/raster.mjs` | 平面着色光栅器 + 超采样解析 + 细描边 |
| `core/model.mjs` | `.model` 手写清单解释器 |
| `core/bake.mjs` | 模型 → 多朝向精灵（统一取景） |
| `core/atlas.mjs` | 规则网格图集打包 |
| `core/grf.mjs` | OpenTTD 对接：xrel/yrel、缩放档、NML spriteset |
| `core/png.mjs` | 零依赖 PNG 编解码 |
| `core/preview.mjs` | 自包含 HTML 预览页 |
| `tools/*.mjs` | build / scene / check / verify / inspect / smoke |

## 依赖

Node.js 18+，**仅标准库**（PNG 编解码器也是自己写的，只用 `node:zlib`）。
