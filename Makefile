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
#   make diag       重出定标图（out/calibrate/）
#   make check      一致性自检（含 templates.pnml 对账）
#   make clean      删除生成物（保留源码）—— **会连 out/calibrate/ 一起删**
#
# ⚠ src/rails/templates.pnml 是**手写源文件**，没有生成器，make 不会碰它。
#   模型改了尺寸/占地后，跑 `make sprites` 拿当前正确值，手抄回去。
# =============================================================================

NODE ?= node

-include Makefile.config

.PHONY: all grf sprite render sprites diag calibrate compare check clean help

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
