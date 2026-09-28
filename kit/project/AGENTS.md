# <프로젝트 이름>

<한두 문장: 무엇을 만드는지, 어떤 플랫폼인지.>

These instructions are shared by every coding agent. `AGENTS.md` and `CLAUDE.md` are the same file
under two names, kept byte-identical by `.claude/hooks/post_edit.py`: edit either one and the other
follows. Keep them tool-neutral and short (Codex stops reading after 32 KiB).

The full lifecycle — which skill runs at which stage, where each skill comes from, and which ones a
person must call — is in `docs/WORKFLOW.md`. Read it when you are unsure what comes next.

## Layout

| Path | What | Stack |
| --- | --- | --- |
| `<path>` | <what> | <stack> |

## Commands

| Task | Command |
| --- | --- |
| Install | `<command>` |
| All checks | `<command>` |

## Definition of done

Run the all-checks command, or the per-area checks for what you touched. Report the actual output.
A failing or skipped check means the work is not done.

## Working rules

1. **Prefer existing skills.** Before a non-trivial task, check `docs/WORKFLOW.md`. If a skill defines
   the workflow, follow it instead of improvising a parallel process. Don't stack skills that do the
   same job.
2. **Be clear before changing code.** State the goal and important assumptions. Ask one focused
   question when the task is ambiguous. Push back on needlessly complex or risky approaches.
3. **Keep changes simple.** Smallest change that solves the problem. No speculative features or new
   dependencies without a clear reason.
4. **Make surgical edits.** Touch only what the task needs. Match the existing style.
5. **Change direction when the direction is wrong.** If the same workaround spreads, or a fix fights
   the framework or data model, stop patching. Explain the problem, the proposed direction, and the
   cost now versus later. Get agreement before structural changes, carry them through completely,
   and record the decision as an ADR in `docs/adr/`.
6. **Change settled design only in design work.** ADRs, `CONTEXT.md`, specs, and plan goals change
   only while brainstorming, planning, grilling, or domain modeling. During implementation, tick plan
   checkboxes only. If a settled decision doesn't work, stop and give the user the options.
7. **Verify.** Run the most relevant project check. If you can't, say what wasn't verified and why.
8. **Read actual errors.** Inspect the real message, stack trace, or log before fixing.
9. **Be careful with destructive actions.** No deleting, history rewriting, resets, or dropping data
   unless the user asks.
10. **Git.** One logical change per commit, concise semantic messages.
11. **Korean responses.** Respond in Korean unless there is a clear reason not to.

## Work state

A task's status is the folder its plan file sits in (`docs/plans/backlog`, `active`, `done`).
Claude Code gets the current status injected by a SessionStart hook; other agents run
`ls docs/plans/active docs/plans/backlog`. Read narrow: only the one plan file the step needs.
`docs/adr/` holds decisions, `CONTEXT.md` the glossary. The `plan-board` skill has the procedure.

## Skills

Project skills live in `.claude/skills/` (source of truth). `.agents/skills/` is a generated copy
for Codex; never edit it. Regenerate by hand with `python .claude/hooks/post_edit.py --sync`.
Third-party skills are listed in `.claude/skills/THIRD_PARTY_NOTICES.md`; don't edit them.
