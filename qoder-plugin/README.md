# 在 Qoder 中使用这套技能

这是 [mattpocock/skills](https://github.com/mattpocock/skills) 的 Qoder 移植版，由 [Konev37/skills](https://github.com/Konev37/skills) 的 `qoder-plugin` 分支维护。

上游只发布 Claude Code 插件。该分支额外产出一个符合 Qoder 插件规范的包 `qoder-plugin/`，技能内容与上游逐字一致，不做翻译、不改写正文。

同步源是上游的 **release tag**（`v<version>`），不是上游 `main`。只有上游正式发版时本插件才跟进，因此不会把上游未发布的改动带进来。本仓库不向上游推送任何代码，也不发起 PR。

- 插件名：`mattpocock-skills`（与上游 `.claude-plugin/plugin.json` 同名）
- 版本与技能清单：完全跟随上游 `.claude-plugin/plugin.json`，当前构建产物见 `qoder-plugin/.qoder-plugin/plugin.json`
- 许可证：MIT，版权归原作者 Matt Pocock 所有

## 安装

### 路线 A：导入 ZIP（推荐）

1. 打开本仓库的 [Releases](https://github.com/Konev37/skills/releases)，下载最新版本的 `mattpocock-skills-qoder-<version>.zip`。
2. 在 Qoder 的插件管理界面选择从本地 ZIP 安装，指向该文件。
3. 重启 Qoder，或在扩展视图中重新加载插件。

ZIP 根目录直接包含 `.qoder-plugin/plugin.json`，Qoder 的安装器会自行完成校验、放置、注册与启用。这条路线不需要你手工改任何配置文件。

### 路线 B：脚本注册（无图形界面，或想跟仓库同步）

```bash
git clone -b qoder-plugin https://github.com/Konev37/skills.git
cd skills
node scripts/update-local-qoder-plugin.mjs --dry-run   # 先看会改什么
node scripts/update-local-qoder-plugin.mjs
```

脚本自动解析配置目录（Qoder 是 `~/.qoder`，Qoder CN 是 `~/.qoder-cn`；设了 `QODER_CONFIG_DIR` 或 `QODERCN_CONFIG_DIR` 时以该值为准，两个目录都存在时用 `--config-dir` 指定），构建后写入三处，下文 `<CONFIG>` 指代解析结果，`<version>` 取清单里的 `version`：

```text
<CONFIG>/plugins/cache/local/mattpocock-skills/<version>/     插件内容
<CONFIG>/plugins/installed_plugins_v2.json                  plugins["mattpocock-skills@local"]
<CONFIG>/settings.json                                      enabledPlugins["mattpocock-skills@local"] = true
```

注册项形如，两个 JSON 都是合并写入，其余条目与 `mcpServers` 不动：

```json
"mattpocock-skills@local": [
  {
    "scope": "user",
    "installPath": "<CONFIG>/plugins/cache/local/mattpocock-skills/<version>",
    "version": "<version>"
  }
]
```

改完重启 Qoder。这条路线与路线 A 二选一，别同时装，否则技能会重复。

## 更新

分三段，每段各自独立。**`@local` 安装不会自我更新**，Action 只负责把上游变更推到 GitHub，本机和别人的 Qoder 都要各自取一次。

### 第一段：上游 -> 本仓库（自动）

Action 每天跑一次，只认上游 release tag。想立刻触发：仓库 **Actions** 页面 -> **Sync Upstream Qoder Plugin** -> **Run workflow**。默认分支已是 `qoder-plugin`，所以定时触发和该按钮都可用。

跑完后 `qoder-plugin/` 会是最新构建，版本号变化时还会多一个 `qoder-v<version>` Release 和 ZIP。

### 第二段：本仓库 -> 本机 Qoder（一条命令）

```bash
git pull
node scripts/update-local-qoder-plugin.mjs
```

脚本会重新构建、复制到 `<CONFIG>/plugins/cache/local/mattpocock-skills/<version>/`、合并更新 `installed_plugins_v2.json` 的 `installPath` 与 `version`、并确保 `enabledPlugins` 里为 `true`。其余插件条目和 `mcpServers` 原样保留，旧版本缓存目录不删除。完成后重启 Qoder。

先看不改：

```bash
node scripts/update-local-qoder-plugin.mjs --dry-run
```

配置目录自动从 `QODER_CONFIG_DIR` / `QODERCN_CONFIG_DIR` 或 `~/.qoder-cn`、`~/.qoder` 解析。两个都存在时用 `--config-dir <path>` 指定。

### 第三段：本仓库 -> 别人的 Qoder

让对方下载 [Releases](https://github.com/Konev37/skills/releases) 里的 `mattpocock-skills-qoder-<version>.zip`，在 Qoder 插件管理界面从本地 ZIP 导入，然后重启。更新就是下载新 ZIP 再导入一次。

对方也可以走第二段：clone 本仓库的 `qoder-plugin` 分支后跑同一个更新脚本。

## 与上游保持同步

`.github/workflows/sync-upstream-qoder.yml` 每天检查上游的 release tag。它只 fetch `refs/tags/v*`，**不 fetch 也不合并上游 `main`**。流程是：

1. 用 `git tag --list 'v*' --sort=-v:refname` 取版本号最大的 tag；
2. 该 tag 尚未并入 `qoder-plugin` 分支时，合并它；
3. 运行构建与校验脚本，重新生成 `qoder-plugin/`；
4. 提交并推送回 `qoder-plugin` 分支；
5. 插件版本号对应的 `qoder-v<version>` Release 不存在时，打 tag 并发布带 ZIP 的 Release。

它不向上游发起任何 PR 或推送，工作流里也有 `if: github.repository != 'mattpocock/skills'` 兜底。

**关于默认分支**：GitHub 规定 `schedule` 触发器只读取**默认分支**上的工作流文件，`workflow_dispatch` 的 **Run workflow** 按钮同样只在默认分支存在该文件时才出现。本 fork 的默认分支已设为 `qoder-plugin`，所以两者都可用。

如果你再次 fork 本仓库，记得同样把默认分支指到携带该工作流的分支，否则自动同步不会跑。替代做法是把 `.github/workflows/sync-upstream-qoder.yml` 单独复制一份到默认分支，工作流内部会显式 checkout `env.PLUGIN_BRANCH` 操作。

分支名与工作流里的 `env.PLUGIN_BRANCH` 一致，改名时同步改这一处即可。

本仓库对上游的改动只落在新增路径上（`QODER.md`、`qoder-plugin/`、`scripts/*-qoder-plugin.mjs`、`.github/workflows/sync-upstream-qoder.yml`），因此合并上游 tag 不会产生冲突。

## 构建时做了什么

| 项目 | 处理方式 |
| --- | --- |
| 技能目录 | 从 `skills/<bucket>/<name>/` 扁平化为 `skills/<name>/`，因为 Qoder 只扫描一层 |
| 技能范围 | 只取 `.claude-plugin/plugin.json` 的 `skills` 数组，即上游的 promoted 集合（`engineering/` 与 `productivity/`）。`misc/`、`in-progress/`、`deprecated/` 不打包 |
| `SKILL.md` 与同级参考文件 | 逐字节复制，保留英文 description、`disable-model-invocation`、`argument-hint`、`metadata` 等全部 frontmatter |
| 技能内的相对链接 | 扁平化后仍然有效，因为整个技能目录一起复制，且上游没有跨技能的 `../` 链接 |
| `agents/openai.yaml` | **有意省略**。这是 Codex 的元数据，Qoder 不读取；它携带的调用策略在 `SKILL.md` 的 `disable-model-invocation` 里已经有等价表达 |
| 命令、Subagent、Hook、MCP | **不提供**。上游仓库里没有任何命令目录或 MCP 声明，本移植不凭空编造。技能通过 Qoder 的 Skill 工具调用 |
| `README.md` | 由本文件复制而来 |
| `LICENSE` | 从上游复制 |

`qoder-plugin/` 是提交进仓库的构建产物。`node scripts/build-qoder-plugin.mjs --check` 会校验它与源技能是否一致，CI 每次同步都会跑，所以产物不会漂移。

### 技能的调用方式

上游以 `disable-model-invocation: true` 区分「只能由人触发」和「模型也能触发」两类技能，Qoder 会读取这个字段。本插件安装后实测：27 个技能中 16 个只出现在斜杠命令里，另外 11 个（`code-review`、`codebase-design`、`diagnosing-bugs`、`domain-modeling`、`grilling`、`pr`、`prototype`、`research`、`tdd`、`wizard`、`writing-for-agents`）可被模型自动触发。

所以 `grill-me`、`handoff`、`teach`、`implement`、`to-spec`、`to-tickets`、`triage`、`wayfinder`、`setup-matt-pocock-skills` 这类技能要你主动用斜杠命令调用，模型不会自己启动它们。这是上游的设计意图，移植版原样保留。

## 首次使用

安装后先跑一次 `/setup-matt-pocock-skills`，它会为你的项目配置 issue tracker、triage 标签词汇和领域文档布局。其他工程技能依赖这一步。

`/ask-matt` 是路由器，描述不清楚该用哪个技能时问它。

## 与 Qoder 市场版的冲突

Qoder 市场上存在一个第三方移植 `matt-pocock-skills`（注意拼写与本插件不同），内容停留在较早版本。两者同时启用会让每个技能在列表里出现两份，路由时容易选错。

请只保留一个。在 `<CONFIG>/settings.json` 里把市场版设为 `false`：

```json
"matt-pocock-skills@qoder-marketplace": false
```

## 本地开发

```bash
node scripts/build-qoder-plugin.mjs          # 重新生成 qoder-plugin/
node scripts/build-qoder-plugin.mjs --check  # 只校验，不写文件，漂移时退出码 1
node scripts/check-qoder-plugin.mjs          # 静态校验产物是否符合 Qoder 插件规范
node scripts/update-local-qoder-plugin.mjs   # 构建并安装/更新到本机 Qoder 配置目录
```

改动技能请改 `skills/` 下的源文件，不要直接改 `qoder-plugin/`，后者会被下一次构建覆盖。