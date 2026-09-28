---
name: plan-board
description: Use when starting or finishing a task, when the user asks what to work on next, where the project stands, or what is left, when a multi-step task needs a written plan, or when a task's status changed. Covers docs/plans/ (backlog, active, done), docs/ROADMAP.md, phases, and task IDs like P1-03.
---

# Plan board

**A task's status is the folder its file sits in.** Nothing else records it. Moving the file is the
status change.

| Folder | Meaning | Content |
| --- | --- | --- |
| `docs/plans/backlog/<ID>-<slug>.md` | not started | a stub: goal, prerequisite, deliverable |
| `docs/plans/active/<ID>-<slug>.md` | in progress | the full plan with steps |
| `docs/plans/done/<ID>-<slug>.md` | finished | the plan plus the real verification output |

Task IDs are `P<phase>-<nn>`, such as `P1-03`. The ID and file name stay the same from backlog to
done. `docs/ROADMAP.md` carries phases only — never task rows, never task status.

## What to read, and when

| Question | Read |
| --- | --- |
| What is in progress? | the session status block Claude Code injects; without it, `ls docs/plans/active` |
| What is next? | `ls docs/plans/backlog`, then only the stub you pick |
| What does this task involve? | that one plan file |
| Where does the project stand overall? | `docs/ROADMAP.md` |
| Why is the product shaped this way? | `docs/adr/` and `CONTEXT.md`, only the entries you need |

Never read every plan file, and never open the roadmap to start or finish a single task. Don't
paste plan or roadmap contents into chat; point at `docs/plans/active/P1-03-x.md:12`.

## Starting a task

1. Pick it: the task the user names, or the lowest-numbered stub in `docs/plans/backlog/` whose
   prerequisites are all in `docs/plans/done/`. Confirm the pick with the user before moving files.
2. `git mv docs/plans/backlog/<file> docs/plans/active/`.
3. If the task is more than one obvious change, turn the stub into a plan: keep its header table
   and append the sections from `templates/plan.md`. The plan's content comes from the Superpowers
   `writing-plans` skill or from `grilling`. This skill only fixes where the file lives.
4. Don't touch `docs/ROADMAP.md`. Nothing there changes when a task starts.

No stub for the task? Create one from `templates/backlog-stub.md`, then move it.

## While working

- Tick the step checkboxes as steps finish. Nothing else in the plan changes.
- Don't edit goals, non-goals, or decisions during implementation (working rule 6 in AGENTS.md).
  If the plan turns out to be wrong, stop and tell the user.

## Finishing a task

1. Write the real verification result into the plan's 검증 section, summarizing actual command
   output rather than the word "done".
2. `git mv docs/plans/active/<file> docs/plans/done/`.
3. If the work settled something worth keeping, write an ADR with the `domain-modeling` skill.
   Plans are history. ADRs are the durable record.
4. Open `docs/ROADMAP.md` only if this task met a phase's ending condition. Then flip that phase
   row, add one line to the phase's memo, and update the date. Otherwise leave the file closed.

## Adding work

- A new task: one stub in `docs/plans/backlog/`. That is the whole procedure.
- A new phase: add a row to 단계 지도 and a short memo block in `docs/ROADMAP.md`, then write the
  stubs. Keep each task to about one sitting of work; split anything past roughly ten steps.
- Keep `docs/ROADMAP.md` under 60 lines. Task lists never move back into it.

## Reporting status

Answer from the injected status block, or from `ls docs/plans/active docs/plans/backlog`. Don't
scan the repo, don't open plan files, and don't open the roadmap for a status question.

`.claude/hooks/session_status.py` builds that block from these folders plus the roadmap's 🔄 phase
row, so it is only as accurate as the file locations. Move the file and the status is correct.
