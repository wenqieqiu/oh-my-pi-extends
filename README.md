# omp-token-speed-display

oh-my-pi 扩展：在 TUI 编辑器上方实时显示 AI token 生成速度。

当 AI 正在输出时，在编辑器（输入框）上方显示实时速度（如 `34.2tok/s`）；输出完成后，更新为本次生成的平均速度，直到下次 AI 生成时自动清除。

## 安装

### 方式 1：本地 link（开发/单机用）

```bash
omp plugin link /path/to/omp-token-speed-display
```

要求：插件目录必须在当前工作目录下。

### 方式 2：GitHub 安装（跨设备推荐）

将本项目推送到 GitHub 后：

```bash
omp plugin install github:你的用户名/omp-token-speed-display
```

### 方式 3：设置中配置扩展路径

```yaml
# ~/.omp/agent/config.yml
extensions:
  - "C:/Users/xxx/omp-token-speed-display"
```

或通过 CLI 临时加载：

```bash
omp -e /path/to/omp-token-speed-display
```

### 方式 4：目录复制

将整个目录复制到目标机器，使用方式 1 或 3 加载。

## 工作原理

| 事件 | 行为 |
|---|---|
| `message_start` (assistant) | 记录开始时间，清除旧速度 |
| `message_update` | 如有 `usage.output` 数据，实时计算并显示速度 |
| `message_end` (assistant) | 用 `msg.duration` 计算最终平均速度 |

速度 = `output_tokens × 1000 / elapsed(ms)`，格式 `X.Xtok/s`。

速度显示在编辑器上方（输入框与聊天区域之间的 widget 区），每次 assistant 消息结束后更新，下次开始时清除。

> **注意**：`message_update` 期间是否显示实时速度取决于 provider 是否在流式过程中返回 `usage.output` 数据。多数 provider 只在消息结束时才提供用量，因此实时速度可能仅在最后一条 `message_update` 事件（toolcall_end/text_end）时出现。

## 项目结构

```
omp-token-speed-display/
├── package.json    # npm package manifest，omp.extensions 指向入口
├── index.ts        # 扩展源码
└── README.md       # 本文件
```
