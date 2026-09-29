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
#   make sprite     只重出精灵与模板，不编 GRF
#   make render     只调 flatiso 渲染
#   make template   只从 openttd.json 生成 templates.pnml
#   make diag       重出两张定标图（out/calibrate/）
#   make check      一致性自检
#   make clean      删除生成物（保留源码）—— **会连 out/calibrate/ 一起删**
# =============================================================================

NODE ?= node

-include Makefile.config

.PHONY: all grf sprite render template diag calibrate compare check clean help

all: grf

grf:
	$(NODE) tools/build.mjs

sprite: render template

render:
	$(NODE) tools/build.mjs --step render

template:
	$(NODE) tools/build.mjs --step template

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
