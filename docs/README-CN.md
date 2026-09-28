[한국어](../README.md) | [English](README-EN.md) | **简体中文**

# Project Template

一套配置，让 Claude Code（以及 Codex）在多人、长期的项目中遵循同一工作流程。它把技能控制在少量、
并按阶段使用，从而减少 token 浪费和跑偏的结果。

- **用户范围**（每台电脑一次）：插件、技能策略、技能集管理器，以及在升级导致策略被还原时先询问再恢复的钩子。
- **项目范围**（每个项目）：工作流程文档、项目技能、状态显示与同步钩子、默认权限。

环境要求：Node.js 18+、Python 3.9+、git、Claude Code CLI（`claude`）。

## 快速开始

```bash
git clone <本仓库> Project_Template
cd Project_Template

# 1) 每台电脑一次。团队成员各自执行。
node setup.mjs user

# 2) 每个项目。不覆盖已有文件，settings.json 会合并。
node setup.mjs project ../my-project              # 默认
node setup.mjs project ../my-app --expo --frontend  # Expo 应用 + UI
node setup.mjs project ../my-svc --gitlab           # 包含 GitLab CI 技能

# 3) 检查
node setup.mjs check

# 4)（可选）按领域安装技能集
node setup.mjs skills list
node setup.mjs skills add documents
```

安装后重新打开 Claude Code。在项目中填写 `AGENTS.md` 里的 `<...>` 占位符和 `docs/ROADMAP.md`，然后提交。

## 会安装什么

### `node setup.mjs user`

| 项目 | 位置 |
| --- | --- |
| Superpowers、Codex 插件（用户范围） | `claude plugin install` |
| 技能策略脚本和策略文件 | `~/.claude/skill-policy/` |
| 技能集管理器和目录（`skill-sets.mjs`、`skill-sets.json`） | `~/.claude/skill-policy/` |
| 技能统计与仪表盘（`skill-stats.mjs`、`skill-agents.mjs`、`skill-inventory.mjs`、`skill-dashboard.html`、`skill-meta.json`） | `~/.claude/skill-policy/` |
| `skill-sets` 技能：可以直接用自然语言让 Claude 安装或开关技能集 | `~/.claude/skills/skill-sets/` |
| `skillOverrides`（把策略中列出的技能设为仅手动或关闭） | `~/.claude/settings.json` |
| 会话开始时的策略检查钩子 | `~/.claude/settings.json` |

会移除 Superpowers 的 `using-superpowers` 引导（每次会话都完整注入）。其余 Superpowers 技能仍会根据描述自动触发。

选项 `--local-project <dir>`：把个人专用技能（`policy.json` 中的 `localOnlySkills`）只放在该项目中而不是全局，
设为仅手动，并通过 `.git/info/exclude` 排除在团队提交之外。可重复使用。

### `node setup.mjs project <dir>`

| 项目 | 说明 |
| --- | --- |
| `docs/WORKFLOW.md` | 各阶段的技能顺序、来源、自动/手动区分 |
| `AGENTS.md` = `CLAUDE.md` | 代理通用指令（改其中一个，钩子会同步另一个） |
| `CONTEXT.md`、`docs/adr/`、`docs/ROADMAP.md`、`docs/plans/{backlog,active,done}/` | 术语、决策、工作状态 |
| `.claude/skills/` | `plan-board` + mattpocock/skills 中的 8 个技能（`--gitlab` 时加上 `gitlab-ci-skill`） |
| `.claude/hooks/session_status.py` | 会话开始时注入进行中与下一步的工作 |
| `.claude/hooks/post_edit.py` | 复制 `.claude/skills` → `.agents/skills`（供 Codex 使用），同步 AGENTS/CLAUDE |
| `.claude/settings.json` | 上述钩子，以及禁止读取 `.env`、密钥文件等默认权限 |

选项：`--expo`（expo 插件）、`--frontend`（frontend-design 插件）、`--gitlab`、`--force`（覆盖已有文件）。

## 技能策略如何作用于已有技能

一句话：**策略从不安装技能。只有当 `policy.json` 中列出名字的技能存在于这台电脑上时，策略才改变该技能的行为。**
未列出的技能不受影响。

策略以 `"技能名": "状态"` 的形式写入 `~/.claude/settings.json` 的 `skillOverrides`。Claude Code 会把它应用到
**同名的任何技能**，不论其位置（`~/.claude/skills/` 或项目的 `.claude/skills/`）。插件技能
（如 `superpowers:brainstorming` 这种 `插件:技能` 名称）不受影响。

| 策略列表 | 设置值 | 效果 |
| --- | --- | --- |
| `manualSkills` | `user-invocable-only` | Claude 不会自行调用，只能通过 `/名称` 运行。其描述也不再进入上下文，节省 token |
| `offSkills` | `off` | 完全隐藏。若被重新安装到 `~/.claude/skills/`，会删除该文件夹（会话开始时先询问） |
| `localOnlySkills` | 移动文件夹 + `disable-model-invocation` | 从全局移除，只保留在指定项目中 |
| （未列出） | 无 | 保持原样，自动调用 |

### 示例

默认 `policy.json` 的 `manualSkills` 中列有 gstack 的技能名（`review`、`qa`、`ship` …）。

1. **没有安装 gstack 的成员。** `settings.json` 里只会多一行 `"review": "user-invocable-only"`。
   因为不存在名为 `review` 的技能，所以什么也不会发生。“不强制安装，存在时才应用策略”就是这个意思。
2. **安装了 gstack 的人。** 一旦出现 `~/.claude/skills/review/`，上述设置立即生效。即使说“帮我 review 一下”，
   Claude 也不会自动调用 gstack 的 `review`，必须输入 `/review`。
   如果之后 gstack 升级清除了该设置，下次会话开始时 Claude 会询问“要恢复吗？”。
3. **自己写的个人技能 `~/.claude/skills/my-notes/`。** 未列出，所以没有变化，仍会自动调用。
   想改为仅手动，把 `"my-notes"` 加入 `manualSkills` 后执行 `--apply`。
4. **项目技能 `.claude/skills/grill-me/`**（本模板添加）。未列出，所以没有变化。
   它本身的 `SKILL.md` 里就有 `disable-model-invocation: true`，本来就是仅手动。
5. **名称冲突的项目技能。** 如果团队仓库中有 `.claude/skills/review/`，你电脑上的策略也会作用于它，
   使它**只对你**变为仅 `/review`。其他成员不受影响。若不希望这样，从 `manualSkills` 中删掉 `review`，
   或给项目技能改名。（如果 `~/.claude/skills/` 中也有同名技能，个人技能优先，项目技能被遮蔽。）
6. **`offSkills` 中的 `autoplan`。** 项目中的同名技能只会被隐藏，文件保留。
   `~/.claude/skills/autoplan/` 每次重新出现都会被删除。
7. **`localOnlySkills` 中的 `browseros-neo`。** 执行 `node setup.mjs user --local-project ../blog` 后，
   会把 `~/.claude/skills/browseros-neo/` 移到 `../blog/.claude/skills/`，设为仅手动，并加入
   `../blog/.git/info/exclude`，避免混入团队提交。其他项目看不到它。

查看本机所有技能的当前状态：`node setup.mjs skills status`。

### 修改策略

编辑 `~/.claude/skill-policy/policy.json` 后：

```bash
node ~/.claude/skill-policy/skill-policy.mjs --apply   # 应用
node setup.mjs check                                   # 只显示不一致的地方
```

| 键 | 含义 |
| --- | --- |
| `offSkills` | 完全关闭（`skillOverrides: off`，即使重新安装到 `~/.claude/skills` 也会删除） |
| `manualSkills` | 仅手动（只能通过 `/名称` 调用） |
| `localOnlySkills`、`localSkillProjects` | 个人技能只放在指定项目中 |
| `stripSuperpowersBootstrap` | 去掉每次会话注入的 using-superpowers |
| `userPlugins` | 用户范围内要启用或禁用的插件 |
| `projectPluginRemovals` | 要从特定项目设置中移除的插件（`{"<settings.json 路径>": ["id"]}`） |

当 gstack 升级、插件更新、`npx skills` 更新或 BrowserOS 还原了设置时，钩子会在下次会话开始时发现，
Claude 会先询问是否恢复，不会自动修改。

## 技能集：按领域选择安装

从 [awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills) 中挑选实用的技能，
按领域分组。列表在 `kit/user/skill-sets.json`，修改后执行 `node setup.mjs user` 生效。

| 技能集 | 技能 |
| --- | --- |
| `documents` | docx、pdf、pptx、xlsx、doc-coauthoring |
| `frontend` | frontend-design、web-artifacts-builder、webapp-testing、playwright-skill |
| `dev-tools` | mcp-builder、skill-creator、changelog-generator |
| `data` | csv-data-summarizer、d3-viz、postgres |
| `research-writing` | content-research-writer、article-extractor、youtube-transcript、meeting-insights-analyzer |
| `business` | brand-guidelines、internal-comms、competitive-ads-extractor、domain-name-brainstormer、lead-research-assistant |
| `creative` | canvas-design、algorithmic-art、slack-gif-creator、theme-factory、image-enhancer |
| `productivity` | file-organizer、invoice-organizer、tailored-resume-generator、raffle-winner-picker |

```bash
node setup.mjs skills list                        # 技能集与安装状态
node setup.mjs skills add documents data          # 安装技能集 → ~/.claude/skills/（所有项目）
node setup.mjs skills add pdf                     # 只装一个技能
node setup.mjs skills add frontend --project .    # 只装到本项目（.claude/skills/，与团队共享）
node setup.mjs skills add documents --force       # 更新到最新版本
node setup.mjs skills remove data                 # 卸载（只删除本工具安装的技能）
```

- 源仓库以浅克隆方式缓存在 `~/.claude/skill-policy/cache/`，只复制需要的文件夹。
- 已存在同名文件夹时会跳过。要覆盖请加 `--force`。
- 第三方技能可以执行脚本。使用前请先阅读其 `SKILL.md`。
- `documents` 和 `skill-creator` 与 `anthropic-skills` 插件功能重复。两者同时开启时描述会被列出两次，只会多耗 token。保留其一即可。

## 开关技能与比较 token

开关只修改 `skillOverrides`，文件保留。可以传入技能集名、技能名、`all`（本工具安装的全部）以及
`plugin:<名称>`（整个插件）。

```bash
node setup.mjs skills off documents        # 关闭技能集
node setup.mjs skills off review qa        # 按名称关闭任意技能（gstack 技能也可以）
node setup.mjs skills off all              # 关闭所有已安装的技能集
node setup.mjs skills off plugin:superpowers
node setup.mjs skills on all               # 重新开启（策略中的 manual/off 保持不变）
node setup.mjs skills status               # 各技能状态与预估 token
```

用 `off` 关闭的技能会记录在 `~/.claude/skill-policy/state.json` 中，因此会话开始时的检查不会把它当作
“与策略不一致”而改回去。`on` 会恢复为策略值（若在 `manualSkills` 中则为仅手动）。

### 比较步骤（例：`documents` 技能集是否值得）

1. `node setup.mjs skills status` → 记下技能列表每次请求消耗的预估 token。先在 `node setup.mjs dashboard`
   中看看该技能集里的技能实际被调用的频率。
2. 在新会话中执行同一任务（例如“把这个 PDF 里的表格整理成 xlsx”），记录 `/context` 的 Skills 行和 `/cost`，并保存结果。
3. `node setup.mjs skills off documents` → 打开新会话，重复同一任务。
4. 并排比较 token、费用和结果。不划算的技能集就 `remove`。

设置在会话开始时读取，所以比较总要在新会话中进行。`status` 的数字是估算值（4 个 ASCII 字符 = 1 token，
1 个中日韩字符 = 1 token），不包含插件技能。包括插件在内的全部技能状态和使用频率，请看下面的仪表盘。

### 直接让 Claude 做

`setup.mjs user` 安装了 `skill-sets` 技能，所以也可以直接这样说：

- “安装文档类技能集” → `add documents`
- “只给这个项目加上前端技能集” → `add frontend --project .`
- “把装的技能都关掉，看看省了多少 token” → `off all` 然后 `status`
- “暂时关掉 superpowers 插件” → `off plugin:superpowers`

## 技能仪表盘：按智能体查看状态、使用频率、token

```bash
node setup.mjs dashboard              # http://localhost:4178（换端口：--port 5000）
node setup.mjs stats                  # 不开浏览器，只输出各智能体摘要（收集结果同样会保存）
node setup.mjs stats --exact          # 用 count_tokens API 精确计算 Claude Code 技能 token（需要 API 密钥，见下文）
node ~/.claude/skill-policy/skill-stats.mjs serve   # 不需要本仓库，用已安装的副本
```

通过顶部菜单在两个页面间切换，并在右上角选择语言（한국어、English、简体中文）。所选语言和主题会记在浏览器里。

- **概览**：在顶部选择编码智能体（全部、Claude Code、Codex、Gemini CLI、GitHub Copilot CLI）。显示汇总数字、
  按智能体对比（每次请求携带的技能列表、30 天技能调用、请求数与输入 token、技能列表占输入的比例、重复登记）、
  各智能体的技能列表条形、最近 30 天调用或 token 用量（按智能体堆叠）、最常用技能，以及按分类、按来源或完整
  列表展示的所有技能。点击对比表中的某行也会只看该智能体。
- **使用说明与概念**：用图表说明技能的调用流程、消耗 token 的两种方式、调用方式、技能所在位置与优先级、数字从何
  而来、各编码智能体的收集方式、精确计算时 API 密钥放在哪里，并附有术语表和清理方法。概览上的每个 `?` 按钮都可
  直接跳到对应说明。

- **常驻 token**：自动技能的名称和描述每次请求都会进入上下文，不论是否使用该技能。仅 `/名称` 或关闭的技能为 0。
  每个智能体各自发送自己的列表。
- **调用时 token**：技能被调用时，其 SKILL.md 正文进入对话。
- **调用方式**：自动、仅 `/名称`、关闭、被遮蔽（同名全局技能优先）、插件关闭、未安装（只存在于记录中）。
- **来源**：技能从哪里来（gstack、superpowers 插件、mattpocock/skills、技能集仓库等）以及安装位置（智能体；全局、
  项目、插件或内置）。来源链接会打开原始仓库。
- **分类**：规划·设计、实现、调试、评审·安全、测试、发布·Git、设计、文档、数据等，根据名称和描述中的关键词判定。
- **最近 30 天调用**：模型自行调用的次数和用户直接调用（`/名称`、`$名称`）的次数。展开一行可看到完整描述、
  各项目次数、30 天图表以及单次调用的实测值。
- **待清理**：最近 30 天一次都没被调用的自动技能。它们的描述仍在每次请求中消耗 token，可以考虑改为仅 `/名称`
  或关闭。重复登记的副本只要有另一份被用过，就不算待清理。
- **重复登记**：同名技能在列表中出现不止一次。多见于 Codex：同一技能位于两个文件夹，或同一插件从两个市场安装。
  对比表会显示去掉多余副本能省下多少 token。

若来源或分类不对，在 `~/.claude/skill-policy/skill-meta.local.json` 中修正。格式与
`kit/user/skill-meta.json` 相同，且优先生效。

```json
{ "origins": { "my-notes": "https://github.com/me/notes-skill" }, "categories": { "my-notes": "research" } }
```

### 各编码智能体的收集方式

无需额外开启。收集器会读取本机上找到的所有智能体的记录，只要用过某个智能体，下次收集时就会出现在概览中。

| 智能体 | 对话记录 | 计为调用 | 每次请求的 token |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Skill 工具调用；输入 `/名称` 后注入的 SKILL.md 正文 | 根据设置（`skillOverrides`）和 SKILL.md 计算 |
| Codex | `$CODEX_HOME/sessions/**/*.jsonl`、`archived_sessions`（默认 `~/.codex`） | 用 shell 读取 SKILL.md、注入的 `<skill>`、消息中的 `$名称`（每轮只计一次） | 上次会话实际发送的 `<skills_instructions>` 列表 |
| Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json` | `activate_skill` 工具、用 `read_file` 读取 SKILL.md | 根据 `~/.gemini/skills`、`<项目>/.gemini/skills` 估算 |
| GitHub Copilot CLI（实验性） | `~/.copilot/session-state/**/*.jsonl` | 名为 `skill` 的工具调用、读取 SKILL.md | 根据 `~/.copilot/skills`、`<项目>/.github/skills` 估算 |

token 用量读取自各记录的用量字段（Claude Code `usage`、Codex `token_count`、Gemini `tokens`）。输入包含从缓存
读取的 token，因此与计费不同。Codex 派生的子智能体会重新记录父对话，所以同一轮只计一次；自动审查（guardian）
会话会引用被审查的对话，因此只计 token，不计调用。Copilot CLI 的记录格式没有公开文档，按结构识别调用。把记录
存在数据库或二进制文件中的工具（Cursor、Antigravity 等）不会被收集。

收集到的调用和用量累积在 `~/.claude/skill-policy/stats.json`，只重新读取有变化的对话记录。Claude Code 会删除
超过 `cleanupPeriodDays`（默认 30 天）的对话记录，Gemini CLI 也可能按设置删除，想长期保留就在此期限内至少运行
一次 `stats` 或 `dashboard`。服务器只监听 `127.0.0.1`，因为数据中含有本地路径和项目名。

### token 的测量方法

| 值 | 测量方式 | 准确度 |
| --- | --- | --- |
| 使用频率 | 各智能体的对话记录（见上表，含子智能体） | 准确。收集前已被删除的记录会缺失 |
| 常驻 token（每次请求） | Claude Code：名称 + `description` + `when_to_use`（截断于 1536 字符）。Codex：列表中该技能那一行 | 默认为估算；`--exact` 时 Claude Code 技能为实测 |
| 调用时 token（每次调用一次） | 整个 SKILL.md | 同上。技能之后另外读取的参考文件和脚本输出不计入 |
| 单次调用实测 | 记录中的用量：正文进入后那次请求的输入 token − 调用技能前那次请求（中位数） | 实测，但混有工具结果和用户输入，应视为上限 |
| 整个会话 | 在 Claude Code 中用 `/context` 的 Skills 行和 `/cost` | 准确，以单个会话为单位 |

### 精确计算 token：设置 API 密钥

`--exact`（仪表盘上的“精确计算 token”按钮）会把 Claude Code 技能的列表和正文文本发送到 Anthropic
`count_tokens` API。该 API 免费但有速率限制，技能描述会离开本机。结果按内容哈希缓存，只重新发送有变化的技能。
Codex、Gemini、Copilot 技能使用不同的分词器，因此保留估算值。

密钥要放在**启动仪表盘服务器的那个终端的环境变量**里，而不是浏览器，也不是 `~/.claude/settings.json` 的 `env`
（它只会传给在 Claude Code 内运行的命令）。服务器只在启动时读取一次环境变量，设置后请重启服务器。

```powershell
# Windows PowerShell：仅当前终端
$env:SKILL_STATS_API_KEY = "sk-ant-..."
node setup.mjs dashboard

# 长期保留：保存为用户环境变量，然后在新终端中运行（VS Code 终端需重启 VS Code）
setx SKILL_STATS_API_KEY "sk-ant-..."
```

```bash
# macOS / Linux
export SKILL_STATS_API_KEY="sk-ant-..."                         # 仅当前终端
echo 'export SKILL_STATS_API_KEY="sk-ant-..."' >> ~/.zshrc       # 长期保留（bash 用 ~/.bashrc）
```

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `SKILL_STATS_API_KEY` | count_tokens 使用的密钥，优先读取。只有本工具读取，可以长期保留 | 无 |
| `ANTHROPIC_API_KEY` | 上一个变量未设置时使用。在设置了该变量的终端中启动 Claude Code，可能会改用 API 密钥而不是订阅 | 无 |
| `SKILL_STATS_MODEL` | 计算 token 时使用的模型 | `claude-sonnet-5` |
| `CODEX_HOME` | 读取 Codex 记录的位置 | `~/.codex` |

设置生效后，仪表盘上的“精确计算 token”按钮会变为可用，悬停可看到读取了哪个变量。密钥在 Anthropic Console 的
API Keys 中创建。

## 提示：去掉提交中的 Claude 作者署名

Claude Code 会在提交中添加 `Co-Authored-By: Claude` 行。要去掉它，在 `~/.claude/settings.json` 中加入：

```json
{ "attribution": { "commit": "" } }
```

如果也要去掉 PR 描述中的署名，再加上 `"pr": ""`。

## 更新本模板

- 第三方技能的更新步骤见 `kit/project/.claude/skills/THIRD_PARTY_NOTICES.md`。
- 若只想把新文件带入已安装的项目，重新执行 `node setup.mjs project <dir>`。已有文件保持不变，只添加缺少的文件和 settings.json 中的新条目。
- 修改技能集目录或管理器后，重新执行 `node setup.mjs user`。`policy.json` 和 `state.json` 不会被覆盖。
