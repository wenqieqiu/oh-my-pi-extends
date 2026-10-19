# 更新日志

本扩展的所有重要变更记录在此文件。版本号由 post-commit 钩子（`scripts/bump-version.ts`）按 Conventional Commits 自动递增：`fix:` → patch、`feat:` → minor、破坏性变更 → major；`docs:`、`chore:` 等不改版本号。

`v1.5.0` 是本仓库第一个带 git 标签的版本；更早的版本号来自各提交中的 `package.json`，未打标签。

## [1.5.0] - 2026-10-19

### 新增

- ADHD 摘要页脚的语言可配置：`/adhd-summary lang` 查看当前值，`/adhd-summary lang <语言>` 设置，配置项为 `~/.omp/agent/oh-my-pi-extends.json` 中的 `adhdSummary.language`
- 页脚条目文本**默认简体中文**（`zh`），与被总结回复的语言无关；`follow` 跟随回复语言；其它值（`en`、`ja`、`日本語` 等）原样作为目标语言
- 两个 setter（开关、语言）改为合并写入 `adhdSummary`，切换开关不会丢语言、反之亦然

### 说明

- 两段标题 `【精要结论】`/`【下一步】` 固定为中文，不随语言设置变化——布局属于扩展，不属于模型
- 配置文件缺失、损坏，或 `language` 为空串/非字符串时，回退为**默认开启 + `zh`**

## [1.4.3] - 2026-10-19

### 修复

- 索引刷新 worker 与钩子的句柄彻底解耦：worker 继承钩子的 stdout 会保持管道打开，git 因此等待——一次排期刷新曾把提交卡住 311 秒。改用 `cmd /c start /b` 并把 worker 自身的 stdio 重定向到 NUL

## [1.4.2] - 2026-10-19

### 修复

- 页脚等待空闲的上限由 10 秒提高到 25 秒，处理器预算 45 秒：宿主机在终结结算后还要生成标题、recap、todo HUD（实测 15 秒），此前页脚会被静默丢弃。已用测试钉住预算，防止再次悄悄变小；用户已经发了下一轮时仍然不追加

## [1.4.1] - 2026-10-19

### 修复

- post-commit 刷新不再拖住提交：`Bun.spawn + unref()` 的 worker 随父进程退出（等于没刷新），换成 `cmd /c start /b` 后又继承钩子句柄、git 仍要等待（一次排期刷新占用 267 秒）。最终改为 Node `child_process` 的 detached 派生 + 忽略 stdio，门控约 1 秒返回，worker 独立存活

## [1.4.0] - 2026-10-19

### 变更

- ADHD 页脚改为两段编号块：`【精要结论】`（≤2 条，第一条一句话结论）+ `【下一步】`（≤3 条），无需下一步时整段省略
- 布局由代码强制：`normalizeSummary` 把模型的输出归类到两段、剥掉围栏/列表符号/标签前缀，并自行编号与截断；模型完全忽略标题时按顺序兜底（首行作结论），只有「下一步」时把其第一条提升为结论，保证第一段不为空

## [1.3.0] - 2026-10-19

### 新增

- post-commit 钩子在版本号更新之外，另行刷新 gitnexus 与 codegraph 索引（`scripts/refresh-index.ts`）：后台进程、5 分钟节流、窗口内的提交改为在窗口结束排期一次；状态与日志写在 `.git/` 下，不进提交。`INDEX_REFRESH_WINDOW_MS` 可覆盖窗口，`INDEX_REFRESH_DISABLE=1` 关闭

## [1.2.0] - 2026-10-19

### 新增

- ADHD 式摘要页脚（`/adhd-summary`）：主 agent 终结结算后，用一次模型调用把回复压成最多三行的可见页脚，经 `sendMessage` 追加，**不触发额外回合**
- 续写结算（`willContinue` / `awaitingAsyncWork`）跳过，rewind、plan-mode、todo 提醒不会重复出页脚
- 无 UI 的会话（`--print`、RPC）不追加、也不发起模型调用；状态栏只在功能关闭时显示关闭文本
- 开关状态持久化到 `~/.omp/agent/oh-my-pi-extends.json`，缺失或损坏时默认开启

### 修复

- 配置导入加固：拒绝绝对路径、盘符/UNC 前缀、反斜杠、含 `..` 段落或解析后越出目标根目录的归档条目（`safeTreePath`），跳过并告警而不是写出
- 版本号比对时统一剥掉前缀 `v`（版本标记文件与 package 版本两侧）

## [1.1.2] - 2026-08-26

### 修复

- auto-amend 失败时回滚版本号，避免版本改了却没进提交
- 为 `bump-version` 补单元测试

## [1.1.1] - 2026-08-26

### 变更

- 版本号更新并入提交本身（暂存 `package.json` 后 `git commit --amend --no-edit`），不再残留在工作区；amend 以 `SKIP_SIMPLE_GIT_HOOKS=1` 执行，钩子不会自我循环

### 说明

- `1.1.0` 是钩子刚引入时由脚本写出、未随任何提交入库的过渡版本，无对应提交

## [1.0.0] - 2026-06-04

首个可用版本（2026-06-04 起，至 2026-08-26 前）。

### 新增

- 项目由 `omp-token-speed-display` 改名为 `oh-my-pi-extends`，作为 OMP 扩展（`omp.extensions` → `src/index.ts`）分发
- `/export-config`：把 `~/.omp/agent/` 下的 10 项配置（config.yml、APPEND_SYSTEM.md、extensions/、skills/、models.db、agent.db、mcp.json 等）打包为 `.tar.gz`，附 `manifest.json`（formatVersion、ompVersion、items）；导出后可一键打开文件管理器；`auth.json` 与扩展自身配置不在导出范围
- `/import-config`：校验归档与版本、还原前自动备份现有配置、按复选框多选还原
- `tar-utils.ts`：纯 TypeScript 的 tar.gz 实现，零外部依赖
- `/benchmark-token-speed`：测当前模型的 TTFT 与 TPS，三个场景；Escape 取消（双击保护 + `Promise.race` 安全网）
- `ui.ts`：复选框多选交互（↑↓/Enter）
- bun test 测试套件；oxlint + oxfmt 工具链与 `bun run check`
- post-commit 版本号自动更新（simple-git-hooks + `scripts/bump-version.ts`）
- README、CONTEXT.md 领域词汇表、gitnexus 索引与技能文档

[1.5.0]: https://github.com/wenqieqiu/oh-my-pi-extends/commit/74ae708
