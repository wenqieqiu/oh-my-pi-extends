# 问题跟踪：本地 Markdown

本仓库的问题与 PRD 以仓库内 `.scratch/<feature>/` 下的 Markdown 文件形式保存，无外部跟踪系统。

## 约定

- **创建问题**：在 `.scratch/<feature>/` 下写一个 Markdown 文件，例如 `.scratch/export-config/fix-tar-order.md`。需要排序时用零填充数字作为文件名前缀（`.scratch/<feature>/0001-foo.md`）。
- **读取问题**：直接读取该 Markdown 文件。
- **列出问题**：在 `.scratch/` 下用 `glob` / `grep` 查找。
- **更新状态**：就地编辑文件——追加状态行、移动文件或重命名。

## 当技能说「发布到问题跟踪」时

在 `.scratch/<feature>/` 下创建一个 Markdown 文件。

## 当技能说「获取相关工单」时

读取给定路径下的 Markdown 文件。
