# oh-my-pi-extends 领域词汇表

## 术语

### Bun

Bun 是此项目的 JavaScript/TypeScript 运行时和包管理器。OMP（Oh My Pi）运行在 Bun 之上，所有 OMP 扩展项目必须使用 Bun 作为运行时和包管理器。npm、pnpm、node、npx 不是本项目的开发工具，不得用于包管理或执行脚本。

- 包管理：`bun install`、`bun add`、`bun remove`
- 运行：`bun run <script>`、`bunx <package>`
- 类型检查：`bun run tsc`（通过本地 typescript 包）
