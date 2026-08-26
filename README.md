# oh-my-pi-extends

Oh My Pi（OMP）扩展集。当前提供**配置备份**与**模型速度基准测试**两大功能。

- **配置备份**：把本机 OMP 配置（config.yml、extensions、skills、模型数据库等）打包为 `.tar.gz` **备份文件**，可在另一台电脑**还原**；导入时先做**还原前备份**，并校验备份格式版本与 OMP 版本。
- **模型速度测试**：测量当前会话模型的 token 输出速度（TTFT + TPS），支持 Esc / Ctrl+Shift+E 中止。

## 命令

| 命令                       | 功能                                                               |
| -------------------------- | ------------------------------------------------------------------ |
| `/export-config`           | 选择配置项目 → 导出为 `tar.gz` 备份文件                            |
| `/import-config`           | 选择备份文件 → 校验 → 选择还原项目 → 还原前备份 → 还原             |
| `/benchmark-token-speed`   | 测试当前模型 token 输出速度（三个真实场景，各测一遍取均值）         |
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
2. 选择要包含的项目（config.yml、APPEND_SYSTEM.md、extensions/、skills/、models.db、agent.db），可全选或逐个勾选
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

## 可导出的配置项目

| 项目             | 内容                             |
| ---------------- | -------------------------------- |
| config.yml       | 主配置：模型、状态栏、扩展路径等 |
| APPEND_SYSTEM.md | 追加到系统提示的自定义指令       |
| extensions/      | 所有已安装的 TypeScript 扩展     |
| skills/          | 自定义 agent 技能                |
| models.db        | 模型提供商和 API 端点            |
| agent.db         | Agent 持久化数据                 |

## 项目结构

```
oh-my-pi-extends/
├── src/
│   ├── index.ts          # 扩展入口：注册命令与快捷键
│   ├── config-items.ts   # 6 个配置项目的定义（收集/写回/估大小）
│   ├── export-config.ts  # /export-config 逻辑
│   ├── import-config.ts  # /import-config 逻辑（校验 + 还原前备份 + 还原）
│   ├── benchmark.ts      # /benchmark-token-speed 逻辑（TTFT/TPS + 取消）
│   ├── tar-utils.ts      # 纯 TypeScript tar.gz 实现（零外部依赖）
│   ├── common.ts         # 共享工具：agent 目录、时间戳、OMP 版本、文件收集
│   └── ui.ts             # 多选交互（checkbox）
├── test/                 # 单元测试（bun test）
├── docs/
│   ├── agents/           # 技能文档
│   └── adr/              # 架构决策记录
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
- 更新**落到工作区**（未提交）——post-commit 无法修改刚产生的提交，版本号变更随下一次提交入库。
- 跳过本次钩子：`SKIP_SIMPLE_GIT_HOOKS=1 git commit ...`。

## 开发说明

本项目仅支持 **Bun** 作为包管理器和运行时。不要使用 npm/pnpm/node（被 ADR-0001 锁定，原因见 `docs/adr/0001-lock-bun-as-package-manager-and-runtime.md`）。

```bash
bun install        # 安装依赖
bun run check      # 类型检查 + lint + 格式检查（tsc + oxlint + oxfmt:check）
bun run lint       # oxlint --fix + oxfmt --write
bun test           # 运行单元测试
```

> 扩展由 OMP 运行时通过 `package.json` 的 `omp.extensions` 字段加载，无需手动执行 `src/index.ts`。
