# dsh-plugin-radar（插件雷达）

[![npm version](https://img.shields.io/npm/v/dsh-plugin-radar.svg)](https://www.npmjs.com/package/dsh-plugin-radar)
[![npm downloads](https://img.shields.io/npm/dm/dsh-plugin-radar.svg)](https://www.npmjs.com/package/dsh-plugin-radar)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

DeepSeek Harness（DSH）插件市场雷达：**开箱即见** GitHub 上全部 `topic:dsh-plugin` 插件（4700+），定时增量扫描新插件，卡片流浏览 + README 关键词搜索 + 一键安装/更新/卸载，翻译与 AI 摘要走**你自己 DSH 配置的模型额度**，插件自身零 API 成本。

## 界面一览

左下角「🧩 插件雷达」胶囊（可拖动到任意位置，面板与胶囊绑定、相对位置锁死，面板四边可拖拽调大小）：

| 页签 | 内容 |
|---|---|
| **最近 3 天** | 信息流：仅近 3 天的仓库，可切「新建仓库 / 更新仓库」两种视角 |
| **全部** | 完整索引（4700+），支持星数范围筛选（★ 最低–最高）与排序（按时间 / ★ 高→低） |
| **已安装插件 · N** | 已装插件管理：更新检测（npm 源，有新版显示「↑ 更新 x.x.x」）、一键删除 |
| **推荐插件** | 按主题精选（界面美化/换肤、IDE 化界面、视觉方案、桌面/启动器、记忆/知识库），只推**确认可安装的真 dsh 插件** |

通用能力：
- **搜索**：名称 + 简介 + README 全文关键词匹配（搜「视觉」可命中图像识别类插件），各页签通用
- **可安装筛选**：一键开关，只看有 `package.json`、能真正装上的 JS 插件
- **NEW 徽标**：近 48h 且**你还没点开看过**的仓库（看过即消失，持久化）
- **胶囊角标**：距你上次打开以来有新建/更新的仓库数，打开即清零（持久化，刷新不回弹）
- **居中详情弹窗**（4:3 大屏占比）：完整元信息、topics、英文简介一键「译成中文」、AI 中文摘要（基于 README 全文）、README 节选填满下方
- **扫描间隔自定义**：面板底部输入框，0.5~720 小时任意改，即时生效

## 安装

已发布 npm：

```sh
dsh plugin --profile web add dsh-plugin-radar
```

或在 profile 目录手动安装，然后启用：

```sh
cd ~/.dsh/profiles/web
pnpm add dsh-plugin-radar
```

```yaml
# ~/.dsh/profiles/web/cordis.patch.yml
- insert:
    - id: plugin-radar
      name: 'dsh-plugin-radar'
      config:
        refreshIntervalHours: 12   # 可选：扫描间隔
```

刷新页面，左下角出现「🧩 插件雷达」即安装成功。

> 装上即见全量列表（包内附种子数据），无需等首次扫描；后台自动增量更新。

## 功能与机制

### 开箱即见（种子数据）
包内 `lib/seed.json` 附发布时的全量仓库元数据 + `hasPkg` 探测结果（不含 README 全文，体积可控）。首次启动无本地缓存即加载种子，后台再增量补全。

### 扫描机制（增量，不随存量变慢）
每次扫描 = ①「最近更新」头部刷新（前 1000，刷新已收录仓库的星数/简介/时间）+ ② 按创建日分片**增量**补新仓库：
- GitHub Search API 只回前 1000 条，按 `created:YYYY-MM-DD` 逐日分片可绕过限制做到全量
- 游标持久化（`scanCursor.lastCreatedDay`），每次只从上次停下的后一天续扫；撞限流停在当日下次接着来
- **日常增量请求数恒定**（~10-15 次，5s 节流），与存量 4000 还是 40000 无关；首次冷启动补历史约 4-5 分钟，一次性

### 一键安装（含安全防护）
- npm 包优先（自动解析仓库真实包名），未发 npm 的走 `git+https`；`pnpm add` 后自动写入 `cordis.patch.yml`，刷新生效
- **非 JS 包（Python 等，无 `package.json`）拒绝安装**——这类包装上会导致 DSH 启动失败
- git 源安装后自动校正 `package.json` 依赖名，保证与 `cordis.patch.yml` 一致

### AI 能力走使用者额度
翻译与摘要由主机端调用 `ctx.llm`（你 DSH 里配置的 provider/model，默认 `deepseek-official/deepseek-v4-flash`），按需触发、结果本地持久化缓存。插件本身不消耗任何 API 额度。

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

- **主机端**：标准 cordis 插件，`inject: ['webServer', 'llm']`，注册 `/plugin-radar/api/list|refresh|install|uninstall|update|installed|translate|summarize|config` 等 HTTP 路由；运行时缓存落盘 `~/.dsh/plugin-radar-cache.json`
- **浏览器端**：挂载 `shell.overlay` 浮动层的 React 面板（纯 `fetch` 同源 API，无构建依赖）
- **AI 调用**：`ctx.llm.stream()` 一次性问答（`BlockAssembler` 收束文本）

## 安全声明

收录内容来自 GitHub 公开数据，**未经安全检测**，本插件不对第三方插件的安全性负责，安装前请自行甄别。

## 更新日志

- **0.4.0** — 包内种子数据（4756 仓库 + hasPkg 全探测），开箱即见；推荐页只推可安装的真 dsh 插件；「可安装」筛选；非 JS 包拒绝安装；已安装插件更新检测 + 一键更新；git 源安装包名校正
- **0.3.0** — 全量收录（按创建日分片 + 游标增量续扫）；虚拟滚动（4700+ 卡片流畅）；胶囊可拖动、面板四边调大小；角标改为距上次打开以来的更新数（持久化）；星数范围筛选与排序
- **0.2.0** — 居中详情弹窗（4:3）；按需翻译 / AI 摘要（走使用者 DSH 模型额度）；三维度分页扫描；「更新于 X 前」时间明示；安全免责小字
- **0.1.0** — 首版：定时扫描 + 卡片流 + README 关键词搜索 + 一键安装

## License

MIT
