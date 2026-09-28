[한국어](../README.md) | **English** | [简体中文](README-CN.md)

# Project Template

A set of configs that makes Claude Code (and Codex) follow the same workflow on long-running,
multi-person projects. It keeps skills few and tied to the current stage, which cuts wasted tokens and
off-target results.

- **User scope** (once per PC): plugins, skill policy, skill-set manager, and a hook that asks before
  restoring the policy when an upgrade reverts it.
- **Project scope** (per project): workflow docs, project skills, status and sync hooks, default permissions.

Requirements: Node.js 18+, Python 3.9+, git, Claude Code CLI (`claude`).

## Quick start

```bash
git clone <this repo> Project_Template
cd Project_Template

# 1) Once per PC. Every teammate runs it on their own machine.
node setup.mjs user

# 2) Per project. Existing files are kept; settings.json is merged.
node setup.mjs project ../my-project              # default
node setup.mjs project ../my-app --expo --frontend  # Expo app + UI
node setup.mjs project ../my-svc --gitlab           # with the GitLab CI skill

# 3) Verify
node setup.mjs check

# 4) (optional) Install skill sets by category
node setup.mjs skills list
node setup.mjs skills add documents
```

Restart Claude Code after installing. In the project, fill in the `<...>` placeholders in `AGENTS.md`
and `docs/ROADMAP.md`, then commit.

## What gets installed

### `node setup.mjs user`

| Item | Location |
| --- | --- |
| Superpowers and Codex plugins (user scope) | `claude plugin install` |
| Skill policy script and policy file | `~/.claude/skill-policy/` |
| Skill-set manager and catalog (`skill-sets.mjs`, `skill-sets.json`) | `~/.claude/skill-policy/` |
| Skill stats and dashboard (`skill-stats.mjs`, `skill-agents.mjs`, `skill-inventory.mjs`, `skill-dashboard.html`, `skill-meta.json`) | `~/.claude/skill-policy/` |
| `skill-sets` skill, so you can ask Claude to install or toggle sets | `~/.claude/skills/skill-sets/` |
| `skillOverrides` (manual-only or off for skills named in the policy) | `~/.claude/settings.json` |
| Policy check hook at session start | `~/.claude/settings.json` |

The Superpowers `using-superpowers` bootstrap (injected in full every session) is removed. The other
Superpowers skills still trigger automatically from their descriptions.

Option `--local-project <dir>`: keeps personal skills (`localOnlySkills` in `policy.json`) in that project
only instead of globally, makes them manual-only, and hides them from team commits via
`.git/info/exclude`. Can be repeated.

### `node setup.mjs project <dir>`

| Item | Purpose |
| --- | --- |
| `docs/WORKFLOW.md` | Skill order per stage, sources, automatic vs. manual |
| `AGENTS.md` = `CLAUDE.md` | Shared agent instructions (edit one; a hook syncs the other) |
| `CONTEXT.md`, `docs/adr/`, `docs/ROADMAP.md`, `docs/plans/{backlog,active,done}/` | Glossary, decisions, work status |
| `.claude/skills/` | `plan-board` + 8 skills from mattpocock/skills (`gitlab-ci-skill` with `--gitlab`) |
| `.claude/hooks/session_status.py` | Injects in-progress and next tasks at session start |
| `.claude/hooks/post_edit.py` | Copies `.claude/skills` → `.agents/skills` (for Codex), syncs AGENTS/CLAUDE |
| `.claude/settings.json` | The hooks above, default permissions such as denying reads of `.env` and key files |

Options: `--expo` (expo plugin), `--frontend` (frontend-design plugin), `--gitlab`, `--force` (overwrite existing files).

## How the skill policy applies to skills you already have

In one line: **the policy never installs skills. If a skill named in `policy.json` exists on this PC,
the policy only changes how that skill behaves.** Skills not named there are left alone.

The policy is written to `skillOverrides` in `~/.claude/settings.json` as `"skill name": "state"`.
Claude Code applies it to **any skill with that name**, wherever it lives (`~/.claude/skills/` or a
project's `.claude/skills/`). It does not apply to plugin skills (names like `superpowers:brainstorming`).

| Policy list | Setting | Effect |
| --- | --- | --- |
| `manualSkills` | `user-invocable-only` | Claude won't invoke it on its own; runs only via `/name`. Its description leaves the context, saving tokens |
| `offSkills` | `off` | Fully hidden. If it is reinstalled in `~/.claude/skills/`, the folder is deleted (after asking at session start) |
| `localOnlySkills` | folder move + `disable-model-invocation` | Removed globally, kept only in the listed projects |
| (not listed) | none | Unchanged; invoked automatically |

### Examples

The default `policy.json` lists gstack skill names (`review`, `qa`, `ship`, …) under `manualSkills`.

1. **A teammate without gstack.** Only the line `"review": "user-invocable-only"` is added to
   `settings.json`. There is no skill named `review`, so nothing happens. That is what "not installed,
   policy just applies if present" means.
2. **Someone who installs gstack.** As soon as `~/.claude/skills/review/` appears, the setting above takes
   effect. Saying "review this" won't make Claude call gstack `review`; you have to type `/review`.
   If a later gstack upgrade removes the setting, Claude asks "restore it?" at the next session start.
3. **Your own personal skill `~/.claude/skills/my-notes/`.** Not listed, so nothing changes; it is still
   invoked automatically. To make it manual-only, add `"my-notes"` to `manualSkills` and run `--apply`.
4. **Project skill `.claude/skills/grill-me/`** (added by this template). Not listed, so nothing changes.
   It is manual-only anyway, because its own `SKILL.md` has `disable-model-invocation: true`.
5. **A project skill with a clashing name.** If the team repo has `.claude/skills/review/`, your PC's
   policy applies to it too, making it `/review`-only **for you**. Teammates are unaffected. If you don't
   want that, remove `review` from `manualSkills` or rename the project skill. (If the same name also
   exists in `~/.claude/skills/`, the personal one wins and the project one is shadowed.)
6. **`autoplan` in `offSkills`.** A project skill with that name is only hidden; its files stay.
   `~/.claude/skills/autoplan/` is deleted each time it comes back.
7. **`browseros-neo` in `localOnlySkills`.** `node setup.mjs user --local-project ../blog` moves
   `~/.claude/skills/browseros-neo/` into `../blog/.claude/skills/`, makes it manual-only, and adds it to
   `../blog/.git/info/exclude` so it stays out of team commits. Other projects don't see it.

To see the current state of every skill on this PC: `node setup.mjs skills status`.

### Changing the policy

Edit `~/.claude/skill-policy/policy.json`, then:

```bash
node ~/.claude/skill-policy/skill-policy.mjs --apply   # apply
node setup.mjs check                                   # show only what differs
```

| Key | Meaning |
| --- | --- |
| `offSkills` | Fully off (`skillOverrides: off`; deleted if reinstalled in `~/.claude/skills`) |
| `manualSkills` | Manual-only (invoked only via `/name`) |
| `localOnlySkills`, `localSkillProjects` | Keep personal skills only in the listed projects |
| `stripSuperpowersBootstrap` | Remove the per-session using-superpowers injection |
| `userPlugins` | Plugins to enable or disable at user scope |
| `projectPluginRemovals` | Plugins to remove from specific project settings (`{"<settings.json path>": ["id"]}`) |

When a gstack upgrade, plugin update, `npx skills` update, or BrowserOS reverts the settings, the hook
notices at the next session start and Claude asks before restoring them. Nothing is fixed silently.

## Skill sets: install by category

Useful skills from [awesome-claude-skills](https://github.com/ComposioHQ/awesome-claude-skills),
grouped by category. The list lives in `kit/user/skill-sets.json`; after editing it, run
`node setup.mjs user` to pick it up.

| Set | Skills |
| --- | --- |
| `documents` | docx, pdf, pptx, xlsx, doc-coauthoring |
| `frontend` | frontend-design, web-artifacts-builder, webapp-testing, playwright-skill |
| `dev-tools` | mcp-builder, skill-creator, changelog-generator |
| `data` | csv-data-summarizer, d3-viz, postgres |
| `research-writing` | content-research-writer, article-extractor, youtube-transcript, meeting-insights-analyzer |
| `business` | brand-guidelines, internal-comms, competitive-ads-extractor, domain-name-brainstormer, lead-research-assistant |
| `creative` | canvas-design, algorithmic-art, slack-gif-creator, theme-factory, image-enhancer |
| `productivity` | file-organizer, invoice-organizer, tailored-resume-generator, raffle-winner-picker |

```bash
node setup.mjs skills list                        # sets and install status
node setup.mjs skills add documents data          # install sets → ~/.claude/skills/ (all projects)
node setup.mjs skills add pdf                     # a single skill
node setup.mjs skills add frontend --project .    # this project only (.claude/skills/, shared with the team)
node setup.mjs skills add documents --force       # update to the latest version
node setup.mjs skills remove data                 # uninstall (only removes what this tool installed)
```

- Source repos are shallow-cloned into `~/.claude/skill-policy/cache/`; only the needed folders are copied.
- A folder with the same name is skipped. Use `--force` to overwrite.
- Third-party skills can run scripts. Read their `SKILL.md` before relying on them.
- `documents` and `skill-creator` overlap with the `anthropic-skills` plugin. With both on, the
  descriptions are listed twice and just cost tokens. Keep one.

## Turning skills on and off, comparing tokens

On/off only changes `skillOverrides`; files stay. Accepts set names, skill names, `all` (everything this
tool installed), and `plugin:<name>` (a whole plugin).

```bash
node setup.mjs skills off documents        # turn a set off
node setup.mjs skills off review qa        # any skill by name (gstack skills too)
node setup.mjs skills off all              # every installed set
node setup.mjs skills off plugin:superpowers
node setup.mjs skills on all               # back on (policy manual/off entries are kept)
node setup.mjs skills status               # per-skill state and estimated tokens
```

Skills turned off with `off` are recorded in `~/.claude/skill-policy/state.json`, so the session-start
check won't treat them as drift and turn them back. `on` returns them to the policy value (manual-only if
listed in `manualSkills`).

### Comparison steps (e.g. is the `documents` set worth it?)

1. `node setup.mjs skills status` → note the estimated tokens the skill listing costs per request. Check
   how often the set's skills are actually used in `node setup.mjs dashboard` first.
2. In a new session, run the same task (e.g. "turn the tables in this PDF into an xlsx"), record the
   Skills row of `/context` and `/cost`, and save the output.
3. `node setup.mjs skills off documents` → open a new session and repeat the task.
4. Compare tokens, cost, and output side by side. `remove` sets that don't pay for themselves.

Settings are read when a session starts, so always compare in fresh sessions. The `status` numbers are
estimates (4 ASCII chars = 1 token, 1 Hangul/CJK char = 1 token) and exclude plugin skills. For every
skill including plugins, and for usage frequency, use the dashboard below.

### Just ask Claude

With the `skill-sets` skill installed by `setup.mjs user`, you can say:

- "Install the document skill set" → `add documents`
- "Add the frontend set to this project only" → `add frontend --project .`
- "Turn off all installed skills and show how many tokens that saves" → `off all`, then `status`
- "Turn off the superpowers plugin for now" → `off plugin:superpowers`

## Skill dashboard: state, usage, and tokens per agent

```bash
node setup.mjs dashboard              # http://localhost:4178 (another port: --port 5000)
node setup.mjs stats                  # per-agent summary only, no browser (saves the same data)
node setup.mjs stats --exact          # exact Claude Code skill tokens via the count_tokens API (needs an API key, below)
node ~/.claude/skill-policy/skill-stats.mjs serve   # from the installed copy, without this repo
```

Two pages, switched from the top menu. Pick the language (한국어, English, 简体中文) at the top right; the
language and theme are remembered in the browser.

- **Overview**: choose a coding agent at the top (All, Claude Code, Codex, Gemini CLI, GitHub Copilot CLI).
  It shows summary numbers, a per-agent comparison (skill list sent with every request, skill calls in 30
  days, requests and input tokens, the skill list's share of input, duplicates), each agent's skill list as a
  bar, calls or token usage over the last 30 days stacked by agent, the most used skills, and every skill
  grouped by category, by source, or as one flat list. Clicking a row in the comparison also picks that agent.
- **Guide & concepts**: diagrams and tables on how a skill gets called, the two ways skills cost tokens,
  invocation modes, where skills live and which wins, where the numbers come from, how each coding agent is
  collected, and where the API key goes for exact counts, plus a glossary and cleanup recipes. Each `?` button
  on the overview links to the matching section.

- **Always-on tokens**: the name and description of every automatic skill go into the context on every
  request, whether or not the skill is used. Zero for `/name`-only and off skills. Each agent sends its own list.
- **On-use tokens**: when a skill is called, its SKILL.md body enters the conversation.
- **Invocation mode**: automatic, `/name`-only, off, shadowed (a global skill with the same name wins),
  plugin off, not installed (only in transcripts).
- **Source**: where the skill came from (gstack, the superpowers plugin, mattpocock/skills, a skill-set repo,
  …) and where it is installed (agent; global, project, plugin, or built-in). The source links to its repo.
- **Category**: planning, build, debugging, review/security, testing, shipping/Git, design, documents, data,
  and so on, picked from keywords in the name and description.
- **Calls in the last 30 days**: made by the model on its own, or by you (`/name`, `$name`). Expand a row for
  the full description, per-project counts, a 30-day chart, and the measured cost of one call.
- **Cleanup candidates**: automatic skills not called once in the last 30 days. Their description still costs
  tokens on every request, so they are candidates for `/name`-only or off. A duplicate copy is not a candidate
  when another copy of it was used.
- **Listed twice**: a skill whose name appears in the list more than once. It mostly happens in Codex, when the
  same skill sits in two folders or one plugin is installed from two marketplaces. The comparison shows how many
  tokens dropping the extra copies would save.

If a source or category is wrong, fix it in `~/.claude/skill-policy/skill-meta.local.json`. It has the same
shape as `kit/user/skill-meta.json` and wins over it.

```json
{ "origins": { "my-notes": "https://github.com/me/notes-skill" }, "categories": { "my-notes": "research" } }
```

### How each coding agent is collected

There is nothing to switch on. The collector reads the logs of every agent it finds on this PC; use an agent
once and it appears on the next collection.

| Agent | Transcripts | Counted as a call | Tokens per request |
| --- | --- | --- | --- |
| Claude Code | `~/.claude/projects/**/*.jsonl` | Skill tool calls; the SKILL.md body injected after `/name` | worked out from settings (`skillOverrides`) and SKILL.md |
| Codex | `$CODEX_HOME/sessions/**/*.jsonl`, `archived_sessions` (default `~/.codex`) | shell reads of a SKILL.md, an injected `<skill>`, `$name` in your message (once per turn) | the `<skills_instructions>` list the last session actually sent |
| Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json` | the `activate_skill` tool, `read_file` of a SKILL.md | estimated from `~/.gemini/skills`, `<project>/.gemini/skills` |
| GitHub Copilot CLI (experimental) | `~/.copilot/session-state/**/*.jsonl` | a tool call named `skill`, a read of a SKILL.md | estimated from `~/.copilot/skills`, `<project>/.github/skills` |

Token usage comes from each log's usage records (Claude Code `usage`, Codex `token_count`, Gemini `tokens`).
Input includes tokens read from cache, so it is not what you are billed. Forked Codex subagents re-record the
parent conversation, so a turn counts once; auto-review (guardian) sessions quote the conversation they review,
so they add tokens but no calls. Copilot CLI's log format is not documented, so its calls are found by shape.
Tools that keep their logs in a database or binary files (Cursor, Antigravity, …) are not collected.

Collected calls and usage accumulate in `~/.claude/skill-policy/stats.json`; only changed transcripts are
re-read. Claude Code deletes transcripts older than `cleanupPeriodDays` (30 days by default), and Gemini CLI may
too depending on its settings, so run `stats` or `dashboard` at least that often to keep the history. The server
listens on `127.0.0.1` only, because the data includes local paths and project names.

### How tokens are measured

| Value | Method | Accuracy |
| --- | --- | --- |
| Usage | each agent's transcripts (table above, subagents included) | Exact. Transcripts deleted before collection are lost |
| Always-on tokens (every request) | Claude Code: name + `description` + `when_to_use` (cut at 1536 chars). Codex: the skill's line in its list | Estimate by default; `--exact` measures Claude Code skills |
| On-use tokens (once per call) | the whole SKILL.md | Same. Reference files and script output the skill reads later are not included |
| Measured cost of one call | usage in the logs: input tokens of the request right after the body arrived − the request just before the call (median) | Measured, but tool results and user input are mixed in, so read it as an upper bound |
| Whole session | `/context` (Skills row) and `/cost` inside Claude Code | Exact, per session |

### Counting tokens exactly: setting the API key

`--exact` (the dashboard's "Count tokens exactly" button) sends Claude Code skill listing and body text to the
Anthropic `count_tokens` API. It is free but rate-limited, and skill descriptions leave your machine. Results are
cached by content hash, so only changed skills are sent again. Codex, Gemini, and Copilot skills keep their
estimates because those agents use different tokenizers.

Put the key in **an environment variable of the terminal that starts the dashboard server**, not in the browser
and not in `env` of `~/.claude/settings.json` (that only reaches commands run inside Claude Code). The server
reads environment variables once when it starts, so restart it after setting the key.

```powershell
# Windows PowerShell: this terminal only
$env:SKILL_STATS_API_KEY = "sk-ant-..."
node setup.mjs dashboard

# Keep it: save a user environment variable, then run from a new terminal (restart VS Code for its terminal)
setx SKILL_STATS_API_KEY "sk-ant-..."
```

```bash
# macOS / Linux
export SKILL_STATS_API_KEY="sk-ant-..."                         # this terminal only
echo 'export SKILL_STATS_API_KEY="sk-ant-..."' >> ~/.zshrc       # keep it (bash: ~/.bashrc)
```

| Variable | What it does | Default |
| --- | --- | --- |
| `SKILL_STATS_API_KEY` | Key for count_tokens, checked first. Only this tool reads it, so it is safe to keep set | none |
| `ANTHROPIC_API_KEY` | Used when the one above is not set. Claude Code started from a terminal with this variable may use the API key instead of your subscription | none |
| `SKILL_STATS_MODEL` | Model used for counting | `claude-sonnet-5` |
| `CODEX_HOME` | Where Codex logs are read from | `~/.codex` |

Once it works, the "Count tokens exactly" button becomes active, and hovering it shows which variable was read.
Create a key under API Keys in the Anthropic Console.

## Tip: remove the Claude co-author line from commits

Claude Code adds a `Co-Authored-By: Claude` trailer to commits. To drop it, put this in
`~/.claude/settings.json`:

```json
{ "attribution": { "commit": "" } }
```

Add `"pr": ""` to drop the line from PR descriptions too.

## Updating this template

- The update procedure for third-party skills is in `kit/project/.claude/skills/THIRD_PARTY_NOTICES.md`.
- To bring only new files into an existing project, rerun `node setup.mjs project <dir>`. Existing files
  are kept; only missing files and new settings.json entries are added.
- After changing the skill-set catalog or manager, rerun `node setup.mjs user`. `policy.json` and
  `state.json` are never overwritten.
