# dsh-plugin-radar（插件雷达）

DeepSeek Harness 插件：定时扫描 GitHub 上 `topic:dsh-plugin` 的插件仓库，在 Web 界面左下角推送按更新时间排序的卡片流，点开卡片查看居中详情弹窗，支持 README 关键词搜索、一键安装，以及**基于你自己 DSH 模型额度**的翻译与 AI 中文摘要。

## 功能

- **开箱即见全量列表**：包内附种子数据（发布时全量仓库元数据 + `hasPkg` 探测结果），首次启动无需等扫描即可浏览 4700+ 插件，后台再增量更新
- **分层收录**：三维度（最近更新 / 最新创建 / 星数最高）分页合并扫描 + 按创建日分片做全量；仅对近 3 天更新的仓库深收 README 全文，作为信息流
- **可安装标记**：每个仓库探测有无 `package.json`（`hasPkg`），推荐页只推可一键安装的真 dsh 插件，信息流可按「可安装」筛选；非 JS 包（Python 等）拒绝安装
- **推送窗口**：「最近 3 天」信息流；「全部」浏览完整索引；均可按 新建仓库/更新仓库 切换
- **卡片流**：左下角可拖动胶囊 + 面板，卡片显示名称、星数、明确的创建/更新时间、README 摘要、NEW 标记（看过即消失）
- **居中详情弹窗**：点卡片打开——完整元信息、topics、简介（英文可一键「译成中文」）、AI 中文摘要（基于 README 全文）、README 节选（填满）
- **已安装管理**：列出已装插件，支持更新检测（npm 源）+ 一键更新、一键删除
- **AI 能力走使用者额度**：翻译与摘要由主机端调用 `ctx.llm`（你自己在 DSH 里配置的 provider/model），按需触发、结果本地缓存，插件自身零 API 成本
- **关键词搜索**：名称 + 简介 + README 全文本地匹配（如搜「视觉」可命中图像识别类插件）
- **一键安装**：npm 包优先，未发 npm 的走 `git+https`；自动 `pnpm add` 到 profile 并写入 `cordis.patch.yml`，刷新生效
- **安全提示**：面板与详情页均有「未经安全检测」小字声明

## 安装

已发布 npm（`dsh-plugin-radar@0.4.0`），直接：

```sh
dsh plugin --profile web add dsh-plugin-radar
```

或在 profile 目录手动 `pnpm add dsh-plugin-radar`，然后在 profile 的 `cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: plugin-radar
      name: 'dsh-plugin-radar'
```

## 配置项

| 字段 | 默认 | 说明 |
|---|---|---|
| `refreshIntervalHours` | `12` | 扫描间隔（小时，面板底部可改，0.5~720） |
| `pushWindowDays` | `3` | 「最近 3 天」信息流窗口（天） |
| `deepScanDays` | `3` | 深收 README 的时间窗口（天） |
| `maxRepos` | `6000` | 收录仓库总数上限 |
| `pagesPerSort` | `30` | 每个排序维度的分页页数（每页 100，受 API 剩余额度保护） |
| `pkgProbePerScan` | `60` | 每次扫描补探测 `hasPkg` 的老条目数 |
| `readmeMaxChars` | `6000` | 每仓库缓存的 README 字符数（搜索/摘要语料） |
| `provider` | `deepseek-official` | 翻译/摘要使用的 provider（你 DSH 已配置的） |
| `model` | `deepseek-v4-flash` | 翻译/摘要使用的模型 |
| `profile` | `web` | 一键安装写入的目标 profile |
| `pnpmBin` | `pnpm` | pnpm 路径（自动探测 nvm/homebrew，失败时用它兜底） |
| `githubToken` | `''` | GitHub Token；缺省自动尝试 `GITHUB_TOKEN` 环境变量与本机 git 凭据 |

## 原理

- 主机端：标准 cordis 插件，`inject: ['webServer', 'llm']`，注册 `/plugin-radar/api/list|refresh|install|uninstall|update|installed|translate|summarize|config` 等 HTTP 路由；运行时缓存落盘 `~/.dsh/plugin-radar-cache.json`
- 种子数据：包内 `lib/seed.json` 附发布时的全量元数据（不含 README 全文），首次启动无缓存即加载，开箱即见全量列表，随后增量更新
- 扫描机制：每次 = ①「最近更新」头部刷新（前 1000）+ ② 按创建日分片**增量**补新仓库（游标持久化 `scanCursor.lastCreatedDay`，撞限流停在当日下次续扫）；日常增量请求数恒定，与存量无关
- 浏览器端：挂载 `shell.overlay` 浮动层的 React 面板（纯 `fetch` 同源 API）
- AI 调用：`ctx.llm.stream()` 一次性问答（`BlockAssembler` 收束文本），消耗的是**你自己 DSH 配置的模型额度**，结果按原文/仓库持久化缓存

## License

MIT
