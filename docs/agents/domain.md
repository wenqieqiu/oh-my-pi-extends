# 领域文档

工程技能在探索代码库时应如何消费本仓库的领域文档。

## 探索前先阅读

- 仓库根目录的 **`CONTEXT.md`**，或
- 若存在 **`CONTEXT-MAP.md`** 则阅读它——它指向每个上下文各一个 `CONTEXT.md`。阅读与主题相关的每一个。
- **`docs/adr/`**——阅读与你即将工作的区域相关的 ADR。在多上下文仓库中，也检查 `src/<context>/docs/adr/` 中上下文范围内的决策。

若这些文件不存在，**静默继续**。不要标记其缺失，也不要主动建议创建。生产者技能（`/grill-with-docs`）会在术语或决策真正解决时惰性创建它们。

## 文件结构

单上下文仓库（大多数仓库）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文特定决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表的词汇

当你输出的内容命名某个领域概念（问题标题、重构提案、假设、测试名）时，使用 `CONTEXT.md` 中定义的术语。不要漂移到术语表明确回避的同义词。

若你需要的概念尚不在术语表中，那是一个信号——要么你在发明项目未使用的语言（重新考虑），要么存在真实缺口（记下来交给 `/grill-with-docs`）。

## 标记 ADR 冲突

若你的输出与现有 ADR 矛盾，显式提出，而非静默覆盖：

> _与 ADR-0007（event-sourced orders）矛盾——但值得重新讨论，因为…_
