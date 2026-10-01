---
name: flatiso-model-authoring
description: flatiso 等距精灵管线的建模权威参考 —— 手写 .model 构件清单的全部关键字与图元签名（含每个参数的默认值）、材质表与颗粒族、线脚（strip/courses）配方、瓦片比例尺手册、建模检查单、build/inspect/check/verify 命令行参数，以及会导致黑屋顶、深度闪烁、比例失真的已知陷阱。也覆盖 OpenTTD isometric sprite pipeline 的 tile-scale modelling、footprint 选择与逐朝向渲染。写或改 models/*.model、挑材质、加线脚、定尺寸、排查渲染错误时加载。
whenToUse: 需要手写或修改 flatiso 的 .model 模型、选材质或线脚、判断某栋楼该多高多大、给建筑补细节、或渲染结果看起来不对（黑面、缝、越界、比例怪）时。纯读代码或只跑构建不需要。
---

# flatiso 建模参考

本文件是**手工建模**的权威口径。所有签名与默认值都从 `core/model.mjs`、`core/materials.mjs`
逐条核对过；如果本文件和代码不一致，**以代码为准**，并回来改本文件。

配套阅读：

| 想知道什么 | 看哪 |
|---|---|
| 这个仓库是什么、铁律、工作流 | 同目录上两级的 `AGENTS.md` |
| 为什么这么设计（投影推导、分级、颗粒、性能） | `PIPELINE.md` |
| 有哪些模型、产物长什么样 | `README.md` |
| 语法最权威的定义 | `core/model.mjs` 文件头的注释块 |

---

## 1. 铁律（先读这条，违反等于返工）

1. **模型是资产，不是程序。** `.model` 里只有一行行字面量构件：**没有循环、没有条件、
   没有随机数、没有"算法生成"**。每一面墙的尺寸、每一扇窗的位置都是写死的数字。
   写一个能生成 20 栋楼的函数 = 做错了。
2. **占地只能是 1×1 / 2×1 / 2×2 整瓦片**，且模型坐标必须落在 `[0,w]×[0,d]` 里，
   `(0,0,0)` 是占地西北角格角点。
3. **正面朝 `+y`**（屏幕右下）。门窗、店面、月台、入口都放在 `+y` 面。
4. **输出 32bpp RGBA 透明背景**，不做调色板量化。
5. **本工程只出图。** 不写 NML，不生成 GRF。
6. **渲染器冻结。** 改 `core/raster.mjs` / `core/look.mjs` / `core/grade.mjs` /
   `core/grain.mjs` 之前必须先问人。加模型、改 `models/*.model`、改 `tools/scene.mjs`
   的摆放清单不需要问。

---

## 2. 坐标与投影口径

世界坐标：`x` 向东、`y` 向南、`z` 向上，**单位是瓦片**（`1.0` = 一个 1×1 瓦片边长）。

```
screen_x = (y - x) · 128          HW = tilePx/2 = 128
screen_y = (x + y) · 64 - z · 156.7673     HH = tilePx/4 = 64,  zPx = HW·√6/2
```

与 OpenTTD `RemapCoords` 一致 ⇒ `+x` 朝屏幕左下、`+y` 朝屏幕右下。
`zPx = 156.7673` 是"2:1 菱形 + 真正交相机"唯一确定的值，相机仰角恰为 30°。**不要改它**，
改了就不是正交 2:1 了。

`tilePx = 256` ⇒ 1×1 瓦片投成 **256 × 128** 的菱形，**一条边水平跨 128 px**。
对应 OpenTTD 的 `ZOOM_LEVEL_IN_4X`。

世界单位 → 屏幕像素（`tilePx=256` 时）：水平约 **143 px/单位**，竖直约 **157 px/单位**。
所以线宽 `0.011` ≈ 1.5 px。

### 墙面的平面基（`<side>` / `at` / `u` / `v`）

| `side` | 外法线 | `at` 填什么 | `u`（面内水平） | `v`（面内竖直） | `p(u,v)` |
|---|---|---|---|---|---|
| `+x` | `[1,0,0]` | x 值 | `y` | `z` | `[at, u, v]` |
| `-x` | `[-1,0,0]` | x 值 | `y` | `z` | `[at, u, v]` |
| `+y` | `[0,1,0]` | y 值 | `x` | `z` | `[u, at, v]` |
| `-y` | `[0,-1,0]` | y 值 | `x` | `z` | `[u, at, v]` |
| `+z` | `[0,0,1]` | z 值 | `x` | `y` | `[u, v, at]` |
| `-z` | `[0,0,-1]` | z 值 | `x` | `y` | `[u, v, at]` |

构件一律按「**朝向 → 平面坐标 `at` → 面上矩形 → 材质**」排列。

---

## 3. 比例尺手册

**工程基准：1 瓦片 = 13.9 米。** 这不是 OpenTTD 的规定，是本工程自定的换算，
用来判断"这栋楼该多高多大"。它已经写进 `com_hotel90.model` 的文件头，
并由 `com_bldg90` 的层高 0.2366 格 = 3.3 米反推一致。**所有模型都按它对齐**，
改之前先想清楚整条管线会一起漂。

1 格 ≈ 13.9 米 ⇒ 1×1 地块 = **13.9 × 13.9 米**，2×2 地块 = **27.8 × 27.8 米**。

### 3.1 实测参考（从现有模型量出来的，照这个给尺寸）

| 参照物 | 模型 | 数值（格） | 换算 |
|---|---|---|---|
| 独栋平房 檐口 | `res_bungalow` | **0.175** | 2.4 米 |
| 独栋平房 屋脊 | `res_bungalow` | **0.265** | 3.7 米 |
| 独栋小屋 檐口 / 屋脊 | `res_cottage` | 0.322 / 0.484 | 4.5 / 6.7 米 |
| 联排住宅 檐口 / 屋脊 | `res_terrace` | 0.430 / 0.580 | 6.0 / 8.1 米 |
| 仓库 檐口 / 屋脊 | `ind_warehouse` | 0.430 / 0.570 | 6.0 / 7.9 米 |
| 老厂房 单坡 低/高 | `ind_factory` | 0.380 / 0.500 | 5.3 / 7.0 米 |
| 住宅标准层高 | `com_hotel90` | **0.223** | 3.1 米 |
| 办公楼标准层高 | `com_bldg90` | **0.2366** | 3.3 米 |
| 大门厅层高 | `com_hotel90` | 0.280 | 3.9 米 |
| 窗带高 | `com_bldg90` | 0.130 | 1.8 米 |
| 平窗高 | `com_hotel90` | 0.135 | 1.9 米 |
| 墙厚 | `com_bldg90` / `com_hotel90` | 0.026 ~ 0.030 | 0.36 ~ 0.42 米 |
| 人行里弄宽 | `res_bungalow` 院间距 | 0.25 | 3.5 米 |

**惯用尺寸速查**：单层住宅 0.175 檐口；两层 0.43 檐口；层高 0.223 ~ 0.237；
女儿墙顶一般落在 1.4 ~ 1.5（20 米上下）；线宽 **0.008 ~ 0.014**；窗台挑出 `depth*1.6`。

### 3.2 各模型当前体量（`zmax` 是渲染取景用的显式最高点）

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

`res_bungalow` 是**一个 1×1 瓦片里塞 4 栋独栋平房**的密度样板；`com_hotel90`
是 2×2 的尺度样板（主楼 1.64×1.21 = 22.8×16.8 米，侧退线只 0.18 = 2.5 米）。
低面数的几栋（`svc_kiosk` / `ind_warehouse` / `com_office` / `res_apartment` /
`res_terrace` / `ind_factory`）还没做过 `wall` 真窗洞那一轮，细节明显少一档。

---

## 4. 文件骨架

```
# 注释随便写，写清楚尺寸表
name      res_cottage        # 必须与文件名一致（构建时用文件名覆盖）
group     residential        # residential / commercial / industrial / services / misc
footprint 1 1                # 占地，整瓦片
zmax      0.70               # 可选：显式最高点，保证同类精灵格位一致
tag       ...

plate 0.020 0.020 0.980 0.980 0.006    grass
box   0.100 0.080 0.000  0.900 0.620 0.035   stone_dark
...
```

语法：**一行一个构件**，`关键字 位置参数... [键=值...]`；`#` 起注释；裸词当布尔标记
（`lit`、`vent`、`noocc`）；`at`、`x`、`y` 这类词只是可读性分隔符，解析时忽略。

通用修饰（任何构件都能加）：

| 修饰 | 作用 |
|---|---|
| `gid=N` | 复用面组。默认**每条构件独占一个面组**，构件之间自然出现分缝线；同组内折角超过 `creaseAngle`（32°）才画线。想让两件构件之间不画缝就合并 `gid` |
| `noocc` | 该构件不参与 AO 遮挡（细杆、台阶、绿篱这种不该投大阴影的） |

---

## 5. 基础图元（9 个）

```
plate  x0 y0 x1 y1 z                     mat
box    x0 y0 z0  x1 y1 z1                mat  [top=] [bottom=] [noocc]
quad   x0 y0 z0  x1 y1 z1  x2 y2 z2  x3 y3 z3   mat
poly   z   mat   x,y x,y x,y ...
prism  z0 z1  mat  x,y x,y ...
cyl    cx cy z0 z1  r0 r1  seg           mat
gable  x0 y0 x1 y1  zEave zRidge  <x|y>  over  mat  [side=] [bottom=] [tile*]
hip    x0 y0 x1 y1  zEave zRidge  inset  over  mat  [side=] [bottom=]
shed   x0 y0 x1 y1  zLow zHigh  <+x|-x|+y|-y>  mat  [side=] [bottom=] [tile*]
```

要点：

* `plate` 是**单面片**（只有朝上的面），用来铺地。零厚度，**一定要做背面剔除**，
  否则相机看到它背面时会凭空糊一块黑板（剔除已经是默认行为，见 `--no-cull`）。
* `box` 有 `top=` / `bottom=` 可以给顶面和底面换材质。
* `poly` 是 `z` 高度上的水平多边形；`prism` 是它的竖直拉伸。顶点按逆时针给。
* `cyl` 的 `seg` 是分段数：细管用 6，柱子 8，水箱 10~12，旗杆盘面才需要 14。
  分段数直接乘面数，别乱给大数。
* **屋面图元的坡面法线极易算错**，所以 `gable` / `shed` 的法线由 helper 现算，
  使用者只需要给 `<x|y>`（屋脊方向）/ `<+x|-x|+y|-y>`（坡向）。
* `tile*` 线脚开关见 §7.2。`hip`（庑殿顶）**刻意不支持**瓦垄 —— 南北坡是梯形，
  `addCourses` 只处理平行四边形，宁可不做也不做错。
* `side=` 是山墙/端墙材质，`bottom=` 是檐口底面（从下往上看得到的那个面），
  一般给 `trim_dark`。

---

## 6. 构件（15 个）

括号里是**代码里的默认值**（已核对）。

```
wall   <side> at u0 u1 v0 v1  <洞口 u0,v0,u1,v1>...  mat  [thick=0.03] [reveal=no] [gid=] [noocc]
win    <side> at u0 u1 z0 z1  glass  [frame=trim_white] [frameW=0.035] [mull=] [mullW=0.007]
                                      [depth=0.012] [inset=0] [sill=] [lit]
door   <side> at u0 u1 z0 z1  mat    [frame=trim_white] [frameW=0.05] [depth=0.014] [inset=0]
                                      [step=] [stepMat=stone_dark]
rail   <side> at u0 u1 z0 z1  mat    [t=0.028] [post=0.16]
step   <side> at u0 u1 z      [steps=2] [mat=stone_dark] [depth=0.095]
awning <side> at u0 u1 z      [depth=0.18] [mat=awning_red] [band=trim_white] [drop=0.06]
sign   <side> at u0 u1 z0 z1  mat    [depth=0.035] [trim=trim_dark|no]
chimney x0 y0 x1 y1 z0 z1     mat    [cap=trim_dark|no] [vent]
roofunit x0 y0 x1 y1 z        mat    [h=0.09] [grille=metal_dark|no]
tank   cx cy z0 h r           mat    [seg=10] [cap=metal_dark] [legs=no]
tree   cx cy r h              trunk-mat crown-mat  [seg=8] [tr=] [th=]
hedge  x0 y0 x1 y1 z          mat    [inset=0.012] [top=mat|no]
lamp   cx cy z0 h             mat    [head=metal_pale]
strip  x0 y0 z0  x1 y1 z1  <法线>  w  mat  [lift=0.0018] [gid=]
courses <side> at u0 u1 v0 v1  rows cols  mat  [w=0.009] [stagger=0.5] [lift=] [gid=]
```

### 6.1 `wall` —— 真窗洞（最重要的一条）

`box` 画的是**实心体**，渲染器**没有 CSG、不能挖洞**。想让玻璃真的退进墙里，
墙本身就必须真的是围着洞口砌起来的一圈实体 —— 否则退进去的玻璃和侧壁会被墙的正面
挡住（深度上墙更靠前）。手写这件事极易出错，所以交给 `wall` 切：

```
wall +y 1.360  0.180 1.820 0.030 1.425 \
     0.255,0.355,0.515,0.490  0.665,0.355,0.925,0.490  1.075,0.355,1.335,0.490 \
     tile_cream  thick=0.026
```

* 洞口写成 `u0,v0,u1,v1`，可以给**任意多个**，超出墙面范围会直接报错。
* 切法是**断头台式**：先按所有洞口的 u 边界把墙切成竖条，再在每条竖条里取洞口 v 区间的补集。
  因此**洞口之间在 u 方向不能重叠**（重叠会互相压住，直接报错），
  但**同一 u 范围、竖直堆叠的多层窗带是合法的**。
* 墙从 `at` **往内**做 `thick` 厚，洞口侧壁（窗套）从外表面一直做到内表面。
  配套的玻璃用 `win ... inset=<thick>` 沉到洞底。
* `reveal=no` 关掉侧壁（不是真洞口才用）。

### 6.2 `win` / `door` 的细节约定

* 玻璃面比窗框再内凹一点（`depth*0.35`）形成自遮蔽。
* `frameW` 会被**两次夹紧**：`min(frameW, 跨度/2.4, 高度/2.4)`。所以给大值不会撑爆窗，
  但**窄窗给 `0.035` 会只剩一条玻璃缝** —— 0.13 高的带窗要用 `0.018` 左右。
* `mull=N` 是**分成 N 扇**（产生 `N-1` 根竖梃），竖梃半宽 `mullW=0.007`，
  也会夹到 `跨度*0.25`。带窗竖梃动辄十几根，粗了就糊成条纹。
* **窗台始终挑出墙面**（`depth*1.6`），**不跟着 `inset` 沉进去** —— 窗台本来就是凸的。
  `sill=no` 关掉，`sill=<材质名>` 换材质。
* `lit` 用 `glass_lit`（自发光）替掉传进来的玻璃材质。
* `door` 的 `step=N` 调 `stoop()` 生成 N 级台阶，沿外法线一级级降下去，
  **最靠墙的一级最高**，总进深 `0.095*N`。**台阶会占进深，要算进占地**。

---

## 7. 线脚：纹理是怎么来的

**没有贴图、没有逐像素噪声图案。** 表面的"纹理感"全部来自**真的有宽度的几何线脚** ——
瓦垄、砖缝、幕墙竖梃、金属板肋、腰线、雨水管，都是一条条薄四边形贴在表面上，
**沿法线抬起 0.0018**（约 0.28 px）躲开深度打架，颜色用基材暗一档的 `*_seam` 材质。

好处：它**跟着透视走**，等距下屋面横垄会在坡面上正确收窄；线性会吃 AO、会进描边通道。

### 7.1 两条语法

```
# 一条线脚：给定两端点和所在表面的法线，宽度向面内铺开
strip  x0 y0 z0  x1 y1 z1   <法线>   <线宽>   mat   [lift=] [gid=]

# 一片平面上的成排分缝
courses <side> at  u0 u1 v0 v1   <rows> <cols>   mat   [w=] [stagger=] [lift=]
```

`courses` 的 `rows` 是**分垄数**（产生 `rows-1` 条横缝），`cols` 是**每垄的错缝片数**。
所以：

| 要做成什么 | 怎么写 |
|---|---|
| 砖墙 | `rows=8 cols=8` |
| 幕墙竖梃 | `rows=1 cols=9` |
| 金属板肋 | `rows=1 cols=18 tileStagger=0` |
| 面砖竖缝（只走实墙垛） | `rows=1 cols=3~4  w=0.006` |
| 抹灰分格 | `rows=6 cols=1` |
| 腰线 | 用 `strip`（腰线是有厚度的，`courses` 只是缝） |

法线可以写 `+y` / `-x` / `+z` 这类朝向词，也可以写 `nx,ny,nz`。

### 7.2 屋面图元自带瓦垄开关

```
gable ... roof_tile  tileRows=9  tileCols=8  tileW=0.010  tileMat=roof_tile_seam
shed  ... roof_metal tileRows=1  tileCols=18 tileW=0.008  tileMat=metal_rib  tileStagger=0
```

`addTiling()` 在坡面上以「脊线为原点、脊向为 U、坡向为 V」建平面坐标系，
再交给同一套 `addCourses`。

### 7.3 线宽与颜色

线是"凹缝"，用比基材**暗一档**的同色系；金属板肋是凸起受光，反而用**亮一档**
（`metal_rib`）。全部线脚落在 **0.008 ~ 0.014**；瓦缝 `0.006~0.011` 也常见。

**只要一条线脚只画在实墙上、不跨窗洞** —— 跨过去就是一条凭空搭在玻璃上的缝。

---

## 8. 材质表

只有**基色**（sRGB 0..255），没有贴图。名字写错会静默回落到中性灰 `[200,200,200]`
并记一条警告 —— 渲染不报错，但颜色不对，所以**改完看一下告警**。

### 8.1 抹灰 / 石材 / 混凝土

`plaster_white` `plaster_cream` `plaster_warm` `plaster_pink` `plaster_grey` `plaster_mint`
`stucco_tan` `concrete` `concrete_dark` `stone` `stone_dark`

### 8.2 砖

`brick_red` `brick_brown` `brick_pale` `brick_grey`

### 8.3 屋顶

`roof_tile` `roof_tile_dark` `roof_slate` `roof_slate_dark` `roof_shingle`
`roof_metal` `roof_green` `roof_teal`

### 8.4 木

`wood` `wood_dark` `wood_pale`

### 8.5 玻璃 / 灯

`glass` `glass_dark` `glass_reflect` `glass_lit`（自发光 0.32）

### 8.6 金属 / 管线

`metal` `metal_dark` `metal_pale` `rust`

### 8.7 线脚 / 构件

`trim_white` `trim_dark` `trim_red` `trim_blue` `trim_black`

### 8.8 中国 90~00 年代公共建筑（那个年代的外装三件套）

`tile_white` `tile_cream` `tile_grey`（面砖）· `granite_rose` `granite_grey`（台基/门厅）
· `glass_blue` `glass_green`（镀膜玻璃）· `metal_alu`（铝合金门窗）· `sign_cn_red`（红底招牌）

### 8.9 分缝 / 线脚（专供 `strip` / `courses` / `tileMat`）

`roof_tile_seam` `roof_tile_dark_seam` `roof_slate_seam` `roof_shingle_seam`
`roof_metal_seam` `roof_green_seam` `roof_teal_seam` `metal_rib`
`brick_seam` `brick_brown_seam` `brick_pale_seam` `brick_grey_seam`
`plaster_white_seam` `plaster_cream_seam` `plaster_pink_seam` `plaster_grey_seam` `stucco_tan_seam`
`concrete_seam` `stone_seam` `metal_seam` `metal_pale_seam`
`glass_seam` `glass_dark_seam` `wood_seam` `asphalt_seam` `pad_seam` `panel_seam`
`tile_white_seam` `tile_cream_seam` `tile_grey_seam` `granite_rose_seam` `granite_grey_seam`

### 8.10 地面

`asphalt` `asphalt_light` `concrete_pad` `kerb` `grass` `grass_dark` `gravel` `dirt` `sand`

### 8.11 布篷 / 招牌

`awning_red` `awning_green` `awning_blue` `awning_cream` `sign_yellow` `sign_white`

### 8.12 植被

`foliage` `foliage_dark` `foliage_light` `trunk`

### 8.13 颗粒（grain）按材质族自动给

幅度写在 `materials.mjs` 的 `GRAIN_RULES`，**不逐个材质标**。单位是显示空间的相对偏移。

| 材质族 | 幅度 | 材质族 | 幅度 |
|---|---|---|---|
| 抹灰 `plaster_*` | ±4.5% | 砖 `brick_*` | ±5.5% |
| 面砖 `tile_*` | ±3.8% | 花岗岩 `granite_*` | ±4.0% |
| 混凝土 `concrete*` | ±4.8% | 石 `stone_*` | ±3.2% |
| 瓦 `roof_tile` / `shingle` | ±5.0 / 5.5% | 板岩 `roof_slate` | ±4.2% |
| 金属屋面 `roof_metal` | ±2.8% | 沥青 / 铺装 | ±5.5% |
| 植被 `grass` / `foliage` | ±7.0 / 7.5% | 金属 `metal*` | ±2.2% |
| **线脚 `*_seam` / 玻璃 / 招牌 / `trim_*`** | **0** | 木 `wood*` | ±3.5% |

**为 0 的那几类是刻意的**：线脚本身就是 1~2 px 的深色细线，加颗粒只会把它糊掉；
玻璃和招牌是光洁面，加颗粒显脏。

---

## 9. 建模流程（照这个走）

1. **先定占地和体量**。查 §3 的比例手册，把主要标高（台基、各层、檐口、女儿墙顶、
   最高设备）算成一组格值，**写在文件头的注释里**，后面所有构件引用同一组数。
2. **铺地** —— `plate` 铺 `grass` / `concrete_pad` / `asphalt`，前院、车位、绿篱。
3. **主体** —— 用 `wall` 砌承重墙（带真洞口），不要用 `box` 再往上贴窗。
   山墙（±x 面）一般**少开窗**（`com_hotel90` 是南北各 4 樘、东西各 2 樘）。
4. **腰线 / 窗上下的分格** —— `box` 做有厚度的腰线，`courses` 做面砖竖缝。
5. **线脚** —— 瓦垄、砖缝、板肋，只画在实墙上。
6. **配件** —— `door` + `step`、`awning`、`sign`、`chimney`、`roofunit`、`tank`、
   `tree`、`hedge`。年代感靠这些，不靠调色。
7. **屋面** —— 女儿墙、水箱、电梯机房、招牌架、天线、通风器、分格缝。
   大片平屋顶**一定要加东西**，否则在那个视角下是一块空色板。
8. **渲染盯着看**：`node tools/inspect.mjs <名字> --zoom 5`
9. **四个朝向都要看一遍**（默认就出 4 张）。**背后视角会暴露院子里的细杆穿出屋顶**。
10. **自检**：`node tools/check.mjs`（几何 / 取景 / 一致性 / 确定性 / GRF）。
11. **入库**：`node tools/build.mjs --ss 3` → `node tools/verify.mjs --rebuild` → 提交。
    想进合成预览图就加到 `tools/scene.mjs` 的 `BUILDINGS` 清单（**那是清单不是生成器**）。

### 建模检查单

- [ ] `name` 与文件名一致；`footprint` 是整瓦片；坐标不越界、不穿地
- [ ] 正面（`+y`）是入口面；四朝向都看过
- [ ] 所有 `win` 都坐在 `wall` 的真洞口里，`inset` = 墙厚
- [ ] 线脚只画在实墙上，没跨窗洞
- [ ] 台阶 / 雨棚 / 挑出物**没越出占地**（`check.mjs` 会查）
- [ ] 院里的细高物件没有穿破屋顶（背后视角）
- [ ] 颜色名字全部存在（构建时的告警里没有 `未知材质`）
- [ ] `zmax` 覆盖真实最高点（天线、旗杆顶端）
- [ ] 三角面数量与同类建筑可比（1×1 约 1500~2500，2×2 约 4000~5500）

---

## 10. 工具 CLI

### `tools/build.mjs` —— 全量构建

| 参数 | 默认 | 作用 |
|---|---|---|
| `--only a,b` | 全部 | 只出指定模型（逗号分隔） |
| `--models <目录>` | `models` | 换模型目录 |
| `--out <目录>` | `out/atlas` | 换输出目录 |
| `--name <目录名>` | `atlas` | 等价于只改输出目录名 |
| `--rotations N` | 4 | 朝向数 |
| `--rot-step D` | 90 | 朝向间隔（度） |
| `--ss N` | 3 | 超采样倍数 |
| `--cols N` | 8 | 图集列数 |
| `--tile-px N` | 256 | 瓦片像素（改这个就改了缩放档） |
| `--zpx X` | 自动 | 覆盖竖直比例（**只用于实验**） |
| `--preset P` | `stylized` | `stylized` / `soft` / `bright` / `dramatic` |
| `--outline` | 关 | 打开描边通道 |
| `--no-grain` | — | 关材质颗粒 |
| `--grain-amount X` | 预设 | 颗粒幅度全局倍率 |
| `--grain-scale X` | 预设 | 颗粒空间尺度 |
| `--no-cull` | — | 关背面剔除（**只在排查时用**，关了会糊黑板） |
| `--flat` | — | 额外导出单张 PNG |

### `tools/inspect.mjs` —— 单栋放大

```
node tools/inspect.mjs <名字> [--rot N] [--zoom K] [--ss N] [--preset P]
                            [--outline] [--no-grain] [--grain-amount=N] [--grain-scale=X]
                            [--bg dark] [--tile-px N]
```

输出到 `out/inspect/<名字>.png`，文件名带 `_outline` / `_nograin` / `_g<N>` 后缀。

### 其它

```
node tools/check.mjs                          # 自检：几何 / 取景 / 一致性 / 确定性 / GRF
node tools/verify.mjs --rebuild               # 产物审计 + 跨进程逐字节复现
node tools/scene.mjs [--scale 2]              # 合成等距小城预览
node tools/smoke.mjs                          # 渲染器自检（字符画 + 投影比例）
```

`check.mjs` **只查渲染管线的不变量，不查好看不好看**：投影必是 256×128、
占地不越界不穿地、每张精灵四周至少 1px 全透明、同占地共用格位、
连渲两次逐像素 sha256 相同、图集尺寸是格位的整数倍。

### 性能参考

单台普通 CPU、纯 JS：`--ss 2` 约 9.5 s，`--ss 3` 约 11.5 s（10 栋 × 4 朝向）。
瓶颈是光栅化。要快就 `--ss 2`、`--rotations 2`、`--only <名字>`。AO 是毫秒级的。

---

## 11. 陷阱清单

以下是**实测踩过的**。完整版见 `PIPELINE.md` §10。

### 建模时最容易犯的

* **细高物件放院子里 = 会穿出屋顶。** 背景朝向（`--rot 1/2`）下它们会从屋脊后面戳出来。
  `res_cottage` 的院灯就是这么删掉的。
* **`box` 当墙用、再往上贴窗 = 玻璃被糊住。** 必须有 `wall` 切出真洞口，
  否则退进去的玻璃和侧壁在深度上永远输给墙的正面。
* **线脚必须沿法线抬起**（默认 `lift=0.0018`），否则和表面共面、深度相等，
  `dz <= zb` 看运气 → 闪烁。抬起量要**远小于线宽**，否则变成"贴纸"。
* **窗框给太宽会把窗糊成一条缝。** 0.13 高的带窗 `frameW` 只能给 `0.018` 左右
  （`win` 会夹到 `高度/2.4`，但夹完仍然可能只剩一条玻璃）。
* **材质名写错不报错**，静默变中性灰。看构建输出的告警。
* **`plate` 是单面片**：铺反了朝向就看不见。地面用 `+z`。
* **`poly` 顶点顺序反了会消失或法线朝内。**

### 渲染器侧的（改了会踩，先别改）

* **深度的 `depthK` 忘了导出是最阴的一脚**：`dz = NaN` → `NaN <= zb[di]` 恒为 `false`
  → 深度测试**永远通过** → 谁最后画谁覆盖。症状是"某些大平面糊住了所有东西"。
* **屋顶绕反了不会报错，只会变黑。** 面照样画出来，只是法线朝内。
  所以屋顶/棱柱一律走 `addQuadO/addTriO`（显式声明朝向，由 helper 决定要不要反序）。
  `addShed` 曾把法线写成 `norm([0,-rise,|run|])`，y 分量符号反了，**一整天都偏暗**。
  正确是 `norm([0, rise, run])`。凡是"看起来对但就是不对"的面，**先打印法线**。
* **必须做背面剔除**，否则单面片（招牌、栏杆、窗框）看到背面时会糊掉整栋楼。
* **取景必须取所有朝向的并集**，还要把占地菱形四角和 `zmax` 一起算进去。
* **旋转必须绕占地中心**，不能绕世界原点，否则楼会在屏幕上上下漂。
* **精灵尺寸要用整格，不能用内容紧包围盒**，否则同占地高矮不同的楼尺寸各异。
* **AO 要按「空间位置」分组算，不能按顶点算** —— 顶点是按面复制的，
  按顶点算会让相邻面的公共棱上出现明暗错缝。
* **颗粒必须采样在输出像素上，不能采样在子样本上**。子样本分辨率会让颗粒强度随 `ss`
  变化（破坏"可复现"），斜面上还会起摩尔纹。实现是用**像素中心的屏幕位置 + 该面的平面
  方程**反解世界坐标（Cramer 解三个未知数）。
* **对比曲线的支点不能写死在 0.5**。本工程的图整体偏亮，支点在 0.5 时对比**反而变小**。
* **改分级参数时别连着改两个变量。** 曾同时把 `contrast` 提到 1.30、`splitAmount` 提到
  1.25，红瓦被蓝味暗部冲成砖褐色。`splitAmount` 的量级要按"暗部占画面的比例"给，0.4 才对。
* **`dramatic` 预设默认关颗粒**：它开了每通道分档（`steps=9`），噪点跨档会在相邻两档之间
  横跳，出来是一片椒盐点。

### 环境侧的

* Git 对 `D:/CNS/ottd/建筑测试/flatiso` 会报 "dubious ownership"。
  **按命令临时绕过，不要改全局配置**：
  `git -c safe.directory='D:/CNS/ottd/建筑测试/flatiso' <子命令>`
* `node -e` 不能用顶层 `await`（CJS）。要写 `node --input-type=module -e`。
* `out/` 是生成物、不入库，由 `models/` + `core/` 确定性重放得到。
