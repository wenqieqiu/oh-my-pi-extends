# oh-my-pi-extends

Oh My Pi（OMP）扩展集。当前提供**配置备份**、**模型速度基准测试**与 **ADHD 式摘要**三大功能。

- **配置备份**：把本机 OMP 配置（config.yml、extensions、skills、模型数据库等）打包为 `.tar.gz` **备份文件**，可在另一台电脑**还原**；导入时先做**还原前备份**，并校验备份格式版本与 OMP 版本。
- **模型速度测试**：测量当前会话模型的 token 输出速度（TTFT + TPS），支持 Esc / Ctrl+Shift+E 中止。
- **ADHD 式摘要**：每条**终结**回复后追加一条可见的两段式页脚——【精要结论】（首条为一句话结论）+【下一步】，每段都是带序号的条目（条数上限由代码强制）。

## 命令

| 命令                       | 功能                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `/export-config`           | 选择配置项目 → 导出为 `tar.gz` 备份文件                            |
| `/import-config`           | 选择备份文件 → 校验 → 选择还原项目 → 还原前备份 → 还原             |
| `/benchmark-token-speed`   | 测试当前模型 token 输出速度（三个真实场景，各测一遍取均值）         |
| `/adhd-summary`            | 开关 ADHD 式摘要（无参数即切换，或 `on` / `off` / `status`）         |
| `Ctrl+Shift+E`（快捷键）   | 中止正在运行的基准测试（Esc 键亦可）                               |

> 命令一律在 OMP 聊天输入。基准测试进度通过会话消息实时显示。

## 安装

### 方式 1：本地 link（开发/单机用）

```bash
omp plugin link /path/to/oh-my-pi-extends
```

### 方式 2：GitHub 安装

推送到 GitHub 后：

```bash
omp plugin install https://github.com/wenqieqiu/oh-my-pi-extends
```

### 方式 3：配置文件加载

```yaml
# ~/.omp/agent/config.yml
extensions:
  - "C:/Users/xxx/oh-my-pi-extends"
```

## 卸载

### 方式 1 / 方式 2：通过 link 或 GitHub 安装

```bash
omp plugin uninstall oh-my-pi-extends
```

### 方式 3：通过配置文件加载

编辑 `~/.omp/agent/config.yml`，移除 `extensions` 列表中对应的路径，保存后重启 OMP。

### 方式 4：目录复制

删除复制的目录即可。如果通过 `omp plugin link` 注册过，需先执行 `omp plugin uninstall oh-my-pi-extends`。

## 使用流程

### 导出配置

1. 在 OMP 聊天输入 `/export-config`
2. 选择要包含的项目（config.yml、APPEND_SYSTEM.md、extensions/、skills/、models.db、agent.db、last-changelog-version、mcp.json、skill-descriptions.db、managed-skills/），可全选或逐个勾选
3. 确认保存路径（默认 `~/omp-config-export-时间戳.tar.gz`）
4. 等待打包完成，可选在文件管理器中打开所在位置

导出产物是一个 `.tar.gz` 归档，内含被选项目的文件与 `manifest.json`（记录格式版本、导出的 OMP 版本、所含配置项）。

### 还原配置

1. 在目标机器 OMP 输入 `/import-config`
2. 输入备份文件路径（通常是你导出的 `*.tar.gz`）
3. 自动校验：文件是否为合法 tar.gz、是否含 `manifest.json`、备份格式版本是否受支持
4. 若导出的 OMP 版本与当前不一致，会提示确认是否继续
5. 选择要还原的项目（可全选或逐个勾选）
6. 现有配置先自动备份到 `~/.omp-agent-backup-时间戳.tar.gz`（还原前备份，防止丢失）
7. 还原完成后需重启 OMP 生效（`/quit` 退出后重新启动）

### 模型速度测试

1. 在 OMP 聊天输入 `/benchmark-token-speed`
2. 依次在「代码生成」「文本总结」「逻辑规划」三个真实场景下各测一遍，测量 TTFT 与 TPS
3. 每个场景单次测量超时 300 秒；单次失败不影响其余场景，失败不计入均值
4. 按 **Esc** 或 **Ctrl+Shift+E** 可随时中止整个测试（中止后不产出报告）
5. 完成后以会话消息输出测试报告（含汇总表与各次测量明细）

### ADHD 式摘要

只有**终结**的最终回复（主 agent 的回复）之后才追加摘要；续写类结算（rewind、plan-mode、todo 提醒等未终结的结算）不追加，因此同一条回复不会出现两次页脚。

摘要是一条**独立的可见会话消息**，固定为两段、每段都是带序号的条目：

```
【精要结论】
1. <一句话结论：结论先给，不铺垫>
2. <可选：支撑该结论的关键事实>

【下一步】
1. <下一步该做什么>
2. <可选：后续动作>
```

- 段数、段标题、序号都由扩展自己生成，不采信模型写的标题、符号与编号。
- **精要结论**最多 2 条，且第一条必须是结论性的一句话；**下一步**最多 3 条，确实无事可做时整段省略。
- 模型完全忽略标题时按顺序兜底：首行作结论，其余作下一步；只给了「下一步」而没给结论时，把它的第一条提升为结论，保证第一段不为空。
- markdown 围栏、列表符号、`Next step:` 之类的标签前缀在写出前剥掉。条目文本与被总结的回复使用同一语言。
- 摘要作为回复之后的独立会话条目显示，**不触发额外的会话回合**。

1. 开关：`/adhd-summary`（无参数即切换开关状态，不接受 `toggle` 等其它关键字）
2. 显式设置 / 查看：`/adhd-summary on`、`/adhd-summary off`、`/adhd-summary status`
3. 状态写在 `~/.omp/agent/oh-my-pi-extends.json`，形如 `{"adhdSummary":{"enabled":true}}`；文件缺失或损坏时按**默认开启**处理
4. 状态栏只在功能**关闭**时显示关闭状态文本；开启后清除该状态
5. 每条回复额外消耗一次模型调用，使用当前会话模型，**超时上限 20 秒**；无 UI 的会话（`--print`、RPC）不追加、也不发起这次调用
6. 失败一律**静默**：取不到模型、模型报错、超时、解析失败等情况下只不追加摘要，不报错、不阻塞回复、不占位

## 可导出的配置项目

| 项目             | 内容                             |
| ---------------- | -------------------------------- |
| config.yml       | 主配置：模型、状态栏、扩展路径等 |
| APPEND_SYSTEM.md | 追加到系统提示的自定义指令       |
| extensions/      | 所有已安装的 TypeScript 扩展     |
| skills/          | 自定义 agent 技能                |
| models.db        | 模型提供商和 API 端点            |
| agent.db         | Agent 持久化数据                 |
| last-changelog-version | 上次已读更新日志的版本号   |
| mcp.json         | MCP 服务器定义与启动参数         |
| skill-descriptions.db | 技能描述缓存数据库          |
| managed-skills/  | OMP 下载安装的托管技能目录       |

> `auth.json`（含凭证）不在导出范围内。
>
> `oh-my-pi-extends.json`（本扩展自身的 ADHD 式摘要开关）同样**不在导出范围内**。

## 项目结构

```
oh-my-pi-extends/
├── src/
│   ├── index.ts          # 扩展入口：注册命令与快捷键
│   ├── config-items.ts   # 10 个配置项目的定义（收集/写回/估大小）
│   ├── export-config.ts  # /export-config 逻辑
│   ├── import-config.ts  # /import-config 逻辑（校验 + 还原前备份 + 还原）
│   ├── benchmark.ts      # /benchmark-token-speed 逻辑（TTFT/TPS + 取消）
│   ├── adhd-summary.ts   # /adhd-summary 逻辑（最终回复后的 ADHD 式摘要）
│   ├── plugin-config.ts  # 扩展自身配置读写（oh-my-pi-extends.json）
│   ├── tar-utils.ts      # 纯 TypeScript tar.gz 实现（零外部依赖）
│   ├── common.ts         # 共享工具：agent 目录、时间戳、OMP 版本、文件收集
│   └── ui.ts             # 多选交互（checkbox）
├── test/                 # 单元测试（bun test）
├── docs/
│   ├── agents/           # 技能文档
│   └── adr/              # 架构决策记录
├── scripts/
│   ├── bump-version.ts   # post-commit 版本号自动更新脚本
│   └── refresh-index.ts  # post-commit 索引自动刷新脚本（5 分钟节流）
├── package.json          # 插件清单，omp.extensions → src/index.ts
├── bun.lock              # Bun lockfile
├── tsconfig.json         # TypeScript 配置
├── CONTEXT.md            # 领域词汇表
├── AGENTS.md             # Agent skills 配置
└── README.md             # 本文件
```

## 版本号自动更新

提交后由 `simple-git-hooks` 的 `post-commit` 钩子自动更新 `package.json` 版本号（按 Conventional Commits 类型）：

| 提交 | 版本号变更 |
| ---- | ---------- |
| `fix:` | patch+（`1.2.3` → `1.2.4`） |
| `feat:` | minor+（`1.2.3` → `1.3.0`） |
| 破坏性变更（`feat!:`, `fix!:`, 或正文含 `BREAKING CHANGE:`） | major+（`1.2.3` → `2.0.0`） |
| `docs:` / `chore:` / `refactor:` / `test:` 等或无法解析的消息 | 不更新 |

- 钩子在 `bun install`（触发 `prepare` 脚本）时自动安装。
- 版本号更新后**自动 `git add` 并 `git commit --amend` 并入刚产生的提交**，因此版本号随该提交一起入库，工作区保持干净。
- 仅对**本地未推送**的提交生效；amend 不会改写已推送的历史。
- 跳过本次钩子：`SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`。

## 索引自动刷新

同一个 `post-commit` 钩子在版本号更新之后调用 `scripts/refresh-index.ts`，刷新 GitNexus 与 CodeGraph 索引：

```
bun run scripts/bump-version.ts && bun run scripts/refresh-index.ts
```

- 刷新任务在**独立后台进程**中执行（Windows 用 `cmd /c start /b` 脱离父进程），提交本身不等待：闸门 1 秒内返回，实际刷新约 10-15 秒。
- **节流**：默认 5 分钟内最多启动一次刷新。窗口内再次提交不会立刻刷新，而是**预约一次窗口结束时的刷新**（同一时间窗口只有一个预约），保证连续提交之后索引仍然是最新的。
- 闸门每次只做三件事之一：立即启动 / 预约启动 / 跳过（已有刷新在跑、或已有预约）。
- 状态与日志存放在 git 目录内（不入库）：`.git/oh-my-pi-extends-index.json`、`.git/oh-my-pi-extends-index.log`。日志上限 1 MB，超出后重写。
- 环境变量：`INDEX_REFRESH_WINDOW_MS` 改节流窗口；`INDEX_REFRESH_DISABLE=1` 关闭该钩子。
- 刷新失败只写日志，**不会**让提交失败。

## 开发说明

本项目仅支持 **Bun** 作为包管理器和运行时。不要使用 npm/pnpm/node（被 ADR-0001 锁定，原因见 `docs/adr/0001-lock-bun-as-package-manager-and-runtime.md`）。

```bash
bun install        # 安装依赖
bun run check      # 类型检查 + lint + 格式检查（tsc + oxlint + oxfmt:check）
bun run lint       # oxlint --fix + oxfmt --write
bun test           # 运行单元测试
```

> 扩展由 OMP 运行时通过 `package.json` 的 `omp.extensions` 字段加载，无需手动执行 `src/index.ts`。
