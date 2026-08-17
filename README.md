# dsh-plugin-radar（插件雷达）

DeepSeek Harness 插件：定时扫描 GitHub 上 `topic:dsh-plugin` 的插件仓库，在 Web 界面左下角推送按更新时间排序的卡片流，点开卡片查看居中详情弹窗，支持 README 关键词搜索、一键安装，以及**基于你自己 DSH 模型额度**的翻译与 AI 中文摘要。

## 功能

- **分层收录**：三维度（最近更新 / 最新创建 / 星数最高）分页合并扫描，全量浅收（名称/简介/星数）做检索底座；仅对近 3 天更新的仓库深收 README 全文，作为信息流
- **推送窗口**：「最新」标签页默认只推近 3 天（可切 7 天）；「全部」标签页浏览完整索引
- **卡片流**：左下角浮动面板，每张卡片显示名称、星数、明确标注的最近更新时间（`更新于 x 前`）、README 摘要、NEW 标记（48h 内）
- **居中详情弹窗**：点卡片打开——完整元信息、topics、简介（英文简介可一键「译成中文」）、AI 中文摘要（基于 README 全文）、README 节选
- **AI 能力走使用者额度**：翻译与摘要由主机端调用 `ctx.llm`（你自己在 DSH 里配置的 provider/model），按需触发、结果本地缓存，插件自身零 API 成本
- **关键词搜索**：名称 + 简介 + README 全文本地匹配（如搜「视觉」可命中图像识别类插件）
- **一键安装**：npm 包优先，未发 npm 的走 `github:owner/repo`；自动 `pnpm add` 到 profile 并写入 `cordis.patch.yml`，刷新生效
- **安全提示**：面板与详情页均有「未经安全检测」小字声明

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
| `pushWindowDays` | `3` | 「最新」推送窗口（天），窗口外的进「全部」 |
| `deepScanDays` | `3` | 深收 README 的时间窗口（天） |
| `maxRepos` | `300` | 收录仓库总数上限 |
| `pagesPerSort` | `3` | 每个排序维度的分页页数（每页 100，受 API 剩余额度保护） |
| `readmeMaxChars` | `6000` | 每仓库缓存的 README 字符数（搜索/摘要语料） |
| `provider` | `deepseek-official` | 翻译/摘要使用的 provider（你 DSH 已配置的） |
| `model` | `deepseek-v4-flash` | 翻译/摘要使用的模型 |
| `profile` | `web` | 一键安装写入的目标 profile |
| `pnpmBin` | `pnpm` | pnpm 路径（自动探测 nvm/homebrew，失败时用它兜底） |
| `githubToken` | `''` | GitHub Token；缺省自动尝试 `GITHUB_TOKEN` 环境变量与本机 git 凭据 |

## 原理

- 主机端：标准 cordis 插件，`inject: ['webServer', 'llm']`，注册 `/plugin-radar/api/list|refresh|install|translate|summarize` 五个 HTTP 路由；缓存落盘 `~/.dsh/plugin-radar-cache.json`
- 浏览器端：挂载 `shell.overlay` 浮动层的 React 面板（纯 `fetch` 同源 API）
- AI 调用：`ctx.llm.stream()` 一次性问答（`BlockAssembler` 收束文本），消耗的是**你自己 DSH 配置的模型额度**，结果按原文/仓库持久化缓存

## License

MIT
