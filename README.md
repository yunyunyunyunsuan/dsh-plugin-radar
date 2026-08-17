# dsh-plugin-radar（插件雷达）

DeepSeek Harness 插件：定时扫描 GitHub 上 `topic:dsh-plugin` 的插件仓库，在 Web 界面左下角推送按更新时间排序的卡片流，支持 README 关键词搜索与一键安装。

## 功能

- **定时扫描**：默认每 12 小时扫一次 GitHub `topic:dsh-plugin`（可配置），收录最近更新的 100 个仓库作为全量索引
- **推送窗口**：「最新」标签页默认只推近 7 天更新的插件（可切 3 天）；「全部」标签页浏览完整索引
- **卡片流**：左下角浮动面板，每个插件一张卡片：名称、星数、更新时间、README 摘要
- **关键词搜索**：对名称 + 简介 + README 全文做本地关键词匹配（如搜「视觉」可命中图像识别类插件）
- **一键安装**：点按钮即驱动本机 pnpm 完成安装并写入 `cordis.patch.yml`，npm 包优先，未发 npm 的走 `github:owner/repo`
- **NEW 标记**：48 小时内更新的插件高亮

## 安装

```sh
dsh plugin --profile web add dsh-plugin-radar
```

然后在 profile 的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: plugin-radar
      name: 'dsh-plugin-radar'
```

## 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `refreshIntervalHours` | `12` | 扫描间隔（小时） |
| `pushWindowDays` | `7` | 「最新」推送窗口（天），窗口外的进「全部」 |
| `maxRepos` | `100` | 每次扫描收录的仓库数 |
| `readmeMaxChars` | `6000` | 每个仓库缓存的 README 字符数（搜索语料） |
| `profile` | `web` | 一键安装写入的目标 profile |
| `pnpmBin` | `pnpm` | pnpm 路径（自动探测 nvm/homebrew，失败时用它兜底） |
| `githubToken` | `''` | GitHub Token（也可用环境变量 `GITHUB_TOKEN`，提高 API 限额） |

## 原理

- 主机端：标准 cordis 插件，`inject: ['webServer']`，注册 `/plugin-radar/api/list|refresh|install` 三个 HTTP 路由；扫描结果缓存在 `~/.dsh/plugin-radar-cache.json`
- 浏览器端：挂载到 `shell.overlay` 浮动层的 React 面板，纯 `fetch` 同源 API
- 安装：`pnpm add` 到 profile 目录后，向 `cordis.patch.yml` 追加 insert 行，刷新页面生效

## License

MIT
