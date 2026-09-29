China Style Tracks —— 中国风格轨道包
====================================

OpenTTD 的 32bpp 4x 中国风格铁路轨道 NewGRF。

美术：用 flatiso 等距预渲染管线，从手写 .model 离线烘焙成 32bpp RGBA 精灵。
代码：NML，轨道编码遵循标准化轨道编码方案（Standardized Railtype Scheme）。


依赖
----
  Node.js >= 18     构建脚本
  GNU Make          mingw32-make 即可（Windows 原生，不需要 WSL）
  gcc               预处理器（nmlc 不自带 #include / #define）
  nmlc              NML 编译器，0.9.0 以上
  flatiso           外部等距渲染器，路径在 Makefile.config 的 FLATISO


构建
----
  make              全流程，产物 out/china-style-track.grf
  make help         列出全部目标


口径
----
本包最底层的坐标 / 锚点 / 朝向口径全部记录在 docs/定标.md，
并由 out/calibrate/anchors.png 提供实测佐证。改动模型前请先读它。


轨道类型
--------
以 中国轨道包.csv 为准，共 31 种。label 遵循标准化轨道编码：
  第 1 字母  轨距    S=1435  B=1520  N=1067/1000  n=762/600  D=1435+1520  d=1435+1067
  第 2 字母  速度档  A=80  B=120  C=160  D=210  E=250  F=310  G=无限 (km/h)
  第 3 字母  轴重    A<=15t  B=16-19t  C=20-23t  D=24-26t  E>=27t
  末 字母   电气化  N=非电  A=25kV AC  d=1.5kV DC  (=AC+DC  3=第三轨  Z=第三轨+DC

既成扩展（非 wiki 原文，xUSSR / China Set 已在用）：
  D = 3kV DC（朝鲜、俄罗斯）    E = 支持全部电气化
  L = 直线电机（本包自定义，用于 SADL）


已知缺口
--------
  * 接触网（杆塔 / 导线）尚未提供，电气化轨道暂用引擎原版
  * 机车库、围栏、GUI 工具栏图标尚未提供


许可
----
见 docs/license.txt
