# 这是一份 **vendored 快照**，不是开发中的副本

`tools/flatiso/` 是 [flatiso 等距精灵管线] 的**整份拷贝**，放在本仓库里是为了让
**clone 本仓库的人不需要再去找第二个仓库**就能出图。

| 项 | 值 |
|---|---|
| 来源 | flatiso 上游仓库（本工程作者自己的项目，独立 git 仓库） |
| 源 commit | `8720126` —— 2026-09-29 `为管线写"给其他 AI 读"的操作与建模说明` |
| 拷贝日期 | 2026-10-01 |
| 拷贝范围 | **除 `.git/` 与 `out/` 之外的全部**（`out/` 是它的构建产物，不入库） |
| 上游权威 | **在 flatiso 自己的仓库里**，不在这里 |
| **许可** | **GNU GPL v2**（与 `China Style Tracks` 本仓库同一份，见仓库根目录 `LICENSE`）。它是同一个作者的作品，随本仓库一起按 GPL v2 发布 |

## 规矩

1. **不要在 `tools/flatiso/` 里做长期开发。** 这里改了不会回流到上游，下次同步就丢。
   要改渲染器 → 去上游仓库改，然后再同步一份下来。
2. **本工程对 flatiso 的改动是严格限定的**（见 `实现计划.md` §5 与 `docs/建模标准.md` L7）。
   本项目**没有**改过 `tools/flatiso/core/` 下的任何文件。
3. 同步方式：把上游按同样的排除规则重新拷一遍（`robocopy <src> tools/flatiso /E /XD .git out`），
   然后更新本文件里的「源 commit」。
4. 想临时用外面的 flatiso 版本调试：设环境变量即可覆盖默认值。

   ```powershell
   $env:FLATISO = 'D:/CNS/ottd/建筑测试/flatiso'
   node tools/build.mjs --step render
   ```

   （`Makefile.config` 里的 `FLATISO ?= tools/flatiso` 优先级最低，环境变量优先。）

## 顺带说明

`tools/flatiso/.dsh/skills/flatiso-model-authoring/` 是随拷贝带过来的技能说明。
**它只在 cwd 位于本仓库内时才会被扫到**。在 `D:\CNS\ottd` 下工作时用的是
`D:\CNS\ottd\.dsh\skills\flatiso-model-authoring` 那个 NTFS 目录联接（指向上游那份）。
三处**不要各改各的**——要改就去上游改。

> ⚠ 那份 skill 里还留着**指向上游仓库的绝对路径**（在「提交约定 / dubious ownership」
> 那一节），那是**上游自己的运维说明**，对本仓库的读者没有意义 ——
> **不要去照着执行**。本快照刻意保持与上游逐字一致，所以没有化简它；
> 改了下次同步也会被覆盖。
>
> 本仓库自己的施工说明在 `.dsh/skills/china-track-authoring/`，那份是干净的、没有绝对路径。
