# oh-my-pi-extends

OMP 配置一键导出/导入扩展。

提供两个斜杠命令，将 Oh My Pi 的配置（config.yml、extensions、skills、模型数据库等）打包为 `.tar.gz` 文件，并在另一台电脑上还原。

## 命令

| 命令 | 功能 |
|---|---|
| `/export-config` | 选择配置项目 → 导出为 `tar.gz` |
| `/import-config` | 选择备份文件 → 选择还原项目 → 自动备份旧配置 → 还原 |

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

## 使用流程

### 导出

1. 在 OMP 聊天输入 `/export-config`
2. 选择要包含的项目（config.yml、extensions/、skills/、models.db 等）
3. 确认保存路径（默认 `~/omp-config-export-时间戳.tar.gz`）
4. 等待打包完成

### 导入

1. 在目标机器 OMP 输入 `/import-config`
2. 输入备份文件路径
3. 选择要还原的项目
4. 现有配置会自动备份到 `~/.omp-agent-backup-时间戳.tar.gz`
5. 还原完成后重启 OMP

## 可导出的配置项目

| 项目 | 内容 |
|---|---|
| config.yml | 主配置：模型、状态栏、扩展路径等 |
| APPEND_SYSTEM.md | 追加到系统提示的自定义指令 |
| extensions/ | 所有已安装的 TypeScript 扩展 |
| skills/ | 自定义 agent 技能 |
| models.db | 模型提供商和 API 端点 |
| agent.db | Agent 持久化数据 |

## 项目结构

```
oh-my-pi-extends/
├── src/
│   ├── index.ts          # 扩展入口：/export-config、/import-config
│   ├── config-items.ts   # 6 个配置项目的定义
│   └── tar-utils.ts      # 纯 TypeScript tar.gz 实现（零外部依赖）
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

## 开发说明

本项目仅支持 **Bun** 作为包管理器和运行时。不要使用 npm/pnpm/node。

```bash
bun install           # 安装依赖
bun run tsc           # 类型检查
bun run src/index.ts  # 语法验证（由 OMP 运行时加载）
```