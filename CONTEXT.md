# oh-my-pi-extends 领域词汇表

## 术语

### Bun

Bun 是此项目的 JavaScript/TypeScript 运行时和包管理器。OMP（Oh My Pi）运行在 Bun 之上，所有 OMP 扩展项目必须使用 Bun 作为运行时和包管理器。npm、pnpm、node、npx 不是本项目的开发工具，不得用于包管理或执行脚本。

- 包管理：`bun install`、`bun add`、`bun remove`
- 运行：`bun run <script>`、`bunx <package>`
- 类型检查：`bun run tsc`（通过本地 typescript 包）

### 模型速度测试 (Benchmark)

模型速度测试功能通过 `/benchmark-token-speed` 命令触发，使用当前会话模型进行 token 输出速度测试。测试指标包括 TTFT（首 token 延迟）和 TPS（每秒输出 token 数），使用三种真实场景提示词各测一遍取均值。测试结果通过 `sendMessage` 写入会话历史（`benchmark_result`）。取消与超时的语义见下。

### 取消 (Cancellation)

用户主动终止基准测试。通过 Esc 键或 Ctrl+Shift+E 快捷键触发（两路输入最终都调用 `cancelBenchmark()`）。取消是**中止整个基准测试**：当前测量立即中断，后续场景不再执行，不产出报告。与「超时」不同，取消不是一次失败的测量，而是终结整个测试的独立事件。取消由 `BenchmarkCancelledError` 从测量链路向上传播标记。

- 触发方式：Esc 键、Ctrl+Shift+E 快捷键
- 效果：中断当前测量，终止后续场景，无报告输出

### 超时 (Timeout)

单个测量请求在 300 秒（`timeoutMs`）内未完成时触发。超时是**失败的单次测量**：以带错误（`⏱ 超时`）的 `BenchmarkRun` 记录，计入该场景但不计入有效均值（`validRuns`），基准测试**继续执行**其余场景。区别于「取消」：超时是单次失败，取消是整个测试的终止。

### 测量 vs 测试

- **测量 (Run)**：一次具体的模型请求，产出一条 `BenchmarkRun`（TTFT、TPS、tokens、时长），可能因超时等失败。
- **测试 (Benchmark)**：整个基准测试执行，包含三个场景；可能因「取消」而中止。

### 配置备份 (Config Backup)

OMP 配置的导出/导入功能（`/export-config` 与 `/import-config`）统称为「配置备份」。用户可以把本机的 OMP 配置打包为 `.tar.gz` 备份文件，并在另一台电脑上还原。核心概念如下：

- **配置文件项 (Config Item)**：可被备份的最小单元，如配置文件、扩展、技能、模型数据库。每个配置项负责收集与写回自己的文件。
- **备份文件 (Backup File)**：导出的 `.tar.gz` 归档。包含被选配置项的文件与一个 `manifest.json`（记录格式版本、导出的 OMP 版本、所含配置项）。
- **导出 (Export)**：把选中的配置项收集并打包成备份文件。
- **导入 (Import)**：读取备份文件并读取其清单。
- **还原 (Restore)**：把备份文件中的配置项写回本机。
- **还原前备份 (Pre-restore Backup)**：还原前对现有配置做的一次安全备份，防止还原失败导致配置丢失。与「备份文件」不同，还原前备份是导入流程内部的动作，产出 `.omp-agent-backup-*.tar.gz`。

#### 术语注意

代码 UI 与命令名对同一概念混用了「备份」「导出」「导入」三套词：命令名与导出侧用「导出/导入」，导入侧用「备份/还原」，还原前动作叫「备份现有配置」。领域内 canonical 词为：**导出 (Export)**、**导入 (Import)**、**还原 (Restore)**、**备份文件 (Backup File)**、**还原前备份 (Pre-restore Backup)**。
