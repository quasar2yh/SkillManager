---
name: skill-sets
description: Install, remove, or turn on/off skill sets (documents, frontend, dev-tools, data, research-writing, business, creative, productivity) and individual skills or plugins, and estimate their token cost. Use when the user asks to install or remove a skill set, turn skills or plugins on or off, or compare token usage with and without skills.
---

# Skill sets

All work goes through one script. Run it with Bash and show the user its output.

```bash
node ~/.claude/skill-policy/skill-sets.mjs <command>
```

| User asks | Command |
| --- | --- |
| What sets exist / what is installed | `list` |
| Install a set or skill for me (every project) | `add <set/skill>...` |
| Install it for this project only (shared with the team) | `add <set/skill>... --project .` |
| Update installed skills | `add <set/skill>... --force` |
| Uninstall | `remove <set/skill/all>...` |
| Turn off / on (files kept) | `off <set/skill/all>...` / `on <set/skill/all>...` |
| Turn a plugin off / on | `off plugin:<name>` / `on plugin:<name>` |
| How many tokens do skills cost now | `status` |
| Which skills are used, how often, and what they cost, per coding agent (Claude Code, Codex, Gemini CLI, Copilot CLI) (dashboard) | `node ~/.claude/skill-policy/skill-stats.mjs serve` in the background, then give the URL; `collect` for a text summary |

Rules:

- Map the user's words to set names from `list` (for example "문서 스킬" → `documents`, "디자인" → `frontend` or `creative`; ask if both fit).
- `all` means every skill installed by this script, not gstack or project skills. To turn one of those off, pass its name.
- Plugin skills (`plugin:skill`) cannot be turned off one by one. Offer `off plugin:<plugin>` instead.
- After `add`, tell the user third-party skills can run scripts and name the repo they came from.
- For a token comparison: run `status` before and after the change, then tell the user to start a new session and do the same task in both states, checking `/context` (Skills row) and `/cost`. Changes are read when a session starts.
