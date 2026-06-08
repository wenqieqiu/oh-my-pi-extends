# oh-my-pi-extends

oh-my-pi 扩展

## 安装

### 方式 1：本地 link（开发/单机用）

```bash
omp plugin link /path/to/oh-my-pi-extends
```

要求：插件目录必须在当前工作目录下。

### 方式 2：GitHub 安装（跨设备推荐）

将本项目推送到 GitHub 后：

```bash
omp plugin install github:你的用户名/oh-my-pi-extends
```

### 方式 3：设置中配置扩展路径

```yaml
# ~/.omp/agent/config.yml
extensions:
  - "C:/Users/xxx/oh-my-pi-extends"
```

或通过 CLI 临时加载：

```bash
omp -e /path/to/oh-my-pi-extends
```

### 方式 4：目录复制

将整个目录复制到目标机器，使用方式 1 或 3 加载。

## 工作原理

## 项目结构

```
oh-my-pi-extends/
├── package.json    # npm package manifest，omp.extensions 指向入口
├── index.ts        # 扩展源码
└── README.md       # 本文件
```
