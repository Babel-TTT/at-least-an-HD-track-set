# =============================================================================
# China Style Tracks —— 构建入口
#
# 设计立场（对应要求.md 第 12 行「xUSSR 的 makefile 只能在 wsl 跑」）：
#   * 不设置 SHELL，不依赖 /bin/bash
#   * 不使用 rm / cp / find / tar / sed 等 Unix 命令
#   * 不使用 $(shell ...) 里的 Unix 假设
#   * 所有实际逻辑都在 tools/*.mjs（Node），本文件只做目标编排
#
# 于是 `mingw32-make` / `make` 在纯 PowerShell 下即可工作。
#
#   make            等同 make grf
#   make render     只调 flatiso 渲染
#   make sprite     只渲染（= make render）
#   make sprites    打印手写模板表 + 出索引图（out/calibrate/index.png）
#   make switches   重生成 G1 交叉/道叉模型（改方向偏移后跑）
#   make slope      重生成 G1 坡道模型（改抬升量/坡面几何后跑）
#   make tunnel     重生成 G1 隧道口模型（TUN-1 料石端墙拱）
#
# ⚠ 图集自 2026-10 起**按类分表**：gfx/rail.png（轨道）/ gfx/tunnel.png（隧道口）
#   / 以后还有 catenary.png、fence.png…，登记在 tools/sheets.mjs。
#   好处：改隧道**不会**再把 40 张轨道图连带重排（以前会，格位被迫从
#   263×151 撑到 263×218，全部 rect 与 yrel 失效）。
#
#   make diag       重出定标图（out/calibrate/）
#   make check      一致性自检（含 templates.pnml 对账）
#   make clean      删除生成物（保留源码）—— **会连 out/calibrate/ 一起删**
#
# ⚠ src/rails/templates.pnml 是**手写源文件**，没有生成器，也没有同步脚本 ——
#   **任何脚本都不得写入它**（人工裁定，见 docs/建模标准.md L4）。
#   图集格位变了之后，跑 `make sprites` 拿当前正确值，**人工手抄**回去。
#   有意偏离算法值的行，在行尾写【手调】，make check 就不再报它。
# =============================================================================

NODE ?= node

-include Makefile.config

.PHONY: all grf sprite render sprites switches slope tunnel diag calibrate compare check clean help

all: grf

grf:
	$(NODE) tools/build.mjs

# 渲染 + 图集。templates.pnml 不参与 —— 它是手写的。
sprite: render

render:
	$(NODE) tools/build.mjs --step render

# 手写模板表：打印每个「模型#朝向」在 templates.pnml 里的行号与当前值，
# 以及按算法算出来的值（不一致会标出来）。--sheet 顺带出索引图。
sprites:
	$(NODE) tools/sprites.mjs --sheet

# 重生成 G1 交叉/道叉三个模型（方向偏移表在那个工具里）
# ⚠ 会**整份重写** models/G1_crossing|junction3|junction4.model
switches:
	$(NODE) tools/gen-g1-switches.mjs

# 重生成 G1 坡道两个模型（抬升量 RISE 与坡面几何在那个工具里）
# ⚠ 会**整份重写** models/G1_track_slope.model / models/G1_rail_slope.model
# 改完接着 render 重出图集（不 render 的话 openttd.json 还是旧的）。
# 只改几何不会重排图集格位；**新增/删除精灵才会**，那时才需要按 docs/建模经验.md
# §7.3 同步 src/rails/templates.pnml 的 rect。
slope:
	$(NODE) tools/gen-g1-slope.mjs
	$(NODE) tools/build.mjs --step render

# 重生成 G1 隧道口模型（TUN-1 料石端墙拱：端墙 + 半圆拱 + 压顶）
# ⚠ 会**整份重写** models/G1_tunnel_stone.model / G1_tunnel_stone_over.model
tunnel:
	$(NODE) tools/gen-g1-tunnel.mjs
	$(NODE) tools/build.mjs --step render

# 定标图：会被 make clean 删掉，需要时用这个重建
diag: calibrate compare

calibrate:
	$(NODE) tools/calibrate.mjs

compare:
	$(NODE) tools/compare.mjs

check:
	$(NODE) tools/check.mjs

clean:
	$(NODE) tools/clean.mjs

help:
	$(NODE) tools/build.mjs --help
